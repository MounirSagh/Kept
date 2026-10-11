import { existsSync } from "node:fs";
import { defineConfig } from "prisma/config";

// Locally, load the monorepo root .env; in containers env vars are injected.
const rootEnv = "../../.env";
if (existsSync(rootEnv)) process.loadEnvFile(rootEnv);

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  // `prisma generate` needs no database, so the URL is only required by
  // commands that connect (migrate, studio), which fail loudly without it.
  datasource: { url: process.env.DATABASE_URL },
});
