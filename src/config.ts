import { tauriInvoke } from "./utils/tauri";

/**
 * 前端运行时配置，从 Rust 后端 `get_frontend_config` 命令获取。
 *
 * 对应 Rust 端的 `FrontendConfig` 结构体，字段命名保持一致。
 */
export interface AppConfig {
    /** 聊天服务的 HTTP/WebSocket 监听端口，用于构造 WebSocket 连接地址。 */
    chat_port: number;
    /** 发送给 AI 的上下文中最多携带的历史消息条数。 */
    max_context_messages: number;
    /** 本地持久化存储的最大消息条数，超出时自动删除最旧的记录。 */
    max_stored_messages: number;
    /** WebSocket 断线重连等待时间的最大上限（毫秒），采用指数退避时不超过此值。 */
    max_reconnect_delay_ms: number;
    /** WebSocket 断线重连等待时间的初始基准值（毫秒）。 */
    base_reconnect_delay_ms: number;
}

/**
 * 后端配置加载失败时的兜底默认值，与 `lanchat.config.json` 中的默认配置保持一致。
 */
const DEFAULTS: AppConfig = {
    chat_port: 9120,
    max_context_messages: 20,
    max_stored_messages: 2000,
    max_reconnect_delay_ms: 30000,
    base_reconnect_delay_ms: 2000,
};

let cached: AppConfig | null = null;

/**
 * 从 Rust 后端加载前端运行时配置，并缓存结果供后续同步访问。
 *
 * 对应 Rust Command: `get_frontend_config`
 *
 * 首次调用时通过 `tauriInvoke` 请求后端获取配置；后续调用直接返回缓存，
 * 不再发起 IPC 请求。应在应用启动时尽早调用一次（如 `App` 组件的 `useEffect` 中）。
 *
 * @returns {Promise<AppConfig>} 后端返回的运行时配置；若后端调用失败则返回默认值。
 */
export async function loadConfig(): Promise<AppConfig> {
    if (cached) return cached;
    cached = (await tauriInvoke<AppConfig>("get_frontend_config")) ?? DEFAULTS;
    return cached;
}

/**
 * 同步获取已缓存的前端运行时配置。
 *
 * 若 `loadConfig` 尚未完成，返回内置默认值而非 `null`，确保调用方始终得到有效配置。
 * 在需要同步读取配置的场景（如 `useMemo`、`useCallback` 内部）使用此函数。
 *
 * @returns {AppConfig} 已缓存的运行时配置，或尚未加载时的默认配置。
 */
export function getConfig(): AppConfig {
    return cached ?? DEFAULTS;
}
