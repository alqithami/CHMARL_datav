import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";

const backendTarget = process.env.VITE_PROXY_TARGET ?? "http://localhost:8787";

export default defineConfig({
  plugins: [react()],
  base: process.env.VITE_BASE_PATH ?? "/",
  server: {
    host: "0.0.0.0",
    strictPort: true,
    allowedHosts: true,
    proxy: {
      "/api": backendTarget,
      "/health": backendTarget,
    },
  },
  resolve: {
    alias: {
      "@": resolve("src"),
    },
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          "vendor-react": ["react", "react-dom"],
          "vendor-three": ["three", "@react-three/fiber", "@react-three/drei"],
          "vendor-echarts": ["echarts"],
        },
      },
    },
  },
});
