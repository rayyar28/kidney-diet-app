import { beforeEach, describe, expect, it } from "vitest";
import { ApiError, NetworkError } from "../api/client";
import type { GamificationSummary } from "../api/types";
import { resetDbForTests } from "./db";
import { attachPostPhoto, createLocalMeal, getLocalMeal, listLocalMeals, requestAbandon, requestRemove } from "./mealStore";
import { runSyncOnce, type SyncTransport } from "./syncRunner";

const photo = (bytes = 4) => new File([new Uint8Array(bytes)], "a.jpg", { type: "image/jpeg" });
const summary = (points: number): GamificationSummary => ({
  totalPoints: points,
  currentStreakDays: 1,
  longestStreakDays: 1,
  badges: [],
});

/** 可以編劇本的假伺服器傳輸層：記錄每次呼叫，並能在指定的動作上丟出指定的錯誤 */
class FakeTransport implements SyncTransport {
  calls: string[] = [];
  sent: Array<{ kind: string; id: string; capturedAt?: string; size?: number; sentAt: string }> = [];
  private failures = new Map<string, unknown[]>();
  down: unknown | null = null;
  points = 0;

  failNext(kind: string, mealId: string, ...errors: unknown[]) {
    this.failures.set(`${kind}:${mealId}`, errors);
  }
  private hit(kind: string, id: string) {
    this.calls.push(`${kind}:${id}`);
    if (this.down) throw this.down;
    const q = this.failures.get(`${kind}:${id}`);
    if (q?.length) throw q.shift();
  }
  async uploadPre(meal: Parameters<SyncTransport["uploadPre"]>[0], file: File, sentAt: string) {
    this.hit("PRE", meal.id);
    this.sent.push({ kind: "PRE", id: meal.id, capturedAt: meal.pre!.capturedAt, size: file.size, sentAt });
    return {};
  }
  async uploadPost(meal: Parameters<SyncTransport["uploadPost"]>[0], file: File, sentAt: string) {
    this.hit("POST", meal.id);
    this.sent.push({ kind: "POST", id: meal.id, capturedAt: meal.post!.capturedAt, size: file.size, sentAt });
    this.points += 25;
    return { gamification: summary(this.points) };
  }
  async abandon(id: string) {
    this.hit("ABANDON", id);
    return {};
  }
  async remove(id: string) {
    this.hit("DELETE", id);
    return {};
  }
}

async function capture(iso: string, userId = "u1") {
  return createLocalMeal({ userId, mealType: "LUNCH", notes: null, file: photo(), capturedAt: new Date(iso) });
}
async function complete(id: string, iso: string, userId = "u1") {
  return attachPostPhoto({ userId, mealId: id, file: photo(), capturedAt: new Date(iso) });
}
const run = (transport: FakeTransport, userId = "u1", now = () => Date.now()) => runSyncOnce({ userId, transport, now });

beforeEach(async () => {
  await resetDbForTests();
});

describe("正常上傳", () => {
  it("餐前 → 餐後依序上傳；成功後原始照片檔案被釋放、縮圖與中繼資料保留；回傳最新的點數", async () => {
    const m = await capture("2026-09-01T04:00:00.000Z");
    await complete(m.id, "2026-09-01T04:20:00.000Z");
    const t = new FakeTransport();

    const r = await run(t);

    expect(t.calls).toEqual([`PRE:${m.id}`, `POST:${m.id}`]);
    expect(r).toMatchObject({ processed: 2, postsCompleted: 1, stopped: "done" });
    expect(r.gamification?.totalPoints).toBe(25);
    const back = (await getLocalMeal(m.id))!;
    expect(back.pre).toMatchObject({ synced: true, file: null });
    expect(back.post).toMatchObject({ synced: true, file: null });
  });

  it("送出時帶的是拍照當下的時間 (不是上傳時間)，並附上送出當下的裝置時間", async () => {
    const m = await capture("2026-09-01T04:00:00.000Z");
    const t = new FakeTransport();
    await run(t);
    expect(t.sent[0].capturedAt).toBe("2026-09-01T04:00:00.000Z");
    expect(Math.abs(Date.parse(t.sent[0].sentAt) - Date.now())).toBeLessThan(5000);
    expect(t.sent[0].id).toBe(m.id);
  });

  it("沒有待辦時什麼都不做", async () => {
    const t = new FakeTransport();
    expect(await run(t)).toMatchObject({ processed: 0, stopped: "done" });
    expect(t.calls).toEqual([]);
  });

  it("只上傳目前登入使用者的紀錄", async () => {
    await capture("2026-09-01T04:00:00.000Z", "u1");
    const other = await capture("2026-09-01T05:00:00.000Z", "u2");
    const t = new FakeTransport();
    await run(t, "u1");
    expect(t.calls).toHaveLength(1);
    expect((await getLocalMeal(other.id))!.pre!.synced).toBe(false);
  });
});

describe("上傳順序 (連續天數靠它)", () => {
  it("跨餐依動作發生時間排序：第 3 天才補的餐後照，排在第 2 天的完整紀錄之後", async () => {
    const late = await capture("2026-09-01T15:50:00.000Z");
    await complete(late.id, "2026-09-03T04:00:00.000Z");
    const mid = await capture("2026-09-02T04:00:00.000Z");
    await complete(mid.id, "2026-09-02T04:30:00.000Z");
    const t = new FakeTransport();
    await run(t);
    expect(t.calls).toEqual([`PRE:${late.id}`, `PRE:${mid.id}`, `POST:${mid.id}`, `POST:${late.id}`]);
  });
});

describe("沒有網路 / 連不上伺服器", () => {
  it("停下整條佇列、資料原封不動保留、照片標記為離線拍攝；網路回來後補傳成功", async () => {
    const a = await capture("2026-09-01T04:00:00.000Z");
    const b = await capture("2026-09-01T10:00:00.000Z");
    const t = new FakeTransport();
    t.down = new NetworkError();

    const r1 = await run(t);
    expect(r1).toMatchObject({ processed: 0, stopped: "network" });
    expect(t.calls).toEqual([`PRE:${a.id}`]); // 第一筆就連不上，後面的不再嘗試
    const after = (await getLocalMeal(a.id))!;
    expect(after.failure).toBeNull();
    expect(after.pre?.synced).toBe(false);
    expect(after.pre?.file?.blob.size).toBe(4); // 原始照片還在
    expect(after.pre?.capturedOffline).toBe(true);
    // 排在後面、根本還沒輪到嘗試的照片，同樣是在沒網路時拍的
    expect((await getLocalMeal(b.id))!.pre?.capturedOffline).toBe(true);

    t.down = null;
    t.calls = [];
    const r2 = await run(t);
    expect(r2).toMatchObject({ processed: 2, stopped: "done" });
    expect(t.calls).toEqual([`PRE:${a.id}`, `PRE:${b.id}`]);
    expect((await getLocalMeal(a.id))!.pre?.synced).toBe(true);
  });

  it("回應在路上遺失 (伺服器其實收到了)：重送同一筆，用的是同一個 id 與同樣的內容", async () => {
    const m = await capture("2026-09-01T04:00:00.000Z");
    const t = new FakeTransport();
    // 假裝伺服器處理完了，但回應沒到手機：手機看到的是網路錯誤
    const realPre = t.uploadPre.bind(t);
    let first = true;
    t.uploadPre = async (meal, file, sentAt) => {
      await realPre(meal, file, sentAt);
      if (first) {
        first = false;
        throw new NetworkError();
      }
      return {};
    };
    expect(await run(t)).toMatchObject({ stopped: "network" });
    expect(await run(t)).toMatchObject({ processed: 1, stopped: "done" });
    const sends = t.sent.filter((s) => s.kind === "PRE");
    expect(sends).toHaveLength(2);
    expect(sends[1].id).toBe(sends[0].id);
    expect(sends[1].capturedAt).toBe(sends[0].capturedAt);
    expect(sends[1].size).toBe(sends[0].size);
    expect(sends[0].id).toBe(m.id);
  });
});

describe("伺服器暫時有問題", () => {
  it.each([429, 502, 503, 504])("%i：停下整條佇列稍後再試，不算失敗", async (status) => {
    const a = await capture("2026-09-01T04:00:00.000Z");
    await capture("2026-09-01T05:00:00.000Z");
    const t = new FakeTransport();
    t.failNext("PRE", a.id, new ApiError(status, "busy"));
    expect(await run(t)).toMatchObject({ stopped: "transient", processed: 0 });
    expect((await getLocalMeal(a.id))!.failure).toBeNull();
  });

  it("登入失效 (401)：停下整條佇列，資料保留", async () => {
    const a = await capture("2026-09-01T04:00:00.000Z");
    const t = new FakeTransport();
    t.failNext("PRE", a.id, new ApiError(401, "expired"));
    expect(await run(t)).toMatchObject({ stopped: "auth", processed: 0 });
    expect((await getLocalMeal(a.id))!.pre?.file).not.toBeNull();
  });

  it("單一筆一直回 500：先跳過這一筆 (不擋住後面的)、退避等待，累計 5 次後暫停等人處理", async () => {
    const bad = await capture("2026-09-01T04:00:00.000Z");
    const good = await capture("2026-09-01T05:00:00.000Z");
    const t = new FakeTransport();
    t.failNext("PRE", bad.id, ...Array.from({ length: 10 }, () => new ApiError(500, "boom")));

    let clock = 1_000_000;
    const r = await run(t, "u1", () => clock);
    expect(r.stopped).toBe("done");
    expect((await getLocalMeal(good.id))!.pre?.synced).toBe(true); // 後面的照常上傳
    const afterFirst = (await getLocalMeal(bad.id))!;
    expect(afterFirst.attempts).toBe(1);
    expect(afterFirst.nextAttemptAt).toBeGreaterThan(clock); // 退避中

    // 退避時間內再跑一輪：不會再打這一筆
    t.calls = [];
    await run(t, "u1", () => clock);
    expect(t.calls).toEqual([]);

    // 每次退避結束再試，連續 5 次 → 暫停
    for (let i = 0; i < 4; i++) {
      clock += 10 * 60_000;
      await run(t, "u1", () => clock);
    }
    const final = (await getLocalMeal(bad.id))!;
    expect(final.failure?.kind).toBe("stalled");
    expect(final.pre?.file).not.toBeNull(); // 暫停不等於丟掉：照片還在，使用者可以重試
  });
});

describe("伺服器明確拒絕 (永久失敗)", () => {
  it("這一筆標記失敗並保留原因，其他紀錄繼續上傳；失敗那一餐的餐後照不會被送出", async () => {
    const bad = await capture("2026-09-01T04:00:00.000Z");
    await complete(bad.id, "2026-09-01T04:30:00.000Z");
    const good = await capture("2026-09-01T05:00:00.000Z");
    const t = new FakeTransport();
    t.failNext("PRE", bad.id, new ApiError(400, "只接受 JPEG / PNG / WEBP / HEIC 格式的照片"));

    const r = await run(t);

    expect(r.stopped).toBe("done");
    const failed = (await getLocalMeal(bad.id))!;
    expect(failed.failure).toMatchObject({ kind: "permanent", message: "只接受 JPEG / PNG / WEBP / HEIC 格式的照片" });
    expect(t.calls).not.toContain(`POST:${bad.id}`);
    expect((await getLocalMeal(good.id))!.pre?.synced).toBe(true);
  });

  it("餐前已上傳、餐後照被拒絕：失敗只標在這一筆", async () => {
    const m = await capture("2026-09-01T04:00:00.000Z");
    await complete(m.id, "2026-09-01T04:30:00.000Z");
    const t = new FakeTransport();
    t.failNext("POST", m.id, new ApiError(409, "已經有另一張不同的照片"));
    await run(t);
    const back = (await getLocalMeal(m.id))!;
    expect(back.pre?.synced).toBe(true);
    expect(back.failure?.kind).toBe("permanent");
  });
});

describe("放棄與刪除", () => {
  it("刪除一筆還沒上傳的紀錄：先把資料上傳 (研究資料保留)，再通知伺服器刪除，最後清掉本機這筆", async () => {
    const m = await capture("2026-09-01T04:00:00.000Z");
    await requestRemove({ userId: "u1", mealId: m.id });
    const t = new FakeTransport();
    await run(t);
    expect(t.calls).toEqual([`PRE:${m.id}`, `DELETE:${m.id}`]);
    expect(await getLocalMeal(m.id)).toBeUndefined();
  });

  it("刪除時伺服器說找不到 (404) → 視為已完成，不當成失敗", async () => {
    const serverMeal = { id: "gone", mealType: "LUNCH" as const, notes: null, preMealAt: "2026-09-01T04:00:00.000Z" };
    await requestRemove({ userId: "u1", mealId: "gone", serverMeal });
    const t = new FakeTransport();
    t.failNext("DELETE", "gone", new ApiError(404, "找不到"));
    await run(t);
    expect(await getLocalMeal("gone")).toBeUndefined();
    expect((await listLocalMeals("u1")).length).toBe(0);
  });

  it("放棄時伺服器說已經不是等待餐後照 (409，例如在別支手機完成了) → 視為已完成", async () => {
    const serverMeal = { id: "x", mealType: "LUNCH" as const, notes: null, preMealAt: "2026-09-01T04:00:00.000Z" };
    await requestAbandon({ userId: "u1", mealId: "x", serverMeal });
    const t = new FakeTransport();
    t.failNext("ABANDON", "x", new ApiError(409, "只有還在等待餐後照的紀錄可以被放棄"));
    await run(t);
    const back = (await getLocalMeal("x"))!;
    expect(back.failure).toBeNull();
    expect(back.abandon?.synced).toBe(true);
  });
});

describe("上傳進行中使用者又有新動作", () => {
  it("上傳餐前照的同時使用者補拍了餐後照 → 同一輪就會接著把餐後照也傳完 (不必等下一次輪詢)", async () => {
    const m = await capture("2026-09-01T04:00:00.000Z");
    const t = new FakeTransport();
    const realPre = t.uploadPre.bind(t);
    t.uploadPre = async (meal, file, sentAt) => {
      await complete(m.id, "2026-09-01T04:20:00.000Z"); // 上傳途中使用者拍了餐後照
      return realPre(meal, file, sentAt);
    };
    const r = await run(t);
    expect(t.calls).toEqual([`PRE:${m.id}`, `POST:${m.id}`]);
    expect(r.postsCompleted).toBe(1);
    const back = (await getLocalMeal(m.id))!;
    expect(back.pre?.synced).toBe(true);
    expect(back.post?.synced).toBe(true);
  });

  it("上傳途中使用者按了「放棄」：不會被同步完成的寫入蓋掉", async () => {
    const m = await capture("2026-09-01T04:00:00.000Z");
    const t = new FakeTransport();
    const realPre = t.uploadPre.bind(t);
    t.uploadPre = async (meal, file, sentAt) => {
      await requestAbandon({ userId: "u1", mealId: m.id });
      return realPre(meal, file, sentAt);
    };
    await run(t);
    expect(t.calls).toEqual([`PRE:${m.id}`, `ABANDON:${m.id}`]);
    expect((await getLocalMeal(m.id))!.abandon).toMatchObject({ synced: true });
  });
});

describe("強制同步 (使用者手動按 / 網路恢復)", () => {
  it("略過「這一筆還在退避等待」的限制立刻再試，但同一輪對同一筆只試一次", async () => {
    const bad = await capture("2026-09-01T04:00:00.000Z");
    const t = new FakeTransport();
    t.failNext("PRE", bad.id, ...Array.from({ length: 10 }, () => new ApiError(500, "boom")));

    const clock = 1_000_000;
    await run(t, "u1", () => clock); // 第一次：失敗，進入退避
    expect((await getLocalMeal(bad.id))!.attempts).toBe(1);

    t.calls = [];
    await runSyncOnce({ userId: "u1", transport: t, now: () => clock }); // 不強制：退避中，不會打
    expect(t.calls).toEqual([]);

    await runSyncOnce({ userId: "u1", transport: t, now: () => clock, ignoreBackoff: true }); // 強制：立刻再試
    expect(t.calls).toEqual([`PRE:${bad.id}`]); // 只試一次，不會在同一輪連續重試到暫停
    expect((await getLocalMeal(bad.id))!.attempts).toBe(2);
    expect((await getLocalMeal(bad.id))!.failure).toBeNull();
  });
});

describe("暫停門檻", () => {
  it("短時間內連續失敗很多次 (伺服器重啟中、App 被連續觸發同步) 不會把這一筆暫停", async () => {
    const bad = await capture("2026-09-01T04:00:00.000Z");
    const t = new FakeTransport();
    t.failNext("PRE", bad.id, ...Array.from({ length: 20 }, () => new ApiError(500, "boom")));
    const clock = 1_000_000;
    for (let i = 0; i < 8; i++) {
      await runSyncOnce({ userId: "u1", transport: t, now: () => clock, ignoreBackoff: true });
    }
    const back = (await getLocalMeal(bad.id))!;
    expect(back.attempts).toBe(8);
    expect(back.failure).toBeNull();
  });

  it("成功上傳後清掉失敗計數，之後再遇到問題重新累計", async () => {
    const m = await capture("2026-09-01T04:00:00.000Z");
    const t = new FakeTransport();
    t.failNext("PRE", m.id, new ApiError(500, "boom"));
    await run(t, "u1", () => 1_000_000);
    expect((await getLocalMeal(m.id))!.firstSuspectAt).toBe(1_000_000);
    await runSyncOnce({ userId: "u1", transport: t, now: () => 1_000_000, ignoreBackoff: true });
    const back = (await getLocalMeal(m.id))!;
    expect(back.pre?.synced).toBe(true);
    expect(back.attempts).toBe(0);
    expect(back.firstSuspectAt).toBeUndefined();
  });
});

describe("離線標記", () => {
  it("斷網當下，佇列裡排在後面的餐後照 (離線期間才拍的) 也會被標記為離線拍攝", async () => {
    const m = await capture("2026-09-01T04:00:00.000Z");
    const t = new FakeTransport();
    t.down = new NetworkError();
    await run(t); // 餐前照就連不上
    await complete(m.id, "2026-09-01T04:20:00.000Z"); // 離線期間補拍餐後照
    await run(t);
    const back = (await getLocalMeal(m.id))!;
    expect(back.pre?.capturedOffline).toBe(true);
    expect(back.post?.capturedOffline).toBe(true);
  });

  it("已經上傳成功的照片不會被回頭標成離線", async () => {
    const a = await capture("2026-09-01T04:00:00.000Z");
    const t = new FakeTransport();
    await run(t); // a 成功上傳
    const b = await capture("2026-09-01T05:00:00.000Z");
    t.down = new NetworkError();
    await run(t);
    expect((await getLocalMeal(a.id))!.pre?.capturedOffline).toBe(false);
    expect((await getLocalMeal(b.id))!.pre?.capturedOffline).toBe(true);
  });
});
