import { Router } from "express";
import { z } from "zod";
import { prisma } from "../prisma.js";
import { requireAuth, type AuthedRequest } from "../middleware/auth.middleware.js";
import { uploadPhoto } from "../middleware/upload.middleware.js";
import { HttpError } from "../middleware/error.middleware.js";
import { ingestPhoto } from "../services/photo.service.js";
import { awardPreMealPoints, handleMealCompleted, getGamificationSummary } from "../services/gamification.service.js";

export const mealsRouter = Router();
mealsRouter.use(requireAuth);

const MEAL_TYPES = ["BREAKFAST", "LUNCH", "DINNER", "SNACK"] as const;

const preMealBodySchema = z.object({
  mealType: z.enum(MEAL_TYPES),
  capturedAt: z.string().datetime(),
  tzOffsetMinutes: z.coerce.number().int().optional(),
  notes: z.string().max(1000).optional(),
});

// 建立一筆新的用餐紀錄 + 上傳「餐前照」
mealsRouter.post("/pre-meal", uploadPhoto.single("photo"), async (req: AuthedRequest, res, next) => {
  try {
    if (!req.file) throw new HttpError(400, "請附上餐前照片");
    const body = preMealBodySchema.parse(req.body);
    const userId = req.user!.id;
    const capturedAt = new Date(body.capturedAt);

    const mealRecord = await prisma.mealRecord.create({
      data: {
        userId,
        mealType: body.mealType,
        preMealAt: capturedAt,
        notes: body.notes,
      },
    });

    const photo = await ingestPhoto({
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
      },
    });

    await awardPreMealPoints(userId, mealRecord.id);

    res.status(201).json({ mealRecord, photo });
  } catch (err) {
    next(err);
  }
});

const postMealBodySchema = z.object({
  capturedAt: z.string().datetime(),
  tzOffsetMinutes: z.coerce.number().int().optional(),
});

// 幫一筆「等待餐後照」的用餐紀錄補上餐後照，並結算這一餐
mealsRouter.post("/:id/post-meal", uploadPhoto.single("photo"), async (req: AuthedRequest, res, next) => {
  try {
    if (!req.file) throw new HttpError(400, "請附上餐後照片");
    const body = postMealBodySchema.parse(req.body);
    const userId = req.user!.id;
    const { id } = req.params;

    const mealRecord = await prisma.mealRecord.findFirst({ where: { id, userId, deletedAt: null } });
    if (!mealRecord) throw new HttpError(404, "找不到這筆用餐紀錄");
    if (mealRecord.status !== "AWAITING_POST_PHOTO") {
      throw new HttpError(409, "這筆用餐紀錄已經完成或已被放棄，無法再上傳餐後照");
    }

    const postMealAt = new Date(body.capturedAt);
    if (postMealAt < mealRecord.preMealAt) {
      throw new HttpError(400, "餐後照的時間不能早於餐前照");
    }

    const photo = await ingestPhoto({
      userId,
      mealRecordId: mealRecord.id,
      phase: "POST_MEAL",
      photo: {
        buffer: req.file.buffer,
        originalFileName: req.file.originalname,
        mimeType: req.file.mimetype,
        capturedAt: postMealAt,
        tzOffsetMinutes: body.tzOffsetMinutes ?? null,
        deviceUserAgent: req.headers["user-agent"] ?? null,
      },
    });

    const mealDurationSeconds = Math.round((postMealAt.getTime() - mealRecord.preMealAt.getTime()) / 1000);

    const updated = await prisma.mealRecord.update({
      where: { id: mealRecord.id },
      data: { status: "COMPLETED", postMealAt, mealDurationSeconds },
    });

    await handleMealCompleted({
      userId,
      mealRecordId: mealRecord.id,
      mealType: mealRecord.mealType,
      postMealAt,
      tzOffsetMinutes: body.tzOffsetMinutes ?? null,
    });

    const gamification = await getGamificationSummary(userId);

    res.status(200).json({ mealRecord: updated, photo, gamification });
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
