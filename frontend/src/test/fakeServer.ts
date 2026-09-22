import { vi } from "vitest";

/**
 * 假的後端：用 vi.stubGlobal 取代 fetch，行為對齊真的後端 (backend/src/routes/meals.routes.ts)：
 * - 用餐紀錄 id 由前端提供，重複送出 = 200 (不重複建立、不重複發點數)
 * - 可以切成「離線」(fetch 丟 TypeError)、或讓下一次請求回指定的狀態碼
 */
export class FakeServer {
  meals = new Map<string, { status: string; deleted: boolean; preHash: string; postHash?: string }>();
  points = 0;
  offline = false;
  requests: string[] = [];
  /** 下一次符合條件的請求直接回這個狀態碼 (用一次就失效) */
  nextStatus = new Map<string, { status: number; body?: unknown }>();
  /** 收到某個請求時先卡住，直到 release() 才繼續，用來模擬「上傳進行中」 */
  gate: { match: string; promise: Promise<void> } | null = null;
  tokens = { valid: new Set(["access-1"]), refresh: { status: 200 as number } };

  install() {
    vi.stubGlobal("fetch", (url: string, init: RequestInit = {}) => this.handle(url, init));
  }

  fail(match: string, status: number, body: unknown = { error: "x" }) {
    this.nextStatus.set(match, { status, body });
  }

  private json(status: number, body: unknown) {
    return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
  }

  private async handle(url: string, init: RequestInit): Promise<Response> {
    if (this.offline) throw new TypeError("Failed to fetch");
    const path = url.replace(/^.*\/api/, "");
    const method = init.method ?? "GET";
    const key = `${method} ${path}`;
    this.requests.push(key);

    if (this.gate && key.includes(this.gate.match)) await this.gate.promise;
    if (init.signal?.aborted) throw new DOMException("Aborted", "AbortError");

    for (const [match, forced] of this.nextStatus) {
      if (key.includes(match)) {
        this.nextStatus.delete(match);
        return this.json(forced.status, forced.body);
      }
    }

    if (path === "/auth/refresh") {
      if (this.tokens.refresh.status !== 200) return this.json(this.tokens.refresh.status, { error: "refresh failed" });
      this.tokens.valid.add("access-2");
      return this.json(200, { accessToken: "access-2", refreshToken: "refresh-2" });
    }

    const auth = (init.headers as Record<string, string> | undefined)?.Authorization;
    if (!auth || !this.tokens.valid.has(auth.replace("Bearer ", ""))) return this.json(401, { error: "unauthorized" });

    const preMatch = method === "POST" && path === "/meals/pre-meal";
    const postMatch = method === "POST" ? path.match(/^\/meals\/([^/]+)\/post-meal$/) : null;
    if (preMatch || postMatch) {
      const form = init.body as FormData;
      const photo = form.get("photo") as File;
      const hash = `${photo.size}:${photo.name}`;
      if (preMatch) {
        const id = String(form.get("id"));
        const existing = this.meals.get(id);
        if (existing) {
          if (existing.preHash !== hash) return this.json(409, { error: "這筆用餐紀錄的這個階段已經有另一張不同的照片" });
          return this.json(200, { replayed: true });
        }
        this.meals.set(id, { status: "AWAITING_POST_PHOTO", deleted: false, preHash: hash });
        this.points += 10;
        return this.json(201, { replayed: false });
      }
      const id = postMatch![1];
      const m = this.meals.get(id);
      if (!m || m.deleted) return this.json(404, { error: "找不到這筆用餐紀錄" });
      if (m.status === "COMPLETED") {
        if (m.postHash !== hash) return this.json(409, { error: "已經有另一張不同的照片" });
      } else {
        m.status = "COMPLETED";
        m.postHash = hash;
        this.points += 15;
      }
      return this.json(200, {
        gamification: { totalPoints: this.points, currentStreakDays: 1, longestStreakDays: 1, badges: [] },
      });
    }

    const abandonMatch = method === "PATCH" ? path.match(/^\/meals\/([^/]+)\/abandon$/) : null;
    if (abandonMatch) {
      const m = this.meals.get(abandonMatch[1]);
      if (!m) return this.json(404, { error: "找不到" });
      if (m.status === "ABANDONED") return this.json(200, {});
      if (m.status !== "AWAITING_POST_PHOTO") return this.json(409, { error: "只有還在等待餐後照的紀錄可以被放棄" });
      m.status = "ABANDONED";
      return this.json(200, {});
    }
    const delMatch = method === "DELETE" ? path.match(/^\/meals\/([^/]+)$/) : null;
    if (delMatch) {
      const m = this.meals.get(delMatch[1]);
      if (!m || m.deleted) return this.json(404, { error: "找不到" });
      m.deleted = true;
      return new Response(null, { status: 204 });
    }
    return this.json(404, { error: "no route" });
  }
}

export function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => (resolve = r));
  return { promise, resolve };
}
