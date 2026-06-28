import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";

const backendTarget = process.env.VITE_PROXY_TARGET ?? "http://localhost:8787";

export default defineConfig({
  plugins: [react()],
  base: process.env.VITE_BASE_PATH ?? "/",
  server: {
    proxy: {
      "/api/vessels": backendTarget,
      "/api/chmarl": backendTarget,
      "/health": backendTarget,
    },
  },
  resolve: {
    alias: {
      "@": resolve("src"),
    },
  },
});
