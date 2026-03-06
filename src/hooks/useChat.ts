import { useCallback, useEffect, useRef, useState } from "react";
import { getConfig } from "../config";
import type { ChatMessage, UserInfo, WsEvent, WsSendEvent } from "../types";

/** useChat 配置项 */
interface UseChatOptions {
  serverUrl: string;
  nickname: string;
}

const STORAGE_KEY_PREFIX = "lanchat_messages_";

/** 获取或生成持久化的客户端 ID */
function getStableClientId(): string {
  const key = "lanchat_client_id";
  let id = localStorage.getItem(key);
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem(key, id);
  }
  return id;
}

/** 从 localStorage 加载指定服务器的消息历史 */
function loadMessages(serverUrl: string): ChatMessage[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_PREFIX + serverUrl);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

/** 将消息保存到 localStorage，超出上限时截断 */
function saveMessages(serverUrl: string, messages: ChatMessage[]) {
  try {
    const trimmed = messages.slice(-getConfig().max_stored_messages);
    localStorage.setItem(STORAGE_KEY_PREFIX + serverUrl, JSON.stringify(trimmed));
  } catch (e) {
    console.error("Failed to save messages:", e);
  }
}

/**
 * LAN 聊天 Hook - WebSocket 连接、消息收发、文件上传
 *
 * @returns 连接状态、用户列表、消息列表及发送/上传方法
 */
export function useChat({ serverUrl, nickname }: UseChatOptions) {
  const [connected, setConnected] = useState(false);
  const [myUserId, setMyUserId] = useState("");
  const [users, setUsers] = useState<UserInfo[]>([]);
  const [messages, setMessages] = useState<ChatMessage[]>(() => loadMessages(serverUrl));

  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectAttempts = useRef(0);
  const isConnecting = useRef(false);

  // Use refs to avoid stale closures in WebSocket callbacks
  const myUserIdRef = useRef(myUserId);
  myUserIdRef.current = myUserId;
  const nicknameRef = useRef(nickname);
  nicknameRef.current = nickname;
  const serverUrlRef = useRef(serverUrl);
  serverUrlRef.current = serverUrl;

  /** 清除重连定时器 */
  const clearReconnectTimer = useCallback(() => {
    if (reconnectTimer.current) {
      clearTimeout(reconnectTimer.current);
      reconnectTimer.current = null;
    }
  }, []);

  /** 建立 WebSocket 连接并发送 join 事件 */
  const connect = useCallback(() => {
    if (!serverUrl || !nickname) return;
    if (isConnecting.current) return;
    if (wsRef.current?.readyState === WebSocket.OPEN) return;

    isConnecting.current = true;
    clearReconnectTimer();

    try {
      const ws = new WebSocket(`ws://${serverUrl}/ws`);
      wsRef.current = ws;

      ws.onopen = () => {
        isConnecting.current = false;
        reconnectAttempts.current = 0;
        setConnected(true);
        const joinEvent: WsSendEvent = {
          event: "join",
          data: { nickname: nicknameRef.current, client_id: getStableClientId() },
        };
        ws.send(JSON.stringify(joinEvent));
      };

      ws.onmessage = (e) => {
        try {
          const event = JSON.parse(e.data) as WsEvent;
          switch (event.event) {
            case "welcome":
              setMyUserId(event.data.user_id);
              break;
            case "users":
              setUsers(event.data);
              break;
            case "message":
              setMessages((prev) => {
                if (prev.some((m) => m.id === event.data.id)) return prev;
                return [...prev, event.data];
              });
              break;
            case "history": {
              const serverHistory: ChatMessage[] = event.data ?? [];
              // Merge: server history + local-only messages
              setMessages((local) => {
                const serverIds = new Set(serverHistory.map((m) => m.id));
                const localOnly = local.filter((m) => m.id && !serverIds.has(m.id));
                const merged = [...serverHistory, ...localOnly];
                merged.sort((a, b) => a.timestamp - b.timestamp);
                return merged;
              });
              break;
            }
          }
        } catch (err) {
          console.error("Failed to parse WS message:", err);
        }
      };

      ws.onclose = () => {
        isConnecting.current = false;
        setConnected(false);
        // Exponential backoff reconnect
        const cfg = getConfig();
        const delay = Math.min(
          cfg.base_reconnect_delay_ms * Math.pow(1.5, reconnectAttempts.current),
          cfg.max_reconnect_delay_ms
        );
        reconnectAttempts.current += 1;
        reconnectTimer.current = setTimeout(() => {
          connect();
        }, delay);
      };

      ws.onerror = () => {
        isConnecting.current = false;
        ws.close();
      };
    } catch {
      isConnecting.current = false;
    }
  }, [serverUrl, nickname, clearReconnectTimer]);

  useEffect(() => {
    if (serverUrl && nickname) {
      connect();
    }
    return () => {
      clearReconnectTimer();
      if (wsRef.current) {
        wsRef.current.onclose = null; // Prevent reconnect on intentional close
        wsRef.current.close();
        wsRef.current = null;
      }
      isConnecting.current = false;
    };
  }, [connect, serverUrl, nickname, clearReconnectTimer]);

  // Persist messages to localStorage whenever they change
  useEffect(() => {
    if (serverUrl && messages.length > 0) {
      saveMessages(serverUrl, messages);
    }
  }, [messages, serverUrl]);

  /** 通过 WebSocket 发送消息 */
  const sendMessage = useCallback(
    (toId: string, content: string, msgType: "text" | "image" | "video" | "file" = "text", fileName?: string, fileSize?: number) => {
      if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;
      const msg: WsSendEvent = {
        event: "message",
        data: {
          id: "",
          from_id: myUserIdRef.current,
          from_name: nicknameRef.current,
          to_id: toId,
          content,
          msg_type: msgType,
          file_name: fileName,
          file_size: fileSize,
          timestamp: Date.now(),
        },
      };
      wsRef.current.send(JSON.stringify(msg));
    },
    [] // No deps needed — uses refs to avoid stale closures
  );

  /** 上传文件到服务器并返回 URL */
  const uploadFile = useCallback(
    async (file: File, toId: string): Promise<string | null> => {
      const msgType: "image" | "video" | "file" = file.type.startsWith("image/")
        ? "image"
        : file.type.startsWith("video/")
          ? "video"
          : "file";

      try {
        const arrayBuffer = await file.arrayBuffer();
        const response = await fetch(`http://${serverUrlRef.current}/upload`, {
          method: "POST",
          headers: {
            "Content-Type": "application/octet-stream",
            "x-file-name": encodeURIComponent(file.name),
            "x-from-id": myUserIdRef.current,
            "x-from-name": nicknameRef.current,
            "x-to-id": toId,
            "x-msg-type": msgType,
          },
          body: arrayBuffer,
        });
        if (!response.ok) {
          console.error("Upload HTTP error:", response.status);
          return null;
        }
        const result = await response.json();
        return result.ok ? result.url : null;
      } catch (err) {
        console.error("Upload failed:", err);
        return null;
      }
    },
    [] // No deps needed — uses refs to avoid stale closures
  );

  return {
    connected,
    myUserId,
    users,
    messages,
    sendMessage,
    uploadFile,
  };
}
