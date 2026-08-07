/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** URL base da API real (usada pelo httpClient). */
  readonly VITE_API_BASE_URL?: string
  /** 'true' | 'false' — escolhe entre mockClient e httpClient (default: mock). */
  readonly VITE_USE_MOCKS?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
