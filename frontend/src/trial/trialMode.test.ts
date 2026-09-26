import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetDbForTests } from "../offline/db";
import { createLocalMeal, listLocalMeals } from "../offline/mealStore";
import { refreshCounts, requestSync, resetSyncEngineForTests } from "../offline/syncEngine";
import { useSyncStore } from "../offline/syncStore";
import type { MealView } from "../offline/types";
import { TRIAL_USER_ID, isTrialMode, useAuthStore } from "../store/auth";
import { clearTrialData, loadTrialProfile, saveTrialProfile } from "./trialData";
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
