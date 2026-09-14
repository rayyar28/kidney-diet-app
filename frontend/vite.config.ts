import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["favicon.svg"],
      manifest: {
        name: "腎臟飲食小幫手",
        short_name: "腎飲食",
        description: "幫助腎臟病人記錄三餐、追蹤鈉鉀磷攝取的飲食紀錄 App",
        theme_color: "#2f6f5e",
        background_color: "#f6f3ec",
        display: "standalone",
        start_url: "/",
        icons: [
          { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
          { src: "/icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
      },
      workbox: {
        // API 請求 (含照片上傳) 一律直接打網路，不做離線快取，避免資料一致性問題
        navigateFallbackDenylist: [/^\/api\//],
      },
    }),
  ],
  server: {
    host: true, // 綁定所有網卡，讓同一區網內的手機也能連進來
    port: 5173,
    // Vite 5+ 預設只接受 Host header 為 localhost 的請求，手機用區網 IP 連線時
    // 會被擋下來，所以這裡明確放行任何 Host
    allowedHosts: true,
    proxy: {
      "/api": {
        target: process.env.VITE_API_PROXY_TARGET ?? "http://localhost:4000",
        changeOrigin: true,
      },
    },
  },
});
