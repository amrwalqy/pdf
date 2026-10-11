/// <reference types="vite/client" />

declare module "*?raw" {
  const content: string;
  export default content;
}

/** Injected from package.json by vite.config.ts. */
declare const __APP_VERSION__: string;
