import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "path";

const templateRoot = path.resolve(import.meta.dirname);

export default defineConfig({
  plugins: [react()],
  root: templateRoot,
  resolve: {
    alias: {
      "@": path.resolve(templateRoot, "src"),
      "@contracts": path.resolve(templateRoot, "contracts"),
      "@assets": path.resolve(templateRoot, "attached_assets"),
      "@db": path.resolve(templateRoot, "db"),
      "@engine": path.resolve(templateRoot, "engine"),
    },
  },
  test: {
    environment: "node",
    environmentMatchGlobs: [
      ["src/**/*.test.tsx", "jsdom"],
    ],
    setupFiles: ["./src/test/setup.ts"],
    include: [
      "api/**/*.test.ts",
      "api/**/*.spec.ts",
      "contracts/**/*.test.ts",
      "engine/**/*.test.ts",
      "cli/**/*.test.ts",
      "src/**/*.test.tsx",
    ],
    coverage: {
      provider: "v8",
      reporter: ["text", "json-summary"],
      include: ["api/**/*.ts", "engine/**/*.ts", "contracts/**/*.ts", "cli/**/*.ts"],
      exclude: ["**/*.test.ts", "**/*.test.tsx", "**/schema.ts"],
    },
  },
});
