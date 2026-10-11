/// <reference types="vitest/config" />
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";
import { viteSingleFile } from "vite-plugin-singlefile";

const pkg = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8")) as { version: string };

/*
 * index.html contains one small inline script that paints the saved theme before React starts.
 * Instead of allowing every inline script ('unsafe-inline'), the Content-Security-Policy allows
 * exactly that script, identified by its SHA-256 hash, computed here from the final HTML.
 */
function allowBootScriptByHash(): Plugin {
  return {
    name: "alif-csp-boot-script-hash",
    transformIndexHtml: {
      order: "post",
      handler(html) {
        const match = /<script>([\s\S]*?)<\/script>/.exec(html);
        if (!match) return html;
        const hash = createHash("sha256").update(match[1], "utf8").digest("base64");
        return html.replace("script-src 'self' 'unsafe-inline' ", `script-src 'self' 'sha256-${hash}' `);
      },
    },
  };
}

// `vite build`                 -> one self-contained HTML file (browser build)
// `vite build --mode electron` -> multi-file dist/ loaded by the Windows app
export default defineConfig(({ mode }) => {
  const forElectron = mode === "electron";
  return {
    base: "./",
    define: {
      __APP_VERSION__: JSON.stringify(pkg.version),
    },
    test: {
      include: ["tests/**/*.test.ts"],
      // Key derivation and file encryption can be slow on older Windows laptops.
      testTimeout: 60_000,
      hookTimeout: 60_000,
    },
    plugins: [react(), tailwindcss(), allowBootScriptByHash(), !forElectron && viteSingleFile()].filter(Boolean),
  };
});
