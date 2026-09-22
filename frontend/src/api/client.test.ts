import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useAuthStore } from "../store/auth";
import { api, ApiError, NetworkError } from "./client";

const user = { id: "u1", email: "a@b.c", displayName: "x", role: "PATIENT" as const };
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

beforeEach(() => {
  useAuthStore.getState().setSession(user, "access-old", "refresh-old");
});
afterEach(() => {
  vi.unstubAllGlobals();
  useAuthStore.getState().clearAuth();
});

describe("網路錯誤", () => {
  it("連不上 (fetch 丟 TypeError) → NetworkError，跟伺服器回的錯誤分得開", async () => {
    vi.stubGlobal("fetch", () => Promise.reject(new TypeError("Failed to fetch")));
    await expect(api.get("/x")).rejects.toBeInstanceOf(NetworkError);
  });

  it("請求逾時 → NetworkError (不會一直卡住同步佇列)", async () => {
    vi.stubGlobal(
      "fetch",
      (_url: string, init: RequestInit) =>
        new Promise((_, reject) => {
          init.signal!.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
        })
    );
    await expect(api.post("/x", {}, { timeoutMs: 30 })).rejects.toBeInstanceOf(NetworkError);
  });

  it("伺服器回錯誤 → ApiError，帶狀態碼與訊息", async () => {
    vi.stubGlobal("fetch", () => Promise.resolve(json(409, { error: "已被使用" })));
    const err = (await api.get("/x").catch((e: unknown) => e)) as ApiError;
    expect(err).toBeInstanceOf(ApiError);
    expect(err.status).toBe(409);
    expect(err.message).toBe("已被使用");
  });
});

describe("token 換發", () => {
  it("401 → 換發 → 用新 token 重打一次成功", async () => {
    const calls: string[] = [];
    vi.stubGlobal("fetch", (url: string, init: RequestInit) => {
      calls.push(url);
      if (url.endsWith("/auth/refresh")) return Promise.resolve(json(200, { accessToken: "access-new", refreshToken: "refresh-new" }));
      const auth = (init.headers as Record<string, string>).Authorization;
      return Promise.resolve(auth === "Bearer access-new" ? json(200, { ok: true }) : json(401, { error: "expired" }));
    });
    expect(await api.get("/x")).toEqual({ ok: true });
    expect(useAuthStore.getState().accessToken).toBe("access-new");
  });

  it("換發被伺服器明確拒絕 (401) → 登出", async () => {
    vi.stubGlobal("fetch", (url: string) =>
      Promise.resolve(url.endsWith("/auth/refresh") ? json(401, { error: "invalid" }) : json(401, { error: "expired" }))
    );
    await expect(api.get("/x")).rejects.toMatchObject({ status: 401 });
    expect(useAuthStore.getState().accessToken).toBeNull();
  });

  it.each([500, 502, 503, 429])("換發時伺服器暫時有問題 (%i) → 不登出，並回報成 503 讓同步佇列整個停下重試", async (status) => {
    vi.stubGlobal("fetch", (url: string) =>
      Promise.resolve(url.endsWith("/auth/refresh") ? json(status, { error: "busy" }) : json(401, { error: "expired" }))
    );
    await expect(api.get("/x")).rejects.toMatchObject({ status: 503 });
    expect(useAuthStore.getState().accessToken).toBe("access-old");
    expect(useAuthStore.getState().refreshToken).toBe("refresh-old");
  });

  it("換發時連不上網路 → NetworkError，不登出", async () => {
    vi.stubGlobal("fetch", (url: string) =>
      url.endsWith("/auth/refresh") ? Promise.reject(new TypeError("Failed to fetch")) : Promise.resolve(json(401, { error: "expired" }))
    );
    await expect(api.get("/x")).rejects.toBeInstanceOf(NetworkError);
    expect(useAuthStore.getState().accessToken).toBe("access-old");
  });

  it("好幾個請求同時收到 401 只會換發一次 (refresh token 是一次性的)", async () => {
    let refreshCalls = 0;
    vi.stubGlobal("fetch", (url: string, init: RequestInit) => {
      if (url.endsWith("/auth/refresh")) {
        refreshCalls++;
        return Promise.resolve(json(200, { accessToken: "access-new", refreshToken: "refresh-new" }));
      }
      const auth = (init.headers as Record<string, string>).Authorization;
      return Promise.resolve(auth === "Bearer access-new" ? json(200, {}) : json(401, {}));
    });
    await Promise.all([api.get("/a"), api.get("/b"), api.get("/c")]);
    expect(refreshCalls).toBe(1);
  });
});
