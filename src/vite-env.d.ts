/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** CLS-03 (D-061): model phân loại do vite.config.ts (resolveClassifier) chọn lúc build hay khởi động dev server. */
  readonly VITE_WCT_CLASSIFIER?: 'stub' | 'model'
}
