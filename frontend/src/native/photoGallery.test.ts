import { afterEach, describe, expect, it, vi } from "vitest";
import { canSaveToGallery, galleryFileName, saveCameraPhotoToGallery } from "./photoGallery";

/*
 * 存進相簿的實際動作在原生端（PhotoGalleryPlugin.java），這裡只守住 JS 這一側的兩件事：
 * 1. 網頁版絕對不會去呼叫（沒有相簿可以存，呼叫只會噴錯）。
 * 2. 不論發生什麼事都不會 throw——存相簿失敗不該影響病人記錄這一餐。
 */

const photo = () => new File([new Uint8Array([1, 2, 3, 4])], "a.jpg", { type: "image/jpeg" });

/** 假裝跑在一般瀏覽器：有 window，但沒有 Capacitor 注入的物件 */
function pretendWeb() {
  (globalThis as { window?: unknown }).window = {};
}

/** 假裝跑在原生 App 裡（Capacitor 會注入這個物件） */
function pretendNative() {
  (globalThis as { window?: unknown }).window = { Capacitor: { isNativePlatform: () => true } };
}

afterEach(() => {
  delete (globalThis as { window?: unknown }).window;
  vi.restoreAllMocks();
});

describe("檔名", () => {
  it("用拍攝時間組成，個位數補零", () => {
    expect(galleryFileName(new Date(2026, 8, 6, 7, 5, 3))).toBe("meal-20260906-070503.jpg");
    expect(galleryFileName(new Date(2026, 11, 31, 23, 59, 59))).toBe("meal-20261231-235959.jpg");
  });

  it("不含路徑分隔字元", () => {
    const name = galleryFileName(new Date(2026, 8, 26, 14, 30, 0));
    expect(name).not.toMatch(/[/\\:]/);
  });
});

describe("網頁版不碰相簿", () => {
  it("沒有 Capacitor 時 canSaveToGallery 是 false", () => {
    pretendWeb();
    expect(canSaveToGallery()).toBe(false);
  });

  it("沒有 Capacitor 時直接回 false，連照片都不會去讀", async () => {
    pretendWeb();
    // FileReader 在 node 測試環境裡不存在：如果這個函式真的往下走就會 ReferenceError，
    // 回傳 false 就證明它在最前面就擋掉了
    await expect(saveCameraPhotoToGallery(photo(), new Date())).resolves.toBe(false);
  });
});

describe("原生端失敗時", () => {
  it("外掛丟錯也只會回 false，不會 throw", async () => {
    pretendNative();
    vi.spyOn(console, "warn").mockImplementation(() => {});
    // node 測試環境沒有 FileReader，等同於「讀檔這一步就失敗了」
    await expect(saveCameraPhotoToGallery(photo(), new Date())).resolves.toBe(false);
  });
});
