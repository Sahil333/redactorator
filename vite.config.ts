import { relative } from "node:path";
import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { createInstrumenter } from "istanbul-lib-instrument";
import { defineConfig, type Plugin } from "vite";

// Scripts, workers, fonts and connections come only from our own origin; WebAssembly
// needs 'wasm-unsafe-eval'. Sent as a header so the engine worker gets it too:
// a worker does not inherit a <meta> policy from the page.
const contentSecurityPolicy = [
  "default-src 'none'",
  "script-src 'self' 'wasm-unsafe-eval'",
  "worker-src 'self'",
  "connect-src 'self'",
  "img-src 'self'",
  "font-src 'self'",
  "style-src 'self'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
].join("; ");

// `COVERAGE=1` builds into dist-coverage, never dist, with our sources instrumented, so the
// browser tests can count what they run and fallow can score complexity against it.
const coverage = process.env.COVERAGE === "1";
const repo = fileURLToPath(new URL(".", import.meta.url));

function instrument(): Plugin {
  // No `new Function` to find the global: the page's policy forbids eval.
  const options = { esModules: true, coverageGlobalScope: "globalThis", coverageGlobalScopeFunc: false };
  const ts = createInstrumenter({ ...options, parserPlugins: ["typescript"] });
  const tsx = createInstrumenter({ ...options, parserPlugins: ["typescript", "jsx"] });
  return {
    name: "instrument-for-coverage",
    enforce: "pre",
    transform(code, id) {
      if (!/^(app|engine)\/.*\.tsx?$/.test(relative(repo, id))) return undefined;
      const instrumenter = id.endsWith(".tsx") ? tsx : ts;
      // The counts already refer to the source as written, so no source map is needed.
      return { code: instrumenter.instrumentSync(code, id), map: null };
    },
  };
}

export default defineConfig({
  root: "app",
  plugins: [react(), tailwindcss(), ...(coverage ? [instrument()] : [])],
  build: { outDir: coverage ? "../dist-coverage" : "../dist", emptyOutDir: true, target: "esnext" },
  worker: { format: "es", plugins: () => (coverage ? [instrument()] : []) },
  optimizeDeps: { exclude: ["mupdf"] },
  preview: {
    host: "127.0.0.1",
    port: 4173,
    strictPort: true,
    headers: { "Content-Security-Policy": contentSecurityPolicy },
  },
});
