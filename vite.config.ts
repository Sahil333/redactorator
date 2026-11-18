import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// Scripts, workers and connections come only from our own origin; WebAssembly
// needs 'wasm-unsafe-eval'. Sent as a header so the engine worker gets it too:
// a worker does not inherit a <meta> policy from the page.
const contentSecurityPolicy = [
  "default-src 'none'",
  "script-src 'self' 'wasm-unsafe-eval'",
  "worker-src 'self'",
  "connect-src 'self'",
  "img-src 'self'",
  "style-src 'self'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
].join("; ");

export default defineConfig({
  root: "app",
  plugins: [react()],
  build: { outDir: "../dist", emptyOutDir: true, target: "esnext" },
  worker: { format: "es" },
  optimizeDeps: { exclude: ["mupdf"] },
  preview: {
    host: "127.0.0.1",
    port: 4173,
    strictPort: true,
    headers: { "Content-Security-Policy": contentSecurityPolicy },
  },
});
