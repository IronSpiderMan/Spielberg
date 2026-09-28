import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
export default defineConfig({
    plugins: [react()],
    server: { port: 1420, strictPort: true, host: "127.0.0.1" },
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
});
