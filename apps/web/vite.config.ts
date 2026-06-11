/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ mode }) => ({
  // Deployed under /app on App Platform; dev server and e2e stay at /.
  base: mode === "production" ? "/app/" : "/",
  plugins: [react()],
  test: {
    exclude: ["e2e/**", "node_modules/**", "dist/**", "test-results/**"],
  },
  server: {
    port: 5173,
    proxy: {
      "/v1": process.env.API_PROXY_TARGET ?? "http://localhost:3000",
      "/internal": process.env.API_PROXY_TARGET ?? "http://localhost:3000",
      "/hosted": process.env.API_PROXY_TARGET ?? "http://localhost:3000",
    },
  },
}));
