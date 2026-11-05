import { readdirSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { defineConfig, type Plugin } from "vite";

/** List the built files for the service worker. Local voice models are large and optional. */
function precacheManifest(): Plugin {
  let outDir = "dist";
  return {
    name: "precache-manifest",
    apply: "build",
    configResolved(config) { outDir = config.build.outDir; },
    closeBundle() {
      const files = readdirSync(outDir, { recursive: true, withFileTypes: true })
        .filter((entry) => entry.isFile())
        .map((entry) => relative(outDir, join(entry.parentPath, entry.name)).replaceAll("\\", "/"))
        .filter((file) => !file.startsWith("supertonic/") && file !== "isolation-worker.js" && file !== "index.html");
      writeFileSync(join(outDir, "precache.json"), JSON.stringify(files));
    }
  };
}

export default defineConfig(({ mode }) => ({
  oxc: { jsx: { runtime: "classic", pragma: "h", pragmaFrag: "Fragment" } },
  plugins: [precacheManifest()],
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
