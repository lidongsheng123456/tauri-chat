import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const host = process.env.TAURI_DEV_HOST;

// Vite 官方配置文档：https://vite.dev/config/
export default defineConfig({
    plugins: [react()],
    clearScreen: false,
    server: {
        port: 5173,
        strictPort: true,
        host: host || "127.0.0.1",
        hmr: host
            ? {
                  protocol: "ws",
                  host,
                  port: 5174,
              }
            : undefined,
        watch: {
            ignored: ["**/src-tauri/**"],
        },
    },
    build: {
        rollupOptions: {
            output: {
                manualChunks: (id) => {
                    // Mermaid 及其所有子图表独立分包（体积最大，按需加载）
                    if (
                        id.includes("mermaid") ||
                        id.includes("node_modules/mermaid")
                    ) {
                        return "vendor-mermaid";
                    }
                    // @ant-design/x 组件库
                    if (id.includes("@ant-design/x")) {
                        return "vendor-antd-x";
                    }
                    // antd 核心（体积较大，独立分包）
                    if (id.includes("node_modules/antd")) {
                        return "vendor-antd";
                    }
                    // @ant-design 相关（icons、colors、cssinjs 等）合并入 antd 包避免循环引用
                    if (id.includes("@ant-design")) {
                        return "vendor-antd";
                    }
                    // rc-* 组件（antd 底层依赖）
                    if (id.includes("node_modules/rc-")) {
                        return "vendor-rc";
                    }
                    // React 核心
                    if (
                        id.includes("node_modules/react/") ||
                        id.includes("node_modules/react-dom/")
                    ) {
                        return "vendor-react";
                    }
                    // react-markdown 及其插件
                    if (
                        id.includes("react-markdown") ||
                        id.includes("remark-") ||
                        id.includes("rehype-") ||
                        id.includes("unified") ||
                        id.includes("vfile") ||
                        id.includes("hast") ||
                        id.includes("mdast")
                    ) {
                        return "vendor-markdown";
                    }
                    // highlight.js 语法高亮
                    if (id.includes("highlight.js")) {
                        return "vendor-highlight";
                    }
                    // lucide 图标
                    if (id.includes("lucide-react")) {
                        return "vendor-lucide";
                    }
                },
            },
        },
        // 提高单包警告阈值（mermaid 本身较大）
        chunkSizeWarningLimit: 600,
    },
});
