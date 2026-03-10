/**
 * storage.ts — 聊天数据本地持久化工具函数
 *
 * 纯函数（getStableClientId 除外，有 localStorage 副作用），无 React 依赖，
 * 可在项目任意位置安全引用。
 */

import { getConfig } from "../config";
import type { ChatMessage } from "../types";

/** localStorage 消息前缀，避免与其他键名冲突 */
const STORAGE_KEY_PREFIX = "lanchat_messages_";

/**
 * 获取或生成持久化的客户端唯一 ID。
 *
 * 首次调用时生成 UUID 并写入 localStorage，后续调用直接返回缓存值。
 * 用于 WebSocket join 事件，确保同一客户端重连后 ID 不变。
 */
export function getStableClientId(): string {
    const key = "lanchat_client_id";
    let id = localStorage.getItem(key);
    if (!id) {
        id = crypto.randomUUID();
        localStorage.setItem(key, id);
    }
    return id;
}

/**
 * 从 localStorage 加载指定服务器的消息历史。
 *
 * @param serverUrl - 服务器地址（含端口），作为存储 key 的一部分
 * @returns 解析成功时返回消息数组，键不存在或解析失败时返回空数组
 */
export function loadMessages(serverUrl: string): ChatMessage[] {
    if (!serverUrl) return [];
    try {
        const raw = localStorage.getItem(STORAGE_KEY_PREFIX + serverUrl);
        return raw ? (JSON.parse(raw) as ChatMessage[]) : [];
    } catch {
        return [];
    }
}

/**
 * 将消息列表持久化到 localStorage，超出上限时从头截断。
 *
 * 截断策略：保留最新的 max_stored_messages 条，旧消息丢弃。
 *
 * @param serverUrl - 服务器地址（含端口），作为存储 key 的一部分
 * @param messages  - 当前完整消息列表
 */
export function saveMessages(serverUrl: string, messages: ChatMessage[]): void {
    if (!serverUrl) return;
    try {
        const trimmed = messages.slice(-getConfig().max_stored_messages);
        localStorage.setItem(
            STORAGE_KEY_PREFIX + serverUrl,
            JSON.stringify(trimmed),
        );
    } catch (e) {
        console.error("消息持久化失败:", e);
    }
}
