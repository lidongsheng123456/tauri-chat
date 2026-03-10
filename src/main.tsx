import { XProvider } from "@ant-design/x";
import { ConfigProvider } from "antd";
import zhCN from "antd/locale/zh_CN";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";

// 挂载 React 应用到 #root 节点
createRoot(document.getElementById("root")!).render(
    // StrictMode：开发环境下启用额外检查，帮助发现潜在问题
    <StrictMode>
        {/* antd 全局配置：中文语言包 + 主题令牌 */}
        <ConfigProvider
            locale={zhCN}
            theme={{
                token: {
                    // 主色调：AI 蓝
                    colorPrimary: "#2563EB",
                    // 统一圆角大小
                    borderRadius: 8,
                    // 与 base.css 保持一致的字体栈
                    fontFamily:
                        '-apple-system, BlinkMacSystemFont, "SF Pro Text", "Helvetica Neue", "Inter", "Noto Sans SC", sans-serif',
                },
            }}
        >
            {/* XProvider：@ant-design/x 全局上下文（Bubble、Prompts 等组件依赖） */}
            <XProvider>
                <App />
            </XProvider>
        </ConfigProvider>
    </StrictMode>,
);
