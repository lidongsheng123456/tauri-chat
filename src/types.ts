/** 聊天消息数据结构 */
export interface ChatMessage {
    id: string;
    from_id: string;
    from_name: string;
    to_id: string;
    content: string;
    msg_type: "text" | "image" | "video" | "file";
    file_name?: string;
    file_size?: number;
    timestamp: number;
}

/** 用户信息 */
export interface UserInfo {
    user_id: string;
    nickname: string;
    ip: string;
}

/** WebSocket 服务端推送事件类型 */
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

/** WebSocket 客户端发送事件类型 */
export type WsSendEvent =
    | { event: "join"; data: { nickname: string; client_id: string } }
    | { event: "message"; data: ChatMessage };
