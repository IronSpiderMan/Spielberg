import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
export default defineConfig(function (_a) {
    var mode = _a.mode;
    var _b = loadEnv(mode, ".", "SPIELBERG_DEV_PROXY_TARGET").SPIELBERG_DEV_PROXY_TARGET, target = _b === void 0 ? "http://127.0.0.1:8080" : _b;
    return {
        plugins: [react()],
        server: {
            port: 1420, strictPort: true, host: "127.0.0.1",
            proxy: {
                "/api": { target: target, changeOrigin: true },
                "/media": { target: target, changeOrigin: true },
            },
        },
        build: {
            rollupOptions: {
                output: {
                    manualChunks: function (id) {
                        if (id.includes("node_modules/react/") || id.includes("node_modules/react-dom/") || id.includes("node_modules/scheduler/"))
                            return "react";
                        if (id.includes("node_modules/@arco-design/"))
                            return "ui";
                        if (id.includes("node_modules/three/"))
                            return "three";
                        if (id.includes("node_modules/"))
                            return "vendor";
                    },
                },
            },
        },
    };
});
