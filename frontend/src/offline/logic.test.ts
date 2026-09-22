import { describe, expect, it } from "vitest";
import { ApiError, NetworkError } from "../api/client";
import type { MealRecord } from "../api/types";
import { backoffMs, buildEvents, classifyError, deriveStatus, hasPendingWork, mergeMeals } from "./logic";
import { computeTargetSize } from "./util";
import type { LocalMeal, LocalPhotoSlot } from "./types";

function slot(capturedAt: string, over: Partial<LocalPhotoSlot> = {}): LocalPhotoSlot {
  return {
    capturedAt,
    tzOffsetMinutes: -480,
    capturedOffline: false,
    thumbDataUrl: null,
    file: { blob: new Blob(["x"]), name: "a.jpg", type: "image/jpeg" },
    synced: false,
    ...over,
  };
}

function meal(id: string, preAt: string, over: Partial<LocalMeal> = {}): LocalMeal {
  return {
    id,
    userId: "u1",
    mealType: "LUNCH",
    notes: null,
    preAt,
    pre: slot(preAt),
    post: null,
    abandon: null,
    remove: null,
    failure: null,
    attempts: 0,
    nextAttemptAt: 0,
    createdAtLocal: preAt,
    ...over,
  };
}

const server = (over: Partial<MealRecord> & { id: string }): MealRecord => ({
  mealType: "LUNCH",
  status: "AWAITING_POST_PHOTO",
  preMealAt: "2026-09-01T04:00:00.000Z",
  postMealAt: null,
  mealDurationSeconds: null,
  notes: null,
  createdAt: "2026-09-01T04:00:00.000Z",
  ...over,
});

describe("buildEvents", () => {
  it("依動作發生的時間排序，餐前照永遠在同一餐的餐後照之前", () => {
    const events = buildEvents(
      [
        meal("a", "2026-09-01T04:00:00Z", { post: slot("2026-09-01T04:30:00Z") }),
        meal("b", "2026-09-01T10:00:00Z", { post: slot("2026-09-01T10:20:00Z") }),
      ],
      Date.now()
    );
    expect(events.map((e) => `${e.mealId}:${e.kind}`)).toEqual(["a:PRE", "a:POST", "b:PRE", "b:POST"]);
  });

  it("連續天數情境：第 1 天餐前、第 3 天才補餐後的那一餐，不能搶在第 2 天的完整紀錄前面完成", () => {
    const events = buildEvents(
      [
        meal("late", "2026-09-01T15:50:00Z", { post: slot("2026-09-03T04:00:00Z") }),
        meal("mid", "2026-09-02T04:00:00Z", { post: slot("2026-09-02T04:30:00Z") }),
      ],
      Date.now()
    );
    expect(events.map((e) => `${e.mealId}:${e.kind}`)).toEqual(["late:PRE", "mid:PRE", "mid:POST", "late:POST"]);
  });

  it("時間相同時 PRE 在 POST 前面、放棄與刪除在最後", () => {
    const t = "2026-09-01T04:00:00Z";
    const events = buildEvents(
      [meal("a", t, { post: slot(t), remove: { requestedAt: t, synced: false } })],
      Date.now()
    );
    expect(events.map((e) => e.kind)).toEqual(["PRE", "POST", "DELETE"]);
  });

  it("失敗的、或還在等待重試的整筆紀錄不排進佇列 (它的餐後照不會在餐前照之前被送出)", () => {
    const now = 1_000_000;
    const events = buildEvents(
      [
        meal("failed", "2026-09-01T04:00:00Z", {
          post: slot("2026-09-01T04:30:00Z"),
          failure: { kind: "permanent", message: "x", at: "" },
        }),
        meal("waiting", "2026-09-01T05:00:00Z", { post: slot("2026-09-01T05:30:00Z"), nextAttemptAt: now + 5000 }),
        meal("ok", "2026-09-01T06:00:00Z"),
      ],
      now
    );
    expect(events.map((e) => e.mealId)).toEqual(["ok"]);
  });

  it("已上傳的部分不會再排進去", () => {
    const events = buildEvents(
      [meal("a", "2026-09-01T04:00:00Z", { pre: slot("2026-09-01T04:00:00Z", { synced: true, file: null }), post: slot("2026-09-01T04:30:00Z") })],
      Date.now()
    );
    expect(events.map((e) => e.kind)).toEqual(["POST"]);
  });
});

describe("classifyError", () => {
  it("連不上伺服器 → network", () => {
    expect(classifyError(new NetworkError(), "PRE").type).toBe("network");
  });
  it.each([408, 425, 429, 502, 503, 504, 521, 522, 524, 530])("%i → transient (停整條佇列稍後重試)", (status) => {
    expect(classifyError(new ApiError(status, "x"), "POST").type).toBe("transient");
  });
  it("401 → auth", () => {
    expect(classifyError(new ApiError(401, "x"), "PRE").type).toBe("auth");
  });
  it("500 → suspect (只跳過這一筆)", () => {
    expect(classifyError(new ApiError(500, "x"), "PRE").type).toBe("suspect");
  });
  it.each([400, 403, 409, 413, 422])("%i → permanent", (status) => {
    expect(classifyError(new ApiError(status, "bad"), "PRE").type).toBe("permanent");
  });
  it("404：餐後照 → permanent；刪除 → moot；放棄 → moot", () => {
    expect(classifyError(new ApiError(404, "x"), "POST").type).toBe("permanent");
    expect(classifyError(new ApiError(404, "x"), "DELETE").type).toBe("moot");
    expect(classifyError(new ApiError(404, "x"), "ABANDON").type).toBe("moot");
  });
  it("放棄遇到 409 (別支手機已經完成了) → moot；餐前遇到 409 → permanent", () => {
    expect(classifyError(new ApiError(409, "x"), "ABANDON").type).toBe("moot");
    expect(classifyError(new ApiError(409, "x"), "PRE").type).toBe("permanent");
  });
  it("未預期的例外 → suspect，不丟資料也不無限重試", () => {
    expect(classifyError(new Error("boom"), "PRE").type).toBe("suspect");
  });
});

describe("backoffMs", () => {
  it("指數成長並在 5 分鐘封頂", () => {
    const mid = () => 0.5; // 抖動係數剛好 1.0
    expect(backoffMs(1, mid)).toBe(5_000);
    expect(backoffMs(2, mid)).toBe(10_000);
    expect(backoffMs(3, mid)).toBe(20_000);
    expect(backoffMs(30, mid)).toBe(300_000);
  });
  it("抖動在 ±20% 內", () => {
    expect(backoffMs(1, () => 0)).toBe(4_000);
    expect(backoffMs(1, () => 1)).toBe(6_000);
  });
});

describe("hasPendingWork / deriveStatus", () => {
  it("全部上傳完才算沒有待辦", () => {
    const synced = slot("2026-09-01T04:00:00Z", { synced: true, file: null });
    expect(hasPendingWork(meal("a", "2026-09-01T04:00:00Z", { pre: synced }))).toBe(false);
    expect(hasPendingWork(meal("a", "2026-09-01T04:00:00Z", { pre: synced, post: slot("2026-09-01T05:00:00Z") }))).toBe(true);
    expect(hasPendingWork(meal("a", "2026-09-01T04:00:00Z", { pre: null, post: null }))).toBe(false);
  });
  it("狀態由本機動作推導：放棄 > 有餐後照 > 等待餐後照", () => {
    expect(deriveStatus(meal("a", "2026-09-01T04:00:00Z"))).toBe("AWAITING_POST_PHOTO");
    expect(deriveStatus(meal("a", "2026-09-01T04:00:00Z", { post: slot("2026-09-01T05:00:00Z") }))).toBe("COMPLETED");
    expect(deriveStatus(meal("a", "2026-09-01T04:00:00Z", { abandon: { requestedAt: "x", synced: false } }))).toBe("ABANDONED");
  });
});

describe("mergeMeals", () => {
  it("只有伺服器資料時原樣顯示、標記為已同步", () => {
    const views = mergeMeals([server({ id: "s1" })], []);
    expect(views).toHaveLength(1);
    expect(views[0].sync).toBe("synced");
  });

  it("本機還沒上傳的紀錄 (伺服器不認識) 會出現在列表，標記待上傳，且依時間新到舊排序", () => {
    const views = mergeMeals(
      [server({ id: "s1", preMealAt: "2026-09-01T04:00:00.000Z" })],
      [meal("l1", "2026-09-02T04:00:00.000Z")]
    );
    expect(views.map((v) => v.id)).toEqual(["l1", "s1"]);
    expect(views[0].sync).toBe("pending");
  });

  it("使用者已要求刪除的紀錄，即使伺服器還有也先藏起來", () => {
    const views = mergeMeals(
      [server({ id: "s1" })],
      [meal("s1", "2026-09-01T04:00:00.000Z", { pre: null, remove: { requestedAt: "x", synced: false } })]
    );
    expect(views).toHaveLength(0);
  });

  it("離線完成的餐後照：即使快取的伺服器資料還停在等待餐後照，也顯示為已完成並算出時長", () => {
    const views = mergeMeals(
      [server({ id: "s1", preMealAt: "2026-09-01T04:00:00.000Z" })],
      [
        meal("s1", "2026-09-01T04:00:00.000Z", {
          pre: slot("2026-09-01T04:00:00.000Z", { synced: true, file: null }),
          post: slot("2026-09-01T04:25:00.000Z"),
        }),
      ]
    );
    expect(views[0].status).toBe("COMPLETED");
    expect(views[0].mealDurationSeconds).toBe(25 * 60);
    expect(views[0].sync).toBe("pending");
  });

  it("本機已全部上傳、伺服器也有 → 以伺服器為準，只借用本機縮圖", () => {
    const synced = slot("2026-09-01T04:00:00.000Z", { synced: true, file: null, thumbDataUrl: "data:thumb" });
    const views = mergeMeals(
      [server({ id: "s1", status: "COMPLETED", mealDurationSeconds: 999, photos: [] })],
      [meal("s1", "2026-09-01T04:00:00.000Z", { pre: synced })]
    );
    expect(views[0].mealDurationSeconds).toBe(999);
    expect(views[0].preThumbDataUrl).toBe("data:thumb");
    expect(views[0].sync).toBe("synced");
  });

  it("上傳失敗的紀錄標記 failed 並帶出原因", () => {
    const views = mergeMeals([], [meal("l1", "2026-09-01T04:00:00.000Z", { failure: { kind: "permanent", message: "照片格式不對", at: "" } })]);
    expect(views[0].sync).toBe("failed");
    expect(views[0].failureMessage).toBe("照片格式不對");
  });
});

describe("computeTargetSize（上傳前縮圖尺寸）", () => {
  it("超過上限的照片等比例縮到最長邊", () => {
    expect(computeTargetSize(4000, 3000, 1600)).toEqual({ width: 1600, height: 1200, changed: true });
    expect(computeTargetSize(3000, 4000, 1600)).toEqual({ width: 1200, height: 1600, changed: true });
  });

  it("本來就比上限小的不放大（放大只會變糊又變大）", () => {
    expect(computeTargetSize(800, 600, 1600)).toEqual({ width: 800, height: 600, changed: false });
    expect(computeTargetSize(1600, 900, 1600)).toEqual({ width: 1600, height: 900, changed: false });
  });

  it("極端長寬比不會算出 0 像素", () => {
    const r = computeTargetSize(8000, 3, 1600);
    expect(r.width).toBe(1600);
    expect(r.height).toBeGreaterThanOrEqual(1);
  });

  it("4K 照片壓縮後像素量約為原本的 1/6，這是容量下降的主因", () => {
    const before = 3840 * 2160;
    const t = computeTargetSize(3840, 2160, 1600);
    expect((t.width * t.height) / before).toBeLessThan(0.2);
  });
});
