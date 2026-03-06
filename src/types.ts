/** 头像颜色总数 */
const AVATAR_COLOR_COUNT = 7;

/** 根据昵称生成头像颜色类名 */
export function getAvatarColorClass(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
  return `avatar-color-${Math.abs(hash) % AVATAR_COLOR_COUNT}`;
}

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
  | { event: "welcome"; data: { user_id: string; nickname: string; ip: string } }
  | { event: "users"; data: UserInfo[] }
  | { event: "message"; data: ChatMessage }
  | { event: "history"; data: ChatMessage[] }
  | { event: "join"; data: { nickname: string } }
  | { event: "error"; data: { message: string } };

/** WebSocket 客户端发送事件类型 */
export type WsSendEvent =
  | { event: "join"; data: { nickname: string; client_id: string } }
  | { event: "message"; data: ChatMessage };
