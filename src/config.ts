import { invoke } from "@tauri-apps/api/core";

/** 前端运行时配置（从 Rust 后端获取） */
export interface AppConfig {
  chat_port: number;
  max_context_messages: number;
  max_stored_messages: number;
  max_reconnect_delay_ms: number;
  base_reconnect_delay_ms: number;
}

/** 默认配置（后端加载失败时的兜底） */
const DEFAULTS: AppConfig = {
  chat_port: 9120,
  max_context_messages: 20,
  max_stored_messages: 2000,
  max_reconnect_delay_ms: 30000,
  base_reconnect_delay_ms: 2000,
};

let cached: AppConfig | null = null;

/** 加载配置（仅首次调用时请求后端，后续返回缓存） */
export async function loadConfig(): Promise<AppConfig> {
  if (cached) return cached;
  try {
    cached = await invoke<AppConfig>("get_frontend_config");
  } catch {
    cached = DEFAULTS;
  }
  return cached;
}

/** 同步获取已缓存的配置（loadConfig 之前调用返回默认值） */
export function getConfig(): AppConfig {
  return cached ?? DEFAULTS;
}
