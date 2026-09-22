/**
 * IndexedDB 的最小封裝。整個離線層只有這一個檔案知道「底層是 IndexedDB」，
 * 之後包成 Capacitor 原生 App 時，想換成 SQLite / 檔案系統只要改這裡與 mealStore。
 */

const DB_NAME = "kidney-diet-local";
const DB_VERSION = 1;

export const STORE_MEALS = "meals";
export const STORE_CACHE = "cache";

let dbPromise: Promise<IDBDatabase> | null = null;

export function openDb(): Promise<IDBDatabase> {
  if (!dbPromise) {
    dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE_MEALS)) {
          const meals = db.createObjectStore(STORE_MEALS, { keyPath: "id" });
          meals.createIndex("userId", "userId", { unique: false });
        }
        if (!db.objectStoreNames.contains(STORE_CACHE)) {
          db.createObjectStore(STORE_CACHE, { keyPath: "key" });
        }
      };
      req.onsuccess = () => {
        const db = req.result;
        // 別的分頁要升級資料庫版本時，主動放手，不要卡住對方
        db.onversionchange = () => {
          db.close();
          dbPromise = null;
        };
        resolve(db);
      };
      req.onerror = () => reject(req.error ?? new Error("無法開啟本機資料庫"));
      req.onblocked = () => reject(new Error("本機資料庫被另一個分頁佔用"));
    }).catch((err) => {
      dbPromise = null;
      throw err;
    });
  }
  return dbPromise as Promise<IDBDatabase>;
}


async function tx<T>(
  store: string,
  mode: IDBTransactionMode,
  fn: (s: IDBObjectStore) => IDBRequest<T>
): Promise<T> {
  const db = await openDb();
  return new Promise<T>((resolve, reject) => {
    const transaction = db.transaction(store, mode);
    const request = fn(transaction.objectStore(store));
    let result: T;
    request.onsuccess = () => {
      result = request.result;
    };
    // 寫入要等 transaction 真的 commit 才算成功 (不是 request 成功)
    transaction.oncomplete = () => resolve(result);
    transaction.onerror = () => reject(transaction.error ?? request.error);
    transaction.onabort = () => reject(transaction.error ?? new Error("本機資料庫寫入被中止"));
  });
}

export const idb = {
  get: <T>(store: string, key: string) => tx<T | undefined>(store, "readonly", (s) => s.get(key)),
  getAll: <T>(store: string) => tx<T[]>(store, "readonly", (s) => s.getAll()),
  getAllByIndex: <T>(store: string, index: string, value: IDBValidKey) =>
    tx<T[]>(store, "readonly", (s) => s.index(index).getAll(value)),
  put: (store: string, value: unknown) => tx<IDBValidKey>(store, "readwrite", (s) => s.put(value)),
  delete: (store: string, key: string) => tx<undefined>(store, "readwrite", (s) => s.delete(key)),
};

/**
 * 讀-改-寫必須在同一個 transaction 裡完成，否則同步引擎與使用者操作 (例如上傳
 * 餐前照的同時使用者剛好按了「放棄」) 會互相覆蓋對方的修改。
 */
export async function updateInTx<T extends { id: string }>(
  store: string,
  key: string,
  mutate: (current: T) => T | null
): Promise<T | null> {
  const db = await openDb();
  return new Promise<T | null>((resolve, reject) => {
    const transaction = db.transaction(store, "readwrite");
    const os = transaction.objectStore(store);
    let out: T | null = null;
    let thrown: unknown = null;
    const getReq = os.get(key);
    getReq.onsuccess = () => {
      const current = getReq.result as T | undefined;
      if (!current) return;
      try {
        const next = mutate(current);
        if (next) {
          out = next;
          os.put(next);
        }
      } catch (err) {
        // mutate 主動丟錯 (例如「這筆已經有餐後照了」) = 放棄這次修改。
        // 不能直接讓例外飄出去，IndexedDB 會吞掉原始訊息只留下通用的中止錯誤。
        thrown = err;
        transaction.abort();
      }
    };
    transaction.oncomplete = () => resolve(out);
    transaction.onerror = () => reject(thrown ?? transaction.error);
    transaction.onabort = () => reject(thrown ?? transaction.error ?? new Error("本機資料庫寫入被中止"));
  });
}

/** 測試用：關閉並清掉連線快取 */
export async function resetDbForTests(): Promise<void> {
  if (dbPromise) {
    const db = await dbPromise.catch(() => null);
    db?.close();
  }
  dbPromise = null;
  await new Promise<void>((resolve) => {
    const req = indexedDB.deleteDatabase(DB_NAME);
    req.onsuccess = () => resolve();
    req.onerror = () => resolve();
    req.onblocked = () => resolve();
  });
}

