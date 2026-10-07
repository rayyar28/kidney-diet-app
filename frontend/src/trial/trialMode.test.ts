import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetDbForTests } from "../offline/db";
import { buildEvents, mergeMeals } from "../offline/logic";
import { POINTS, projectGamification } from "../gamification/replay";
import { attachPostPhoto, createLocalMeal, listLocalMeals, pruneSyncedMeals } from "../offline/mealStore";
import { refreshCounts, requestSync, resetSyncEngineForTests, syncAndWait } from "../offline/syncEngine";
import { useSyncStore } from "../offline/syncStore";
import type { MealView } from "../offline/types";
import { TRIAL_USER_ID, isTrialMode, useAuthStore } from "../store/auth";
import {
  clearTrialData,
  importTrialMeals,
  loadTrialProfile,
  markTrialImportAsked,
  pendingTrialImportCount,
  saveTrialProfile,
} from "./trialData";
import { asTrialViews } from "./views";

/*
 * 試用模式最重要的保證只有一句話：**不碰網路、不碰別人的資料**。
 * 這裡就是在守住這一句——如果哪天有人把同步引擎的判斷改掉，
 * 試用者拍的照片就會被送到伺服器上，這在還沒過 IRB 之前是不能發生的事。
 */

const photo = () => new File([new Uint8Array([1, 2, 3, 4])], "a.jpg", { type: "image/jpeg" });
const realUser = { id: "u1", email: "a@b.c", displayName: "小明", role: "PATIENT" as const };

let fetchSpy: ReturnType<typeof vi.fn>;

beforeEach(async () => {
  await resetDbForTests();
  resetSyncEngineForTests();
  useSyncStore.setState({ phase: "idle", pendingCount: 0, failedCount: 0, nextRetryAt: null, lastBatch: null });
  useAuthStore.getState().clearAuth();
  fetchSpy = vi.fn(() => Promise.reject(new Error("試用模式不應該打任何 API")));
  vi.stubGlobal("fetch", fetchSpy);
});

afterEach(() => {
  resetSyncEngineForTests();
  vi.unstubAllGlobals();
});

describe("進入與離開試用模式", () => {
  it("startTrial 之後有使用者但沒有 token", () => {
    useAuthStore.getState().startTrial();
    const s = useAuthStore.getState();
    expect(s.mode).toBe("trial");
    expect(s.user?.id).toBe(TRIAL_USER_ID);
    expect(s.accessToken).toBeNull();
    expect(s.refreshToken).toBeNull();
    expect(isTrialMode()).toBe(true);
  });

  it("結束試用之後回到正常模式", () => {
    useAuthStore.getState().startTrial();
    useAuthStore.getState().clearAuth();
    expect(useAuthStore.getState().mode).toBe("server");
    expect(isTrialMode()).toBe(false);
  });

  it("正常登入一定是正常模式（不會殘留上一次的試用狀態）", () => {
    useAuthStore.getState().startTrial();
    useAuthStore.getState().setSession(realUser, "access-1", "refresh-1");
    expect(useAuthStore.getState().mode).toBe("server");
    expect(useAuthStore.getState().user?.id).toBe("u1");
  });

  it("舊版存下來的登入狀態沒有 mode 欄位，載入後要是正常模式", async () => {
    // 這個欄位是後來才加的：如果直接把存檔整包展開，mode 會是 undefined，
    // 之後每個「是不是試用模式」的判斷都會誤判。
    localStorage.setItem(
      "kidney-diet-auth",
      JSON.stringify({ user: realUser, accessToken: "a", refreshToken: "r" })
    );
    vi.resetModules();
    const fresh = await import("../store/auth");
    expect(fresh.useAuthStore.getState().mode).toBe("server");
    expect(fresh.useAuthStore.getState().accessToken).toBe("a");
  });
});

describe("試用模式不碰網路", () => {
  beforeEach(() => {
    useAuthStore.getState().startTrial();
  });

  it("建立紀錄並請求同步 → 一個 API 都不會發出", async () => {
    await createLocalMeal({
      userId: TRIAL_USER_ID,
      mealType: "LUNCH",
      notes: null,
      file: photo(),
      capturedAt: new Date("2026-09-01T04:00:00.000Z"),
    });
    expect(await requestSync({ force: true })).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("請求同步不會去動同步狀態（畫面不該冒出「請重新登入」之類的提示）", async () => {
    const before = useSyncStore.getState();
    await requestSync({ force: true });
    await refreshCounts();
    const after = useSyncStore.getState();
    expect(after.phase).toBe(before.phase);
    expect(after.pendingCount).toBe(0);
    expect(after.failedCount).toBe(0);
  });
});

describe("試用資料跟真實帳號分開", () => {
  it("試用紀錄不會出現在真實帳號的清單裡", async () => {
    useAuthStore.getState().startTrial();
    await createLocalMeal({
      userId: TRIAL_USER_ID,
      mealType: "LUNCH",
      notes: null,
      file: photo(),
      capturedAt: new Date("2026-09-01T04:00:00.000Z"),
    });
    expect(await listLocalMeals(TRIAL_USER_ID)).toHaveLength(1);
    expect(await listLocalMeals("u1")).toHaveLength(0);
  });

  it("清除試用資料只清試用的那些", async () => {
    await createLocalMeal({
      userId: TRIAL_USER_ID,
      mealType: "LUNCH",
      notes: null,
      file: photo(),
      capturedAt: new Date("2026-09-01T04:00:00.000Z"),
    });
    await createLocalMeal({
      userId: "u1",
      mealType: "DINNER",
      notes: null,
      file: photo(),
      capturedAt: new Date("2026-09-01T10:00:00.000Z"),
    });

    await clearTrialData();

    expect(await listLocalMeals(TRIAL_USER_ID)).toHaveLength(0);
    expect(await listLocalMeals("u1")).toHaveLength(1);
  });

  it("試用模式的健康資料存在本機，清除時一起清掉", async () => {
    saveTrialProfile({
      ckdStage: "STAGE_3A",
      dialysisType: "NONE",
      dailySodiumLimitMg: 2000,
      dailyPotassiumLimitMg: null,
      dailyPhosphorusLimitMg: null,
    });
    expect(loadTrialProfile()?.ckdStage).toBe("STAGE_3A");
    await clearTrialData();
    expect(loadTrialProfile()).toBeNull();
  });
});

describe("試用模式的紀錄不該顯示同步狀態", () => {
  const view = (over: Partial<MealView>): MealView => ({
    id: "m1",
    mealType: "LUNCH",
    status: "COMPLETED",
    preMealAt: "2026-09-01T04:00:00.000Z",
    postMealAt: "2026-09-01T04:30:00.000Z",
    mealDurationSeconds: 1800,
    notes: null,
    createdAt: "2026-09-01T04:00:00.000Z",
    sync: "pending",
    failureMessage: null,
    preThumbDataUrl: null,
    postThumbDataUrl: null,
    ...over,
  });

  it("「待上傳」「上傳失敗」都會被抹掉（試用模式本來就不會上傳）", () => {
    const out = asTrialViews([
      view({ id: "a", sync: "pending" }),
      view({ id: "b", sync: "failed", failureMessage: "照片格式不支援" }),
    ]);
    expect(out.map((m) => m.sync)).toEqual(["synced", "synced"]);
    expect(out.every((m) => m.failureMessage === null)).toBe(true);
  });

  it("其他欄位原封不動", () => {
    const original = view({ sync: "synced" });
    const [out] = asTrialViews([original]);
    expect(out).toBe(original); // 沒有要改的就不複製
  });
});

/*
 * 登入後把試用紀錄帶進帳號。
 *
 * 這是唯一一條讓試用資料離開 trial-local-user 的路，所以守得特別緊：
 * 帶進來之後它仍然**絕對不能上傳**，而且它是那份資料的唯一一份、不能被清掉。
 */
describe("把試用紀錄帶進登入的帳號", () => {
  async function makeTrialMeal(at = "2026-09-01T04:00:00.000Z") {
    return createLocalMeal({
      userId: TRIAL_USER_ID,
      mealType: "LUNCH",
      notes: null,
      file: photo(),
      capturedAt: new Date(at),
    });
  }

  beforeEach(() => {
    localStorage.removeItem("kidney-diet-trial-import-asked");
  });

  it("帶進來之後，紀錄屬於該帳號且標記成本機專屬", async () => {
    await makeTrialMeal();
    const moved = await importTrialMeals("u1");

    expect(moved).toBe(1);
    const mine = await listLocalMeals("u1");
    expect(mine).toHaveLength(1);
    expect(mine[0]!.localOnly).toBe(true);
  });

  it("是「搬」不是「複製」：試用模式底下不會再留一份", async () => {
    await makeTrialMeal();
    await importTrialMeals("u1");

    // 留著的話同一批紀錄會被算兩次點數，而且還能再帶進第二個帳號
    expect(await listLocalMeals(TRIAL_USER_ID)).toHaveLength(0);
  });

  it("帶進來的紀錄請求同步時，一個 API 都不會發出", async () => {
    await makeTrialMeal();
    await importTrialMeals("u1");

    // 正常登入狀態（有 token、同步引擎會真的跑）
    useAuthStore.getState().setSession(realUser, "token", "refresh");
    expect(isTrialMode()).toBe(false);

    await requestSync({ force: true });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("帶進來的紀錄不會產生任何上傳事件", async () => {
    await makeTrialMeal();
    await importTrialMeals("u1");
    const meals = await listLocalMeals("u1");

    expect(buildEvents(meals, Date.parse("2030-01-01T00:00:00.000Z"))).toEqual([]);
  });

  it("不會被當成「待上傳」算進計數裡", async () => {
    await makeTrialMeal();
    await importTrialMeals("u1");
    useAuthStore.getState().setSession(realUser, "token", "refresh");

    await refreshCounts();
    // 算進去的話，畫面會永遠顯示「還有 1 筆等待上傳」，登出時也會跳一個解不掉的警告
    expect(useSyncStore.getState().pendingCount).toBe(0);
  });

  it("絕對不會被定期清理刪掉（伺服器上沒有備份）", async () => {
    await makeTrialMeal("2020-01-01T00:00:00.000Z"); // 遠比保留期限舊
    await importTrialMeals("u1");

    await pruneSyncedMeals("u1", { keep: 0, maxAgeDays: 1 });

    expect(await listLocalMeals("u1")).toHaveLength(1);
  });

  it("在畫面上標成 local，不是「待上傳」", async () => {
    await makeTrialMeal();
    await importTrialMeals("u1");
    const meals = await listLocalMeals("u1");

    const views = mergeMeals([], meals);
    expect(views[0]!.sync).toBe("local");
  });

  it("點數照算（本機算得到，而且伺服器永遠不會重複算一次）", async () => {
    await makeTrialMeal();
    await importTrialMeals("u1");
    const meals = await listLocalMeals("u1");

    // 伺服器那邊完全不知道這筆，所以基準是 0，手機自己算出餐前點數
    const summary = projectGamification(null, meals);
    expect(summary.totalPoints).toBe(POINTS.PRE_MEAL_LOGGED + POINTS.BADGE_AWARDED);
  });

  it("沒有試用紀錄就不會跳提示", async () => {
    expect(await pendingTrialImportCount("u1")).toBe(0);
  });

  it("有試用紀錄就會跳提示，回答過之後不再問同一個帳號", async () => {
    await makeTrialMeal();
    expect(await pendingTrialImportCount("u1")).toBe(1);

    markTrialImportAsked("u1");
    expect(await pendingTrialImportCount("u1")).toBe(0);
    // 但資料還在：使用者只是這次不想帶，下次進試用模式還看得到
    expect(await listLocalMeals(TRIAL_USER_ID)).toHaveLength(1);
  });

  it("換另一個帳號登入還是會問（上一個帳號的回答不算數）", async () => {
    await makeTrialMeal();
    markTrialImportAsked("u1");

    expect(await pendingTrialImportCount("u2")).toBe(1);
  });

  it("試用模式自己不會被問要不要帶進自己", async () => {
    await makeTrialMeal();
    expect(await pendingTrialImportCount(TRIAL_USER_ID)).toBe(0);
    expect(await importTrialMeals(TRIAL_USER_ID)).toBe(0);
  });
});

/*
 * 補拍餐後照時不能騙病人。帶進來的紀錄 hasPendingWork 永遠是 true
 * （照片永遠不會被標成已同步），所以 syncAndWait 必須先認出它是本機專屬的，
 * 否則完成畫面會寫「有網路就會自動上傳」——一個不會發生的承諾。
 */
describe("補拍帶進來的那一餐", () => {
  it("syncAndWait 回 local，不是 pending", async () => {
    const meal = await createLocalMeal({
      userId: TRIAL_USER_ID,
      mealType: "LUNCH",
      notes: null,
      file: photo(),
      capturedAt: new Date("2026-09-01T04:00:00.000Z"),
    });
    await importTrialMeals("u1");
    useAuthStore.getState().setSession(realUser, "token", "refresh");

    await attachPostPhoto({
      userId: "u1",
      mealId: meal.id,
      file: photo(),
      capturedAt: new Date("2026-09-01T04:40:00.000Z"),
    });

    expect(await syncAndWait(meal.id, 50)).toBe("local");
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
