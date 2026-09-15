/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** 正式環境的 API 位址，例如 https://kidney-diet-api.onrender.com/api。未設定時用相對路徑 /api */
  readonly VITE_API_BASE_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
