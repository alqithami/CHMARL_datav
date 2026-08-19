import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";

const backendTarget = process.env.VITE_PROXY_TARGET ?? "http://localhost:8787";

function vendorChunk(id: string) {
  const normalizedId = id.replaceAll("\\", "/");
  if (!normalizedId.includes("/node_modules/")) return undefined;

  if (
    normalizedId.includes("/node_modules/react/") ||
    normalizedId.includes("/node_modules/react-dom/") ||
    normalizedId.includes("/node_modules/scheduler/")
  ) {
    return "vendor-react";
  }
  if (normalizedId.includes("/node_modules/leaflet/")) {
    return "vendor-leaflet";
  }
  if (
    normalizedId.includes("/node_modules/echarts/") ||
    normalizedId.includes("/node_modules/zrender/")
  ) {
    return "vendor-charts";
  }
  return undefined;
}

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
    chunkSizeWarningLimit: 900,
    rollupOptions: {
      output: {
        manualChunks: vendorChunk,
      },
    },
  },
});
