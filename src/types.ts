/**
 * types.ts — 全局共享类型定义
 *
 * 包含前后端协议中所有核心数据结构的 TypeScript 类型，
 * 是前端与 Rust 后端之间消息格式的唯一来源（single source of truth）。
 */

/**
 * 单条聊天消息的完整数据结构，用于前端渲染与本地持久化存储。
 *
 * 由服务端通过 WebSocket `message` 或 `history` 事件下发，
 * 字段命名与 Rust 端的 `ChatMessage` 结构体保持一致（snake_case）。
 */
export interface ChatMessage {
    /** 消息的全局唯一标识符，由服务端通过 UUID v4 生成。 */
    id: string;
    /** 发送方的用户 ID，与 `UserInfo.user_id` 对应。 */
    from_id: string;
    /** 发送方的昵称，直接用于前端渲染，无需二次查询用户列表。 */
    from_name: string;
    /** 接收方的用户 ID；群聊消息时值为 `"all"`。 */
    to_id: string;
    /**
     * 消息的主要内容：
     * - 文本消息（`msg_type === "text"`）：消息正文字符串。
     * - 文件类消息（`image` / `video` / `file`）：服务器上的相对路径，格式为 `/files/<filename>`。
     */
    content: string;
    /** 消息类型，决定前端气泡的渲染方式。 */
    msg_type: "text" | "image" | "video" | "file";
    /** 文件的原始文件名，仅文件类消息存在，用于展示文件名与判断图标类型。 */
    file_name?: string;
    /** 文件大小（字节），仅文件类消息存在，用于在 FileCard 中显示文件大小。 */
    file_size?: number;
    /** 消息创建时间的 Unix 时间戳（毫秒），由服务端写入，用于消息排序与时间显示。 */
    timestamp: number;
}

/**
 * 在线用户的简要信息，由服务端通过 WebSocket `users` 事件批量下发。
 *
 * 与 Rust 端的 `UserInfo` 结构体字段一一对应。
 */
export interface UserInfo {
    /** 用户的唯一 ID，由客户端生成的稳定 UUID，重连后保持不变。 */
    user_id: string;
    /** 用户登录时填写的昵称。 */
    nickname: string;
    /** 用户客户端的 IPv4 地址字符串，格式为点分十进制（如 `"192.168.1.5"`）。 */
    ip: string;
}

/**
 * WebSocket 服务端向客户端推送的事件联合类型。
 *
 * 所有事件均以 `{ event, data }` 格式封装，前端通过 `event` 字段进行类型收窄（narrowing）。
 *
 * 事件说明：
 * - `welcome`  — 客户端加入成功后收到的欢迎消息，携带服务端分配的 `user_id`。
 * - `users`    — 当前在线用户列表，每次有人加入或离开时广播。
 * - `message`  — 一条新的聊天消息，需在前端去重后追加到消息列表。
 * - `history`  — 服务端内存中的历史消息列表，客户端加入时一次性下发。
 * - `join`     — 其他用户加入房间的通知（当前版本仅记录，未在 UI 中展示）。
 * - `error`    — 服务端返回的错误信息。
 */
export type WsEvent =
    | {
          event: "welcome";
          data: { user_id: string; nickname: string; ip: string };
      }
    | { event: "users"; data: UserInfo[] }
    | { event: "message"; data: ChatMessage }
    | { event: "history"; data: ChatMessage[] }
    | { event: "join"; data: { nickname: string } }
    | { event: "error"; data: { message: string } };

/**
 * WebSocket 客户端向服务端发送的事件联合类型。
 *
 * 与 `WsEvent` 对应，前端通过 `JSON.stringify` 序列化后经 WebSocket 发送。
 *
 * 事件说明：
 * - `join`    — 客户端连接后发送的加入请求，携带昵称与持久化客户端 ID。
 * - `message` — 客户端发送的一条聊天消息，服务端会覆盖 `id`、`from_id` 等字段。
 */
export type WsSendEvent =
    | { event: "join"; data: { nickname: string; client_id: string } }
    | { event: "message"; data: ChatMessage };
