import { create } from "zustand";
import { useSyncStore } from "../offline/syncStore";
import type { AuthUser } from "../api/types";

/**
 * 登入狀態有兩種模式：
 *
 * - `server`：正常模式。有帳號、有 token，紀錄會排隊上傳到伺服器。
 * - `trial` ：本機試用模式。不需要填伺服器網址、不需要註冊帳號，
 *             所有紀錄只留在這支手機，同步引擎完全不會啟動。
 *
 * 為什麼要有試用模式：要請護理師/衛教師幫忙試用、找出「介面好不好用」的問題時，
 * 後端多半還沒有固定位置。如果非得先填一個網址、再註冊一個帳號才能按下第一顆按鈕，
 * 光這兩步就會擋掉大部分的人，而且他們回報的會是「連不上」而不是我們想知道的使用問題。
 * 試用模式讓 App 一裝好就能從頭到尾走完一次完整流程。
 *
 * 試用資料掛在固定的假 userId 底下，跟真實帳號的資料天然分開（見 trial/trialData.ts）。
 */
export type AuthMode = "server" | "trial";

/** 試用模式的固定使用者 id：本機紀錄用它分群，永遠不會送到伺服器 */
export const TRIAL_USER_ID = "trial-local-user";

const TRIAL_USER: AuthUser = {
  id: TRIAL_USER_ID,
  email: "試用模式，資料只存在這支手機",
  displayName: "試用者",
  role: "PATIENT",
};

interface Session {
  user: AuthUser | null;
  accessToken: string | null;
  refreshToken: string | null;
  mode: AuthMode;
}

interface AuthState extends Session {
  setSession: (user: AuthUser, accessToken: string, refreshToken: string) => void;
  setTokens: (accessToken: string, refreshToken: string) => void;
  /** 進入本機試用模式（不需要伺服器、不需要帳號） */
  startTrial: () => void;
  clearAuth: () => void;
}

const STORAGE_KEY = "kidney-diet-auth";

const EMPTY: Session = { user: null, accessToken: null, refreshToken: null, mode: "server" };

function loadInitial(): Session {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return EMPTY;
    const parsed = JSON.parse(raw) as Partial<Session>;
    // 逐欄位取值而不是整包照收：舊版本存下來的資料沒有 mode 欄位，
    // 直接展開會讓 mode 變成 undefined，之後每個 mode 的判斷都會誤判。
    return {
      user: parsed.user ?? null,
      accessToken: parsed.accessToken ?? null,
      refreshToken: parsed.refreshToken ?? null,
      mode: parsed.mode === "trial" ? "trial" : "server",
    };
  } catch {
    return EMPTY;
  }
}

function persist(state: Session) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

export const useAuthStore = create<AuthState>((set, get) => ({
  ...loadInitial(),
  setSession: (user, accessToken, refreshToken) => {
    const next: Session = { user, accessToken, refreshToken, mode: "server" };
    persist(next);
    set(next);
  },
  setTokens: (accessToken, refreshToken) => {
    const next: Session = { user: get().user, accessToken, refreshToken, mode: get().mode };
    persist(next);
    set(next);
  },
  startTrial: () => {
    const next: Session = { user: TRIAL_USER, accessToken: null, refreshToken: null, mode: "trial" };
    persist(next);
    set(next);
  },
  clearAuth: () => {
    localStorage.removeItem(STORAGE_KEY);
    // 同步引擎在 syncStore 裡留著「伺服器最新的點數摘要」，而畫面是拿它當基準顯示的。
    // 不清掉的話，同一支手機換下一個人登入時，會先看到上一個人的點數。
    useSyncStore.getState().patch({ lastGamification: null, lastBatch: null, lastRecovery: null });
    set(EMPTY);
  },
}));

/**
 * 給「不是 React 元件」的程式用（同步引擎等）。元件裡請用
 * `useAuthStore((s) => s.mode === "trial")`，否則模式切換時畫面不會重新 render。
 */
export function isTrialMode(): boolean {
  return useAuthStore.getState().mode === "trial";
}
