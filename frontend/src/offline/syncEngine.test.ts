import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetDbForTests } from "./db";
import { attachPostPhoto, createLocalMeal, getLocalMeal, listLocalMeals } from "./mealStore";
import { requestSync, resetSyncEngineForTests, syncAndWait } from "./syncEngine";
import { useSyncStore } from "./syncStore";
import { useAuthStore } from "../store/auth";
import { deferred, FakeServer } from "../test/fakeServer";

const photo = (name = "a.jpg") => new File([new Uint8Array([1, 2, 3, 4])], name, { type: "image/jpeg" });
const user = { id: "u1", email: "a@b.c", displayName: "小明", role: "PATIENT" as const };

let server: FakeServer;

function login() {
  useAuthStore.getState().setSession(user, "access-1", "refresh-1");
}

async function newMeal(iso = "2026-09-01T04:00:00.000Z") {
  return createLocalMeal({ userId: "u1", mealType: "LUNCH", notes: null, file: photo(), capturedAt: new Date(iso) });
}

beforeEach(async () => {
  await resetDbForTests();
  resetSyncEngineForTests();
  useSyncStore.setState({ phase: "idle", pendingCount: 0, failedCount: 0, nextRetryAt: null, lastBatch: null, lastRecovery: null, lastGamification: null });
  useAuthStore.getState().clearAuth();
  server = new FakeServer();
  server.install();
  login();
});

afterEach(() => {
  resetSyncEngineForTests();
  vi.unstubAllGlobals();
});

describe("線上", () => {
  it("送出一筆後立刻上傳成功 → synced", async () => {
    const m = await newMeal();
    expect(await syncAndWait(m.id)).toBe("synced");
    expect(server.meals.get(m.id)?.status).toBe("AWAITING_POST_PHOTO");
    expect(useSyncStore.getState().phase).toBe("idle");
    expect(useSyncStore.getState().pendingCount).toBe(0);
  });

  it("餐後照上傳成功後，拿得到伺服器算好的點數", async () => {
    const m = await newMeal();
    await syncAndWait(m.id);
    await attachPostPhoto({ userId: "u1", mealId: m.id, file: photo("b.jpg"), capturedAt: new Date("2026-09-01T04:20:00.000Z") });
    expect(await syncAndWait(m.id)).toBe("synced");
    expect(useSyncStore.getState().lastGamification?.totalPoints).toBe(25);
  });

  it("伺服器明確拒絕照片 (400) → 回傳失敗原因", async () => {
    const m = await newMeal();
    server.fail("POST /meals/pre-meal", 400, { error: "只接受 JPEG / PNG / WEBP / HEIC 格式的照片" });
    expect(await syncAndWait(m.id)).toEqual({ failed: "只接受 JPEG / PNG / WEBP / HEIC 格式的照片" });
  });
});

describe("離線", () => {
  it("離線送出：資料存在本機、回 pending、狀態變成 offline 並排了重試；網路回來後補傳成功並記錄恢復", async () => {
    server.offline = true;
    const m = await newMeal();

    expect(await syncAndWait(m.id)).toBe("pending");
    expect(useSyncStore.getState().phase).toBe("offline");
    expect(useSyncStore.getState().pendingCount).toBe(1);
    expect(useSyncStore.getState().nextRetryAt).toBeGreaterThan(Date.now());
    expect((await getLocalMeal(m.id))?.pre?.file).not.toBeNull();

    server.offline = false;
    const r = await requestSync({ force: true });
    expect(r?.processed).toBe(1);
    expect(useSyncStore.getState().phase).toBe("idle");
    expect(useSyncStore.getState().pendingCount).toBe(0);
    expect(useSyncStore.getState().lastRecovery?.processed).toBe(1);
    expect(server.meals.has(m.id)).toBe(true);
  });

  it("離線好幾天累積多筆 (含餐後照)，網路回來一次補傳完，順序正確、點數只算一次", async () => {
    server.offline = true;
    const a = await newMeal("2026-09-01T04:00:00.000Z");
    await attachPostPhoto({ userId: "u1", mealId: a.id, file: photo("a2.jpg"), capturedAt: new Date("2026-09-01T04:20:00.000Z") });
    const b = await newMeal("2026-09-02T04:00:00.000Z");
    await attachPostPhoto({ userId: "u1", mealId: b.id, file: photo("b2.jpg"), capturedAt: new Date("2026-09-02T04:25:00.000Z") });
    await requestSync({ force: true });
    expect(useSyncStore.getState().pendingCount).toBe(2);

    server.offline = false;
    server.requests = [];
    await requestSync({ force: true });

    expect(server.requests).toEqual([
      "POST /meals/pre-meal",
      `POST /meals/${a.id}/post-meal`,
      "POST /meals/pre-meal",
      `POST /meals/${b.id}/post-meal`,
    ]);
    expect(server.points).toBe(50);
    expect(useSyncStore.getState().pendingCount).toBe(0);
  });

  it("退避等待期間，一般的同步請求不會打伺服器；強制同步 (網路恢復/手動按) 會", async () => {
    server.offline = true;
    await newMeal();
    await requestSync({ force: true });
    server.offline = false;
    server.requests = [];

    expect(await requestSync()).toBeNull();
    expect(server.requests).toEqual([]);
    expect((await requestSync({ force: true }))?.processed).toBe(1);
  });
});

describe("登入狀態", () => {
  it("沒登入時不會上傳，狀態是 paused-auth，本機資料完好", async () => {
    const m = await newMeal();
    useAuthStore.getState().clearAuth();
    expect(await requestSync({ force: true })).toBeNull();
    expect(useSyncStore.getState().phase).toBe("paused-auth");
    expect(server.requests).toEqual([]);
    expect((await getLocalMeal(m.id))?.pre?.file).not.toBeNull();
  });

  it("access token 過期但 refresh 成功：自動換發後繼續上傳", async () => {
    const m = await newMeal();
    useAuthStore.getState().setSession(user, "expired", "refresh-1");
    await requestSync({ force: true });
    expect(server.meals.has(m.id)).toBe(true);
    expect(useAuthStore.getState().accessToken).toBe("access-2");
  });

  it("refresh token 也失效：停在 paused-auth，本機資料完整保留；重新登入後接著補傳", async () => {
    const m = await newMeal();
    useAuthStore.getState().setSession(user, "expired", "dead-refresh");
    server.tokens.refresh.status = 401;

    await requestSync({ force: true });
    expect(useSyncStore.getState().phase).toBe("paused-auth");
    expect(useAuthStore.getState().accessToken).toBeNull(); // 確實被登出了
    expect(useSyncStore.getState().nextRetryAt).toBeNull(); // 不會白白重試
    expect((await listLocalMeals("u1")).length).toBe(1); // 但資料還在
    expect((await getLocalMeal(m.id))?.pre?.file).not.toBeNull();

    server.tokens.refresh.status = 200;
    login();
    await requestSync({ force: true });
    expect(server.meals.has(m.id)).toBe(true);
    expect(useSyncStore.getState().pendingCount).toBe(0);
  });

  it("refresh 時伺服器暫時掛掉 (500) 不會把使用者登出 (弱網/伺服器重啟時)", async () => {
    await newMeal();
    useAuthStore.getState().setSession(user, "expired", "refresh-1");
    server.tokens.refresh.status = 500;

    await requestSync({ force: true });
    expect(useAuthStore.getState().accessToken).toBe("expired"); // 沒被清掉
    expect(useAuthStore.getState().refreshToken).toBe("refresh-1");
    expect(useSyncStore.getState().phase).toBe("busy");
  });
});

describe("同時多個請求", () => {
  it("同時觸發多次同步只會上傳一次 (不會重複送出)", async () => {
    const m = await newMeal();
    await Promise.all([requestSync({ force: true }), requestSync({ force: true }), requestSync({ force: true })]);
    expect(server.requests.filter((r) => r === "POST /meals/pre-meal")).toHaveLength(1);
    expect(server.meals.has(m.id)).toBe(true);
  });

  it("上傳進行中又新增一筆：同一次同步結束前就會一併補傳，不用等下一次輪詢", async () => {
    const first = await newMeal("2026-09-01T04:00:00.000Z");
    const gate = deferred();
    server.gate = { match: "POST /meals/pre-meal", promise: gate.promise };

    const running = requestSync({ force: true });
    await vi.waitFor(() => expect(server.requests.length).toBe(1)); // 第一筆正卡在上傳中
    const second = await newMeal("2026-09-01T10:00:00.000Z");
    void requestSync(); // 新動作觸發的同步請求：只會標記「跑完再來一輪」
    server.gate = null;
    gate.resolve();
    await running;

    expect(server.meals.has(first.id)).toBe(true);
    expect(server.meals.has(second.id)).toBe(true);
  });
});

describe("重複送出 (回應遺失)", () => {
  it("伺服器已經收到，但回應在路上遺失：重送後不會重複建立、不會重複發點數", async () => {
    const m = await newMeal();
    await attachPostPhoto({ userId: "u1", mealId: m.id, file: photo("b.jpg"), capturedAt: new Date("2026-09-01T04:20:00.000Z") });

    // 模擬：伺服器處理了餐前照，但手機拿不到回應 (網路在這一刻斷掉)
    const realFetch = globalThis.fetch;
    let dropped = false;
    vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
      const res = await realFetch(url, init);
      if (!dropped && url.endsWith("/meals/pre-meal")) {
        dropped = true;
        throw new TypeError("Failed to fetch");
      }
      return res;
    });

    await requestSync({ force: true });
    expect(server.meals.has(m.id)).toBe(true); // 伺服器其實收到了
    expect(useSyncStore.getState().pendingCount).toBe(1); // 但手機不知道，還當成沒上傳

    await requestSync({ force: true });
    expect(useSyncStore.getState().pendingCount).toBe(0);
    expect(server.points).toBe(25); // 10 + 15，餐前點數沒有因為重送而重複
    expect(server.requests.filter((r) => r === "POST /meals/pre-meal")).toHaveLength(2);
  });
});
