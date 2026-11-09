import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
export default defineConfig(({ mode }) => {
  const { SPIELBERG_DEV_PROXY_TARGET: target = "http://127.0.0.1:8080" } =
    loadEnv(mode, ".", "SPIELBERG_DEV_PROXY_TARGET");
  return {
    plugins: [react()],
    server: {
      port:1420, strictPort:true, host:"127.0.0.1",
      proxy: {
        "/api": { target, changeOrigin: true },
        "/media": { target, changeOrigin: true },
      },
    },
    build: {
      rollupOptions: {
        output: {
          manualChunks(id) {
            if (id.includes("node_modules/react/") || id.includes("node_modules/react-dom/") || id.includes("node_modules/scheduler/")) return "react";
            if (id.includes("node_modules/@arco-design/")) return "ui";
            if (id.includes("node_modules/three/")) return "three";
            if (id.includes("node_modules/")) return "vendor";
          },
        },
      },
    },
  };
});
