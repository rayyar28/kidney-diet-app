import { readFileSync, existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
// @ts-expect-error 純 JS 的建置腳本，沒有型別宣告
import { DEFAULT_XML } from "../../scripts/hospital-apk.mjs";

/*
 * repo 是公開的。打包醫院版 APK 時，scripts/hospital-apk.mjs 會暫時把醫院主機的 IP
 * 與 CA 放進 Android 專案，建置完再換回來。這裡守的是「忘記換回來就 commit 出去」：
 * 醫院的 IP 與 CA（上面有醫院名稱）會指出是哪一家醫院、哪一台電腦。
 */
describe("Android 憑證設定：進版控的必須是不含醫院資訊的預設版本", () => {
  const root = new URL("../../android/app/src/main/", import.meta.url);

  it("network_security_config.xml 與預設內容完全一致", () => {
    const xml = readFileSync(new URL("res/xml/network_security_config.xml", root), "utf8");
    // 換行統一一下：Windows 上 git 可能幫檔案轉成 CRLF
    expect(xml.replace(/\r\n/g, "\n")).toBe(DEFAULT_XML);
  });

  it("預設版本裡沒有任何主機位址，也沒有引用醫院 CA", () => {
    expect(DEFAULT_XML).not.toMatch(/<domain[\s>]/);
    expect(DEFAULT_XML).not.toMatch(/hospital_ca/);
    expect(DEFAULT_XML).not.toMatch(/\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}/);
  });

  it("醫院 CA 檔案沒有留在 Android 專案裡", () => {
    expect(existsSync(new URL("res/raw/hospital_ca.pem", root))).toBe(false);
  });

  it("AndroidManifest 有指向這份設定（沒有的話設定檔形同虛設）", () => {
    const manifest = readFileSync(new URL("AndroidManifest.xml", root), "utf8");
    expect(manifest).toMatch(/android:networkSecurityConfig="@xml\/network_security_config"/);
  });
});
