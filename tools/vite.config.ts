// Builds each TypeScript tool into one file for Node: the tools import engine sources, whose
// imports carry no file extensions (docs/designs/auto-mode.md, "The tools' build").
import { defineConfig } from "vite";

export default defineConfig({
  build: {
    ssr: true,
    outDir: "tools/.build",
    emptyOutDir: true,
    target: "node24",
    rolldownOptions: {
      input: { compile: "tools/packs/compile.ts" },
      output: { entryFileNames: "[name].mjs" },
    },
  },
});
