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

export interface UserInfo {
  user_id: string;
  nickname: string;
  ip: string;
}

export interface WsEvent {
  event: string;
  data: any;
}
