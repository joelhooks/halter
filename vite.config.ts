// The workspace program's browser build: one script, app.js, with Foldkit's view-identity transform.
// The pages themselves come from site.ts.
import { foldkit } from "@foldkit/vite-plugin";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [foldkit({ devToolsMcpPort: false })],
  logLevel: "warn",
  build: {
    outDir: "dist-client",
    emptyOutDir: true,
    rolldownOptions: {
      input: "src/ws/entry.ts",
      output: { format: "iife", entryFileNames: "app.js", codeSplitting: false },
    },
  },
});
