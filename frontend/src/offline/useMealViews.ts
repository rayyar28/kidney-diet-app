import { useCallback, useEffect, useRef, useState } from "react";
import { api, NetworkError } from "../api/client";
import type { GamificationSummary, MealRecord } from "../api/types";
import { useAuthStore } from "../store/auth";
import { computeLocalGamification, projectGamification } from "../gamification/replay";
import { asTrialViews } from "../trial/views";
import { mergeMeals } from "./logic";
import { listLocalMeals, loadServerCache, onLocalChange, saveServerCache } from "./mealStore";
import { useSyncStore } from "./syncStore";
import type { MealView } from "./types";

interface ViewData {
  meals: MealView[];
  summary: GamificationSummary | null;
  /** 第一次載入 (連本機快取都還沒讀到) */
  loading: boolean;
  /** 最近一次向伺服器要資料時連不上：畫面上的是快取加上本機狀態 */
  offline: boolean;
}

/**
 * 給首頁/紀錄頁用：先立刻顯示「本機快取 + 本機還沒上傳的紀錄」，
 * 同時在背景向伺服器要最新資料，回來後再更新畫面。連不上伺服器也照樣有畫面可看。
 *
 * 點數/連續天數/徽章一律在手機上算：拿伺服器算到的結果當基準，再把本機還沒上傳的
 * 紀錄接著算下去（見 gamification/replay.ts）。所以病人離線拍完一餐就能立刻看到點數增加，
 * 而不是等回診連上網路才看到。試用模式沒有伺服器，基準就是零。
 */
export function useMealViews() {
  const userId = useAuthStore((s) => s.user?.id);
  const trial = useAuthStore((s) => s.mode === "trial");
  const lastBatchAt = useSyncStore((s) => s.lastBatch?.at ?? 0);
  const [data, setData] = useState<ViewData>({ meals: [], summary: null, loading: true, offline: false });
  const server = useRef<MealRecord[]>([]);
  const alive = useRef(true);
  // 算點數的基準。放在 syncStore 而不是這裡的 ref，是因為同步引擎上傳成功時也要更新它
  // （它才知道伺服器回了什麼），而它不在 React 元件裡。
  const serverSummary = useSyncStore((s) => s.lastGamification);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const recompute = useCallback(async () => {
    if (!userId) return;
    const locals = await listLocalMeals(userId);
    if (!alive.current) return;
    const merged = mergeMeals(server.current, locals);
    // 刻意用 getState() 而不是把 serverSummary 收進 deps：recompute 的 identity 要保持穩定，
    // 否則下面那個「載入 + 抓伺服器」的 effect 會每次摘要變動就重跑一次，變成無窮迴圈。
    const base = useSyncStore.getState().lastGamification;
    setData((d) => ({
      ...d,
      meals: trial ? asTrialViews(merged) : merged,
      summary: trial ? computeLocalGamification(locals) : projectGamification(base, locals),
    }));
  }, [userId, trial]);

  const fetchServer = useCallback(async () => {
    if (!userId || trial) return;
    try {
      const [list, summary] = await Promise.all([
        api.get<{ items: MealRecord[] }>("/meals?pageSize=50"),
        api.get<GamificationSummary>("/gamification/summary"),
      ]);
      server.current = list.items;
      useSyncStore.getState().patch({ lastGamification: summary });
      await saveServerCache(userId, { meals: list.items, summary }).catch(() => {});
      if (alive.current) setData((d) => ({ ...d, offline: false }));
      await recompute();
    } catch (err) {
      if (alive.current && err instanceof NetworkError) setData((d) => ({ ...d, offline: true }));
    }
  }, [userId, trial, recompute]);

  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    (async () => {
      // 試用模式沒有伺服器資料，連快取都不必讀
      const cached = trial ? undefined : await loadServerCache(userId).catch(() => undefined);
      if (cancelled) return;
      server.current = cached?.meals ?? [];
      if (cached?.summary) useSyncStore.getState().patch({ lastGamification: cached.summary });
      await recompute();
      if (!cancelled) setData((d) => ({ ...d, loading: false }));
      await fetchServer();
    })();
    return () => {
      cancelled = true;
    };
  }, [userId, trial, recompute, fetchServer]);

  // 本機有變動 (新增、放棄、刪除、同步進度) → 只重新合併，不必重打 API
  useEffect(() => onLocalChange(() => void recompute()), [recompute]);

  // 基準變了 (剛從快取讀到、剛抓完、或同步引擎上傳成功拿到新的) → 重算畫面上的數字
  useEffect(() => {
    void recompute();
  }, [serverSummary, recompute]);

  // 同步引擎剛上傳成功東西 → 伺服器上的紀錄變了，重新抓一次完整清單
  useEffect(() => {
    if (lastBatchAt) void fetchServer();
  }, [lastBatchAt, fetchServer]);

  return { ...data, reload: fetchServer };
}
