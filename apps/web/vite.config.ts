import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

const envDir = "../..";
const plugins = [react(), tailwindcss()];

export default defineConfig(({ command, mode }) => {
  if (command === "build") return { plugins, envDir };

  const env = loadEnv(mode, envDir, "");
  for (const key of ["WEB_PORT", "API_PORT"]) {
    if (!env[key]) throw new Error(`Missing ${key} in .env`);
  }

  return {
    plugins,
    envDir,
    server: {
      port: Number(env.WEB_PORT),
      strictPort: true,
      proxy: { "/api": `http://localhost:${env.API_PORT}` },
    },
  };
});
