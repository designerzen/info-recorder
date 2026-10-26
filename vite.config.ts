import { defineConfig } from "vite";

export default defineConfig(({ mode }) => ({
  oxc: { jsx: { runtime: "classic", pragma: "h", pragmaFrag: "Fragment" } },
  server: {
    // Browser assertions must not be reset by live edits in a shared workspace.
    hmr: mode === "e2e" ? false : undefined,
    watch: mode === "e2e" ? null : undefined,
    headers: {
      "Cross-Origin-Opener-Policy": "same-origin",
      "Cross-Origin-Embedder-Policy": "require-corp"
    }
  },
  preview: {
    headers: {
      "Cross-Origin-Opener-Policy": "same-origin",
      "Cross-Origin-Embedder-Policy": "require-corp"
    }
  },
  worker: {
    format: "es"
  },
  test: {
    environment: "jsdom",
    setupFiles: ["./tests/setup.ts"],
    include: ["tests/**/*.test.{ts,tsx}"],
    exclude: ["tests/e2e/**"]
  }
}));
