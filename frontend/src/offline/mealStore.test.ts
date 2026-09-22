import { beforeEach, describe, expect, it } from "vitest";
import { resetDbForTests } from "./db";
import {
  attachPostPhoto,
  createLocalMeal,
  deleteLocalMeal,
  discardFailedMeal,
  getLocalMeal,
  listLocalMeals,
  loadServerCache,
  mutateMeal,
  onLocalChange,
  pruneSyncedMeals,
  requestAbandon,
  requestRemove,
  saveServerCache,
} from "./mealStore";

const photo = (name = "a.jpg") => new File([new Uint8Array([1, 2, 3, 4])], name, { type: "image/jpeg" });
const at = (iso: string) => new Date(iso);

beforeEach(async () => {
  await resetDbForTests();
});

describe("createLocalMeal", () => {
  it("寫進本機後可以讀回，照片檔案與拍攝時間都在", async () => {
    const m = await createLocalMeal({
      userId: "u1",
      mealType: "LUNCH",
      notes: "外食",
      file: photo(),
      capturedAt: at("2026-09-01T04:00:00.000Z"),
    });
    const back = await getLocalMeal(m.id);
    expect(back?.mealType).toBe("LUNCH");
    expect(back?.notes).toBe("外食");
    expect(back?.preAt).toBe("2026-09-01T04:00:00.000Z");
    expect(back?.pre?.synced).toBe(false);
    expect(back?.pre?.file?.blob.size).toBe(4);
    expect(back?.pre?.file?.name).toBe("a.jpg");
  });

  it("id 是合法的 UUID (後端用它當用餐紀錄 id)", async () => {
    const m = await createLocalMeal({ userId: "u1", mealType: "LUNCH", notes: null, file: photo(), capturedAt: new Date() });
    expect(m.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it("每位使用者只看得到自己的紀錄", async () => {
    await createLocalMeal({ userId: "u1", mealType: "LUNCH", notes: null, file: photo(), capturedAt: new Date() });
    await createLocalMeal({ userId: "u2", mealType: "DINNER", notes: null, file: photo(), capturedAt: new Date() });
    expect((await listLocalMeals("u1")).map((m) => m.mealType)).toEqual(["LUNCH"]);
    expect((await listLocalMeals("u2")).map((m) => m.mealType)).toEqual(["DINNER"]);
  });

  it("寫入後會通知訂閱者", async () => {
    let calls = 0;
    const off = onLocalChange(() => calls++);
    await createLocalMeal({ userId: "u1", mealType: "LUNCH", notes: null, file: photo(), capturedAt: new Date() });
    off();
    expect(calls).toBeGreaterThan(0);
  });
});

describe("attachPostPhoto", () => {
  it("幫本機的紀錄補餐後照", async () => {
    const m = await createLocalMeal({ userId: "u1", mealType: "LUNCH", notes: null, file: photo(), capturedAt: at("2026-09-01T04:00:00.000Z") });
    const updated = await attachPostPhoto({ userId: "u1", mealId: m.id, file: photo("b.jpg"), capturedAt: at("2026-09-01T04:20:00.000Z") });
    expect(updated.post?.capturedAt).toBe("2026-09-01T04:20:00.000Z");
    expect(updated.pre?.synced).toBe(false);
  });

  it("本機沒有的紀錄 (伺服器上的) 會建一個殼，不需要餐前照", async () => {
    const updated = await attachPostPhoto({
      userId: "u1",
      mealId: "server-meal",
      serverMeal: { id: "server-meal", mealType: "DINNER", notes: null, preMealAt: "2026-09-01T10:00:00.000Z" },
      file: photo(),
      capturedAt: at("2026-09-01T10:30:00.000Z"),
    });
    expect(updated.pre).toBeNull();
    expect(updated.preAt).toBe("2026-09-01T10:00:00.000Z");
    expect(updated.post).not.toBeNull();
  });

  it("本機沒有、也沒給伺服器資料 → 明確的錯誤", async () => {
    await expect(attachPostPhoto({ userId: "u1", mealId: "nope", file: photo(), capturedAt: new Date() })).rejects.toThrow("找不到這筆用餐紀錄");
  });

  it("不能對別人的紀錄補餐後照", async () => {
    const m = await createLocalMeal({ userId: "u1", mealType: "LUNCH", notes: null, file: photo(), capturedAt: new Date() });
    await expect(attachPostPhoto({ userId: "u2", mealId: m.id, file: photo(), capturedAt: new Date() })).rejects.toThrow("不屬於");
  });

  it("已經有餐後照、或已放棄/刪除的紀錄不能再補 (錯誤訊息完整保留)", async () => {
    const m = await createLocalMeal({ userId: "u1", mealType: "LUNCH", notes: null, file: photo(), capturedAt: new Date() });
    await attachPostPhoto({ userId: "u1", mealId: m.id, file: photo(), capturedAt: new Date() });
    await expect(attachPostPhoto({ userId: "u1", mealId: m.id, file: photo(), capturedAt: new Date() })).rejects.toThrow("已經有餐後照");

    const m2 = await createLocalMeal({ userId: "u1", mealType: "LUNCH", notes: null, file: photo(), capturedAt: new Date() });
    await requestAbandon({ userId: "u1", mealId: m2.id });
    await expect(attachPostPhoto({ userId: "u1", mealId: m2.id, file: photo(), capturedAt: new Date() })).rejects.toThrow("已被放棄或刪除");
  });
});

describe("requestAbandon / requestRemove", () => {
  it("放棄與刪除都只是先記下要求，等同步時才通知伺服器；重複要求不會覆蓋第一次的時間", async () => {
    const m = await createLocalMeal({ userId: "u1", mealType: "LUNCH", notes: null, file: photo(), capturedAt: new Date() });
    await requestAbandon({ userId: "u1", mealId: m.id });
    const first = (await getLocalMeal(m.id))!.abandon!.requestedAt;
    await new Promise((r) => setTimeout(r, 5));
    await requestAbandon({ userId: "u1", mealId: m.id });
    expect((await getLocalMeal(m.id))!.abandon!.requestedAt).toBe(first);

    await requestRemove({ userId: "u1", mealId: m.id });
    expect((await getLocalMeal(m.id))!.remove).toMatchObject({ synced: false });
  });

  it("已經有餐後照的紀錄不能放棄", async () => {
    const m = await createLocalMeal({ userId: "u1", mealType: "LUNCH", notes: null, file: photo(), capturedAt: new Date() });
    await attachPostPhoto({ userId: "u1", mealId: m.id, file: photo(), capturedAt: new Date() });
    await expect(requestAbandon({ userId: "u1", mealId: m.id })).rejects.toThrow("不能放棄");
  });

  it("伺服器上的紀錄 (本機沒有) 也能放棄/刪除，會自動建殼", async () => {
    const serverMeal = { id: "s1", mealType: "LUNCH" as const, notes: null, preMealAt: "2026-09-01T04:00:00.000Z" };
    await requestRemove({ userId: "u1", mealId: "s1", serverMeal });
    expect((await getLocalMeal("s1"))?.remove).not.toBeNull();
  });
});

describe("discardFailedMeal", () => {
  it("伺服器從來沒收過的紀錄 (餐前照就失敗) → 整筆清掉", async () => {
    const m = await createLocalMeal({ userId: "u1", mealType: "LUNCH", notes: null, file: photo(), capturedAt: new Date() });
    await mutateMeal(m.id, (x) => ({ ...x, failure: { kind: "permanent", message: "x", at: "" } }));
    await discardFailedMeal(m.id);
    expect(await getLocalMeal(m.id)).toBeUndefined();
  });

  it("餐前照已上傳、只有餐後照失敗 → 只丟掉餐後照，紀錄退回等待餐後照", async () => {
    const m = await createLocalMeal({ userId: "u1", mealType: "LUNCH", notes: null, file: photo(), capturedAt: new Date() });
    await attachPostPhoto({ userId: "u1", mealId: m.id, file: photo(), capturedAt: new Date() });
    await mutateMeal(m.id, (x) => ({
      ...x,
      pre: { ...x.pre!, synced: true, file: null },
      failure: { kind: "permanent", message: "格式不對", at: "" },
    }));
    await discardFailedMeal(m.id);
    const back = (await getLocalMeal(m.id))!;
    expect(back.post).toBeNull();
    expect(back.failure).toBeNull();
    expect(back.pre?.synced).toBe(true);
  });
});

describe("pruneSyncedMeals", () => {
  it("只清已同步的舊紀錄；還沒上傳完或失敗的一律保留", async () => {
    const synced = (id: string, preAt: string) =>
      mutateMeal(id, (x) => ({ ...x, pre: { ...x.pre!, synced: true, file: null } }));

    const old = await createLocalMeal({ userId: "u1", mealType: "LUNCH", notes: null, file: photo(), capturedAt: at("2026-01-01T04:00:00.000Z") });
    await synced(old.id, "");
    const recent = await createLocalMeal({ userId: "u1", mealType: "LUNCH", notes: null, file: photo(), capturedAt: new Date() });
    await synced(recent.id, "");
    const pending = await createLocalMeal({ userId: "u1", mealType: "LUNCH", notes: null, file: photo(), capturedAt: at("2026-01-02T04:00:00.000Z") });
    const failed = await createLocalMeal({ userId: "u1", mealType: "LUNCH", notes: null, file: photo(), capturedAt: at("2026-01-03T04:00:00.000Z") });
    await mutateMeal(failed.id, (x) => ({ ...x, pre: { ...x.pre!, synced: true, file: null }, failure: { kind: "stalled", message: "x", at: "" } }));

    await pruneSyncedMeals("u1", { maxAgeDays: 60 });

    expect(await getLocalMeal(old.id)).toBeUndefined();
    expect(await getLocalMeal(recent.id)).toBeDefined();
    expect(await getLocalMeal(pending.id)).toBeDefined();
    expect(await getLocalMeal(failed.id)).toBeDefined();
  });

  it("超過保留數量時，清掉最舊的已同步紀錄", async () => {
    const ids: string[] = [];
    for (let i = 0; i < 4; i++) {
      const m = await createLocalMeal({ userId: "u1", mealType: "LUNCH", notes: null, file: photo(), capturedAt: new Date(Date.now() - i * 1000) });
      await mutateMeal(m.id, (x) => ({ ...x, pre: { ...x.pre!, synced: true, file: null } }));
      ids.push(m.id);
    }
    await pruneSyncedMeals("u1", { keep: 2 });
    expect((await listLocalMeals("u1")).map((m) => m.id).sort()).toEqual([ids[0], ids[1]].sort());
  });
});

describe("server cache", () => {
  it("可以分開更新 meals 與 summary，另一個欄位不會被洗掉", async () => {
    await saveServerCache("u1", { meals: [{ id: "m1" } as never] });
    await saveServerCache("u1", { summary: { totalPoints: 42 } as never });
    const cached = await loadServerCache("u1");
    expect(cached?.meals).toHaveLength(1);
    expect(cached?.summary?.totalPoints).toBe(42);
  });
  it("不同使用者的快取互不影響", async () => {
    await saveServerCache("u1", { summary: { totalPoints: 1 } as never });
    expect(await loadServerCache("u2")).toBeUndefined();
  });
});

describe("deleteLocalMeal", () => {
  it("刪除後讀不到", async () => {
    const m = await createLocalMeal({ userId: "u1", mealType: "LUNCH", notes: null, file: photo(), capturedAt: new Date() });
    await deleteLocalMeal(m.id);
    expect(await getLocalMeal(m.id)).toBeUndefined();
  });
});
