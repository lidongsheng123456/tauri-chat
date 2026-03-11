import { XProvider } from "@ant-design/x";
import { ConfigProvider } from "antd";
import zhCN from "antd/locale/zh_CN";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";

/**
 * main.tsx — React 应用挂载入口
 *
 * 负责将根组件 `App` 挂载到 HTML 的 `#root` 节点，
 * 并完成以下全局配置的初始化：
 * - `StrictMode`：开发环境下启用额外检查，帮助发现潜在问题（生产环境无影响）。
 * - `ConfigProvider`：Ant Design 全局配置，设置中文语言包与主题令牌。
 * - `XProvider`：@ant-design/x 全局上下文，`Bubble`、`Prompts` 等组件的运行依赖。
 *
 * 主题令牌说明：
 * - `colorPrimary`  — 全局主色调，采用 AI 蓝（`#2563EB`），与 CSS 变量 `--accent` 保持一致。
 * - `borderRadius`  — 统一圆角大小（`8px`），与 base.css 中的卡片圆角保持一致。
 * - `fontFamily`    — 与 base.css 中定义的字体栈保持一致，确保 Ant Design 组件使用相同字体。
 */
createRoot(document.getElementById("root")!).render(
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
