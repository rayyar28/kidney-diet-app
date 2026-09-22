import { useCallback, useEffect, useRef, useState } from "react";
import { api, NetworkError } from "../api/client";
import type { GamificationSummary, MealRecord } from "../api/types";
import { useAuthStore } from "../store/auth";
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
 */
export function useMealViews() {
  const userId = useAuthStore((s) => s.user?.id);
  const lastBatchAt = useSyncStore((s) => s.lastBatch?.at ?? 0);
  const [data, setData] = useState<ViewData>({ meals: [], summary: null, loading: true, offline: false });
  const server = useRef<{ meals: MealRecord[]; summary: GamificationSummary | null }>({ meals: [], summary: null });
  const alive = useRef(true);

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
    setData((d) => ({ ...d, meals: mergeMeals(server.current.meals, locals), summary: server.current.summary }));
  }, [userId]);

  const fetchServer = useCallback(async () => {
    if (!userId) return;
    try {
      const [list, summary] = await Promise.all([
        api.get<{ items: MealRecord[] }>("/meals?pageSize=50"),
        api.get<GamificationSummary>("/gamification/summary"),
      ]);
      server.current = { meals: list.items, summary };
      await saveServerCache(userId, { meals: list.items, summary }).catch(() => {});
      if (alive.current) setData((d) => ({ ...d, offline: false }));
      await recompute();
    } catch (err) {
      if (alive.current && err instanceof NetworkError) setData((d) => ({ ...d, offline: true }));
    }
  }, [userId, recompute]);

  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    (async () => {
      const cached = await loadServerCache(userId).catch(() => undefined);
      if (cancelled) return;
      server.current = { meals: cached?.meals ?? [], summary: cached?.summary ?? null };
      await recompute();
      if (!cancelled) setData((d) => ({ ...d, loading: false }));
      await fetchServer();
    })();
    return () => {
      cancelled = true;
    };
  }, [userId, recompute, fetchServer]);

  // 本機有變動 (新增、放棄、刪除、同步進度) → 只重新合併，不必重打 API
  useEffect(() => onLocalChange(() => void recompute()), [recompute]);

  // 同步引擎剛上傳成功東西 → 伺服器上的點數/紀錄變了，重新抓
  useEffect(() => {
    if (lastBatchAt) void fetchServer();
  }, [lastBatchAt, fetchServer]);

  return { ...data, reload: fetchServer };
}
