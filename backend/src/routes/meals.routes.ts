import { Router } from "express";
import { z } from "zod";
import { Prisma, type MealRecord } from "@prisma/client";
import { prisma } from "../prisma.js";
import { requireAuth, type AuthedRequest } from "../middleware/auth.middleware.js";
import { uploadPhoto } from "../middleware/upload.middleware.js";
import { HttpError } from "../middleware/error.middleware.js";
import { ingestPhoto } from "../services/photo.service.js";
import { awardPreMealPoints, handleMealCompleted, getGamificationSummary } from "../services/gamification.service.js";

export const mealsRouter = Router();
mealsRouter.use(requireAuth);

const MEAL_TYPES = ["BREAKFAST", "LUNCH", "DINNER", "SNACK"] as const;

// multipart 表單的欄位一律是字串，不能用 z.coerce.boolean() (Boolean("false") 會是 true)
const booleanField = z.enum(["true", "false"]).transform((v) => v === "true");

// 裝置時鐘再怎麼錯也不會超出這個範圍。超出的一律當成格式錯誤 (400)，因為極端值會讓後面的
// 32 位元整數欄位溢位、或讓日期運算出錯 → 變成 500，而且離線佇列重送時會「永遠」失敗。
// (未來時間仍然接受，只是不會被拿去算連續天數，見 post-meal 的 gamificationAt。)
const MIN_PLAUSIBLE_MS = Date.UTC(1970, 0, 1);
const MAX_PLAUSIBLE_MS = Date.UTC(2100, 0, 1);
const MAX_INT32 = 2_147_483_647;

const plausibleDatetime = z
  .string()
  .datetime()
  .refine((s) => {
    const t = Date.parse(s);
    return t >= MIN_PLAUSIBLE_MS && t < MAX_PLAUSIBLE_MS;
  }, "時間不在合理範圍內");

// 世界上實際的時區偏移範圍是 -840 ~ +720 分鐘 (JS getTimezoneOffset 慣例)
const tzOffsetField = z.coerce.number().int().min(-840).max(840);

// 離線補傳用的共用欄位 (都是選填，舊版前端不帶也能正常運作)
const offlineFieldsSchema = {
  capturedOffline: booleanField.optional(),
  clientSentAt: plausibleDatetime.optional(),
};

const preMealBodySchema = z.object({
  // 前端自己產生的用餐紀錄 ID (UUID)。離線時拿不到伺服器發的 ID，所以由前端先產生；
  // 沒帶的話伺服器會自己產生 (舊版前端的行為)。同一個 ID 重送不會產生重複紀錄。
  // 統一轉小寫，避免同一個 UUID 因大小寫不同被當成兩筆紀錄。
  id: z
    .string()
    .uuid()
    .transform((s) => s.toLowerCase())
    .optional(),
  mealType: z.enum(MEAL_TYPES),
  capturedAt: plausibleDatetime,
  tzOffsetMinutes: tzOffsetField.optional(),
  notes: z.string().max(1000).optional(),
  ...offlineFieldsSchema,
});

function isUniqueViolation(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002";
}

/** 依前端給的 ID 找出既有紀錄；沒有就建立。回傳 createdNow 表示這次請求是否真的新建了一筆。 */
async function findOrCreateMealRecord(params: {
  id?: string;
  userId: string;
  mealType: (typeof MEAL_TYPES)[number];
  preMealAt: Date;
  notes?: string;
}): Promise<{ mealRecord: MealRecord; createdNow: boolean }> {
  const { id, userId } = params;

  const assertUsable = (record: MealRecord) => {
    // 不分辨「不存在」與「屬於別人」，避免讓人探測別人的紀錄 ID
    if (record.userId !== userId) throw new HttpError(409, "這個紀錄 ID 已被使用");
    if (record.deletedAt) throw new HttpError(409, "這筆用餐紀錄已被刪除");
  };

  if (id) {
    const existing = await prisma.mealRecord.findUnique({ where: { id } });
    if (existing) {
      assertUsable(existing);
      return { mealRecord: existing, createdNow: false };
    }
  }

  try {
    const created = await prisma.mealRecord.create({
      data: {
        ...(id ? { id } : {}),
        userId,
        mealType: params.mealType,
        preMealAt: params.preMealAt,
        notes: params.notes,
      },
    });
    return { mealRecord: created, createdNow: true };
  } catch (err) {
    // 兩個相同 ID 的請求同時到達，另一個先建立成功了
    if (id && isUniqueViolation(err)) {
      const winner = await prisma.mealRecord.findUnique({ where: { id } });
      if (winner) {
        assertUsable(winner);
        return { mealRecord: winner, createdNow: false };
      }
    }
    throw err;
  }
}

// 建立一筆新的用餐紀錄 + 上傳「餐前照」。可安全重送 (同一個 id 送第二次回 200 與既有結果)。
mealsRouter.post("/pre-meal", uploadPhoto.single("photo"), async (req: AuthedRequest, res, next) => {
  try {
    if (!req.file) throw new HttpError(400, "請附上餐前照片");
    const body = preMealBodySchema.parse(req.body);
    const userId = req.user!.id;
    const capturedAt = new Date(body.capturedAt);

    const { mealRecord, createdNow } = await findOrCreateMealRecord({
      id: body.id,
      userId,
      mealType: body.mealType,
      preMealAt: capturedAt,
      notes: body.notes,
    });

    let ingested: Awaited<ReturnType<typeof ingestPhoto>>;
    try {
      ingested = await ingestPhoto({
        userId,
        mealRecordId: mealRecord.id,
        phase: "PRE_MEAL",
        photo: {
          buffer: req.file.buffer,
          originalFileName: req.file.originalname,
          mimeType: req.file.mimetype,
          capturedAt,
          tzOffsetMinutes: body.tzOffsetMinutes ?? null,
          deviceUserAgent: req.headers["user-agent"] ?? null,
          capturedOffline: body.capturedOffline ?? false,
          clientSentAt: body.clientSentAt ? new Date(body.clientSentAt) : null,
        },
      });
    } catch (err) {
      // 這次請求剛建立、還沒有任何照片的紀錄，照片處理失敗就一併撤回，避免留下沒有照片的空紀錄。
      // (photos: none 確保絕不會刪到已經有照片的紀錄)
      if (createdNow) {
        await prisma.mealRecord
          .deleteMany({ where: { id: mealRecord.id, userId, photos: { none: {} } } })
          .catch(() => {});
      }
      throw err;
    }

    await awardPreMealPoints(userId, mealRecord.id);

    res
      .status(ingested.replayed ? 200 : 201)
      .json({ mealRecord, photo: ingested.photo, replayed: ingested.replayed });
  } catch (err) {
    next(err);
  }
});

const postMealBodySchema = z.object({
  capturedAt: plausibleDatetime,
  tzOffsetMinutes: tzOffsetField.optional(),
  ...offlineFieldsSchema,
});

// 幫一筆「等待餐後照」的用餐紀錄補上餐後照，並結算這一餐。
// 可安全重送：紀錄已經完成、且送來的是同一張照片時，回 200 與既有結果 (不會重複發點數)。
mealsRouter.post("/:id/post-meal", uploadPhoto.single("photo"), async (req: AuthedRequest, res, next) => {
  try {
    if (!req.file) throw new HttpError(400, "請附上餐後照片");
    const body = postMealBodySchema.parse(req.body);
    const userId = req.user!.id;
    const { id } = req.params;

    const mealRecord = await prisma.mealRecord.findFirst({ where: { id, userId, deletedAt: null } });
    if (!mealRecord) throw new HttpError(404, "找不到這筆用餐紀錄");
    if (mealRecord.status === "ABANDONED") {
      throw new HttpError(409, "這筆用餐紀錄已被放棄，無法再上傳餐後照");
    }

    const requestedAt = new Date(body.capturedAt);
    if (mealRecord.status === "AWAITING_POST_PHOTO") {
      if (requestedAt < mealRecord.preMealAt) {
        throw new HttpError(400, "餐後照的時間不能早於餐前照");
      }
      // 用餐時長存成 32 位元整數 (秒)；在存照片「之前」就擋掉，不然會存了照片才在更新時炸掉
      if ((requestedAt.getTime() - mealRecord.preMealAt.getTime()) / 1000 > MAX_INT32) {
        throw new HttpError(400, "餐前照與餐後照的時間相差過大");
      }
    }

    // 已經完成的紀錄，只有「同一張照片重送」會被接受 (ingestPhoto 內比對 sha256，不同則回 409)
    const { photo, replayed } = await ingestPhoto({
      userId,
      mealRecordId: mealRecord.id,
      phase: "POST_MEAL",
      photo: {
        buffer: req.file.buffer,
        originalFileName: req.file.originalname,
        mimeType: req.file.mimetype,
        capturedAt: requestedAt,
        tzOffsetMinutes: body.tzOffsetMinutes ?? null,
        deviceUserAgent: req.headers["user-agent"] ?? null,
        capturedOffline: body.capturedOffline ?? false,
        clientSentAt: body.clientSentAt ? new Date(body.clientSentAt) : null,
      },
    });

    // 重送時以第一次存下的時間為準
    const postMealAt = replayed ? photo.capturedAt : requestedAt;

    let updated = mealRecord;
    if (mealRecord.status === "AWAITING_POST_PHOTO") {
      const mealDurationSeconds = Math.round((postMealAt.getTime() - mealRecord.preMealAt.getTime()) / 1000);
      updated = await prisma.mealRecord.update({
        where: { id: mealRecord.id },
        data: { status: "COMPLETED", postMealAt, mealDurationSeconds },
      });
    }

    // 點數/連續天數用的時間不能晚於「現在」：手機時鐘如果被調到未來，
    // 否則連續天數會被推到未來日期，之後所有正常的紀錄都會被當成「更早」而不計入。
    // (資料庫存的仍是裝置回報的原始時間，這裡只影響遊戲化計算。)
    const gamificationAt = postMealAt.getTime() > Date.now() ? new Date() : postMealAt;

    // 重送時也照跑：handleMealCompleted 本身是 idempotent，這樣上一次如果剛好在
    // 「照片存好、點數還沒發」之間中斷，這次重送可以補發。
    await handleMealCompleted({
      userId,
      mealRecordId: mealRecord.id,
      mealType: mealRecord.mealType,
      postMealAt: gamificationAt,
      tzOffsetMinutes: body.tzOffsetMinutes ?? null,
    });

    const gamification = await getGamificationSummary(userId);

    res.status(200).json({ mealRecord: updated, photo, gamification, replayed });
  } catch (err) {
    next(err);
  }
});

mealsRouter.patch("/:id/abandon", async (req: AuthedRequest, res, next) => {
  try {
    const userId = req.user!.id;
    const { id } = req.params;
    const mealRecord = await prisma.mealRecord.findFirst({ where: { id, userId, deletedAt: null } });
    if (!mealRecord) throw new HttpError(404, "找不到這筆用餐紀錄");
    if (mealRecord.status === "ABANDONED") {
      return res.json({ mealRecord }); // 重送：已經是放棄狀態，直接回傳現況
    }
    if (mealRecord.status !== "AWAITING_POST_PHOTO") {
      throw new HttpError(409, "只有還在等待餐後照的紀錄可以被放棄");
    }
    const updated = await prisma.mealRecord.update({ where: { id }, data: { status: "ABANDONED" } });
    res.json({ mealRecord: updated });
  } catch (err) {
    next(err);
  }
});

// 病人刪除自己的一筆用餐紀錄（軟刪除：只標記 deletedAt，資料庫與照片檔案都保留供研究使用）
mealsRouter.delete("/:id", async (req: AuthedRequest, res, next) => {
  try {
    const userId = req.user!.id;
    const { id } = req.params;
    const mealRecord = await prisma.mealRecord.findFirst({ where: { id, userId, deletedAt: null } });
    if (!mealRecord) throw new HttpError(404, "找不到這筆用餐紀錄");
    await prisma.mealRecord.update({ where: { id }, data: { deletedAt: new Date() } });
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

const listQuerySchema = z.object({
  status: z.enum(["AWAITING_POST_PHOTO", "COMPLETED", "ABANDONED"]).optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

mealsRouter.get("/", async (req: AuthedRequest, res, next) => {
  try {
    const userId = req.user!.id;
    const query = listQuerySchema.parse(req.query);

    const where = {
      userId,
      deletedAt: null,
      ...(query.status ? { status: query.status } : {}),
      ...(query.from || query.to
        ? {
            preMealAt: {
              ...(query.from ? { gte: new Date(query.from) } : {}),
              ...(query.to ? { lte: new Date(query.to) } : {}),
            },
          }
        : {}),
    };

    const [items, total] = await Promise.all([
      prisma.mealRecord.findMany({
        where,
        include: { photos: true },
        orderBy: { preMealAt: "desc" },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      prisma.mealRecord.count({ where }),
    ]);

    res.json({ items, total, page: query.page, pageSize: query.pageSize });
  } catch (err) {
    next(err);
  }
});

mealsRouter.get("/:id", async (req: AuthedRequest, res, next) => {
  try {
    const userId = req.user!.id;
    const mealRecord = await prisma.mealRecord.findFirst({
      where: { id: req.params.id, userId, deletedAt: null },
      include: { photos: { include: { nutritionEstimate: true } } },
    });
    if (!mealRecord) throw new HttpError(404, "找不到這筆用餐紀錄");
    res.json({ mealRecord });
  } catch (err) {
    next(err);
  }
});
