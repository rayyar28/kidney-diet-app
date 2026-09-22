import type { GamificationSummary, MealRecord, MealType } from "../api/types";
import { idb, updateInTx, STORE_CACHE, STORE_MEALS } from "./db";
import { hasPendingWork } from "./logic";
import type { CachedServerData, LocalMeal, LocalPhotoSlot } from "./types";
import { isBrowserOnline, makeThumbnail, requestPersistentStorage, uuid } from "./util";

/* 本機用餐紀錄的讀寫。所有「寫入」都會通知畫面重新整理 (onLocalChange)。 */

const listeners = new Set<() => void>();

export function onLocalChange(cb: () => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

function emit(): void {
  for (const cb of listeners) {
    try {
      cb();
    } catch {
      /* 一個訂閱者壞掉不能影響其他人 */
    }
  }
}

async function buildSlot(file: File, capturedAt: Date): Promise<LocalPhotoSlot> {
  return {
    capturedAt: capturedAt.toISOString(),
    tzOffsetMinutes: capturedAt.getTimezoneOffset(),
    capturedOffline: !isBrowserOnline(),
    thumbDataUrl: await makeThumbnail(file),
    file: { blob: file, name: file.name || "photo.jpg", type: file.type || "image/jpeg" },
    synced: false,
  };
}

/** 伺服器已經知道、但本機還沒有的紀錄，補一個「殼」，之後的動作 (餐後照/放棄/刪除) 才有地方掛 */
function shellFromServer(userId: string, s: Pick<MealRecord, "id" | "mealType" | "notes" | "preMealAt">): LocalMeal {
  return {
    id: s.id,
    userId,
    mealType: s.mealType,
    notes: s.notes,
    preAt: s.preMealAt,
    pre: null,
    post: null,
    abandon: null,
    remove: null,
    failure: null,
    attempts: 0,
    nextAttemptAt: 0,
    createdAtLocal: new Date().toISOString(),
  };
}

export async function getLocalMeal(id: string): Promise<LocalMeal | undefined> {
  return idb.get<LocalMeal>(STORE_MEALS, id);
}

export async function listLocalMeals(userId: string): Promise<LocalMeal[]> {
  return idb.getAllByIndex<LocalMeal>(STORE_MEALS, "userId", userId);
}

/** 建立一筆新的用餐紀錄 (含餐前照)，寫入本機後立刻回傳；不需要網路。 */
export async function createLocalMeal(params: {
  userId: string;
  mealType: MealType;
  notes: string | null;
  file: File;
  capturedAt: Date;
}): Promise<LocalMeal> {
  const slot = await buildSlot(params.file, params.capturedAt);
  const meal: LocalMeal = {
    id: uuid(),
    userId: params.userId,
    mealType: params.mealType,
    notes: params.notes,
    preAt: slot.capturedAt,
    pre: slot,
    post: null,
    abandon: null,
    remove: null,
    failure: null,
    attempts: 0,
    nextAttemptAt: 0,
    createdAtLocal: new Date().toISOString(),
  };
  await idb.put(STORE_MEALS, meal);
  requestPersistentStorage();
  emit();
  return meal;
}

/**
 * 幫一筆紀錄補上餐後照。serverMeal 是這筆紀錄在伺服器上的樣子 (本機沒有這筆時用來建殼)。
 */
export async function attachPostPhoto(params: {
  userId: string;
  mealId: string;
  serverMeal?: Pick<MealRecord, "id" | "mealType" | "notes" | "preMealAt">;
  file: File;
  capturedAt: Date;
}): Promise<LocalMeal> {
  const slot = await buildSlot(params.file, params.capturedAt);

  let local = await getLocalMeal(params.mealId);
  if (!local) {
    if (!params.serverMeal) throw new Error("找不到這筆用餐紀錄");
    await idb.put(STORE_MEALS, shellFromServer(params.userId, params.serverMeal));
  } else if (local.userId !== params.userId) {
    throw new Error("這筆用餐紀錄不屬於目前登入的帳號");
  }

  const updated = await updateInTx<LocalMeal>(STORE_MEALS, params.mealId, (m) => {
    if (m.abandon || m.remove) throw new Error("這筆用餐紀錄已被放棄或刪除，無法再新增餐後照");
    if (m.post) throw new Error("這筆用餐紀錄已經有餐後照了");
    return { ...m, post: slot };
  });
  local = updated ?? undefined;
  if (!local) throw new Error("儲存餐後照失敗");
  requestPersistentStorage();
  emit();
  return local;
}

async function ensureShell(userId: string, mealId: string, serverMeal?: Pick<MealRecord, "id" | "mealType" | "notes" | "preMealAt">) {
  const local = await getLocalMeal(mealId);
  if (local) {
    if (local.userId !== userId) throw new Error("這筆用餐紀錄不屬於目前登入的帳號");
    return;
  }
  if (!serverMeal) throw new Error("找不到這筆用餐紀錄");
  await idb.put(STORE_MEALS, shellFromServer(userId, serverMeal));
}

/** 放棄一筆還在等餐後照的紀錄 (離線也能按，連上網路後才通知伺服器) */
export async function requestAbandon(params: {
  userId: string;
  mealId: string;
  serverMeal?: Pick<MealRecord, "id" | "mealType" | "notes" | "preMealAt">;
}): Promise<void> {
  await ensureShell(params.userId, params.mealId, params.serverMeal);
  await updateInTx<LocalMeal>(STORE_MEALS, params.mealId, (m) => {
    if (m.post) throw new Error("已經有餐後照的紀錄不能放棄");
    if (m.abandon) return null;
    return { ...m, abandon: { requestedAt: new Date().toISOString(), synced: false } };
  });
  emit();
}

/**
 * 刪除一筆紀錄。跟線上版一樣是「軟刪除」：畫面上立刻消失，但資料 (含還沒上傳的照片)
 * 仍會先上傳，再通知伺服器標記刪除，研究資料不會因為病人刪除而少一筆。
 */
export async function requestRemove(params: {
  userId: string;
  mealId: string;
  serverMeal?: Pick<MealRecord, "id" | "mealType" | "notes" | "preMealAt">;
}): Promise<void> {
  await ensureShell(params.userId, params.mealId, params.serverMeal);
  await updateInTx<LocalMeal>(STORE_MEALS, params.mealId, (m) => {
    if (m.remove) return null;
    return { ...m, remove: { requestedAt: new Date().toISOString(), synced: false } };
  });
  emit();
}

/** 給同步引擎用：在同一個 transaction 裡讀取最新狀態再修改，不會蓋掉使用者剛做的操作 */
export async function mutateMeal(id: string, fn: (m: LocalMeal) => LocalMeal | null): Promise<LocalMeal | null> {
  const result = await updateInTx<LocalMeal>(STORE_MEALS, id, fn);
  emit();
  return result;
}

export async function deleteLocalMeal(id: string): Promise<void> {
  await idb.delete(STORE_MEALS, id);
  emit();
}

/** 上傳一直失敗的紀錄，讓使用者按「重試」時清掉失敗標記 */
export async function retryFailedMeal(id: string): Promise<void> {
  await mutateMeal(id, (m) => ({ ...m, failure: null, attempts: 0, nextAttemptAt: 0, firstSuspectAt: undefined }));
}

/**
 * 使用者選擇「捨棄」一筆上傳失敗的紀錄。
 * - 伺服器從來沒收過這筆 (餐前照就被拒絕)：整筆從本機清掉。
 * - 伺服器已經有這筆 (只是後面某一步被拒絕，例如餐後照格式不對)：只丟掉失敗的那一步，
 *   紀錄退回伺服器目前的狀態，使用者可以重拍或放棄。
 */
export async function discardFailedMeal(id: string): Promise<void> {
  const m = await getLocalMeal(id);
  if (!m) return;
  if (m.pre !== null && !m.pre.synced) {
    await deleteLocalMeal(id);
    return;
  }
  await mutateMeal(id, (x) => ({
    ...x,
    post: x.post && !x.post.synced ? null : x.post,
    abandon: x.abandon && !x.abandon.synced ? null : x.abandon,
    remove: x.remove && !x.remove.synced ? null : x.remove,
    failure: null,
    attempts: 0,
    nextAttemptAt: 0,
    firstSuspectAt: undefined,
  }));
}

/** 只留最近的已同步紀錄當縮圖快取，避免本機資料庫無限長大。未完成/失敗的一律不動。 */
export async function pruneSyncedMeals(userId: string, opts: { keep?: number; maxAgeDays?: number } = {}): Promise<void> {
  const keep = opts.keep ?? 100;
  const cutoff = Date.now() - (opts.maxAgeDays ?? 60) * 86_400_000;
  const meals = await listLocalMeals(userId);
  const synced = meals
    .filter((m) => !hasPendingWork(m) && !m.failure)
    .sort((a, b) => Date.parse(b.preAt) - Date.parse(a.preAt));
  const toDelete = synced.filter((m, i) => i >= keep || Date.parse(m.preAt) < cutoff);
  for (const m of toDelete) await idb.delete(STORE_MEALS, m.id);
  if (toDelete.length > 0) emit();
}

/* ---------- 伺服器資料快取 (離線時給首頁/紀錄頁顯示用) ---------- */

interface CacheRow extends CachedServerData {
  key: string;
}

const cacheKey = (userId: string) => `server:${userId}`;

export async function loadServerCache(userId: string): Promise<CachedServerData | undefined> {
  return idb.get<CacheRow>(STORE_CACHE, cacheKey(userId));
}

export async function saveServerCache(
  userId: string,
  patch: { meals?: MealRecord[]; summary?: GamificationSummary | null }
): Promise<void> {
  const current = await loadServerCache(userId);
  const next: CacheRow = {
    key: cacheKey(userId),
    meals: patch.meals ?? current?.meals ?? [],
    summary: patch.summary !== undefined ? patch.summary : current?.summary ?? null,
    updatedAt: Date.now(),
  };
  await idb.put(STORE_CACHE, next);
}
