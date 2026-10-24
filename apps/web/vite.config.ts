import { fileURLToPath } from "node:url";
import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

const envDir = "../..";
const plugins = [react(), tailwindcss()];
// "@/..." imports resolve to src/, as in tsconfig.json (used by shadcn/ui).
const resolve = { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } };

export default defineConfig(({ command, mode }) => {
  if (command === "build") return { plugins, resolve, envDir };

  const env = loadEnv(mode, envDir, "");
  for (const key of ["WEB_PORT", "API_PORT"]) {
    if (!env[key]) throw new Error(`Missing ${key} in .env`);
  }

  return {
    plugins,
    resolve,
    envDir,
    server: {
      port: Number(env.WEB_PORT),
      strictPort: true,
      // OAuth providers that require HTTPS redirects (Slack) are tested through an ngrok tunnel.
      allowedHosts: [".ngrok-free.dev", ".ngrok-free.app"],
      proxy: { "/api": `http://localhost:${env.API_PORT}` },
    },
  };
});
