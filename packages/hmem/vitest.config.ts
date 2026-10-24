import { existsSync } from "node:fs";
import { defineConfig } from "vitest/config";

// Postgres tests read DATABASE_URL from the monorepo .env; they skip without it.
if (existsSync("../../.env")) process.loadEnvFile("../../.env");

export default defineConfig({
  resolve: { conditions: ["development"] },
  test: { include: ["test/**/*.test.ts"] },
});
