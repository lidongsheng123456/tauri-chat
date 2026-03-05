import { useCallback, useEffect, useRef, useState } from "react";
import type { ChatMessage, UserInfo, WsEvent } from "../types";

interface UseChatOptions {
  serverUrl: string;
  nickname: string;
}

export function useChat({ serverUrl, nickname }: UseChatOptions) {
  const [connected, setConnected] = useState(false);
  const [myUserId, setMyUserId] = useState("");
  const [users, setUsers] = useState<UserInfo[]>([]);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimer = useRef<number | null>(null);

  const connect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) return;

    const ws = new WebSocket(`ws://${serverUrl}/ws`);
    wsRef.current = ws;

    ws.onopen = () => {
      setConnected(true);
      const joinEvent: WsEvent = {
        event: "join",
        data: { nickname },
      };
      ws.send(JSON.stringify(joinEvent));
    };

    ws.onmessage = (e) => {
      try {
        const event: WsEvent = JSON.parse(e.data);
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
          case "history":
            setMessages(event.data || []);
            break;
        }
      } catch (err) {
        console.error("Failed to parse WS message:", err);
      }
    };

    ws.onclose = () => {
      setConnected(false);
      reconnectTimer.current = window.setTimeout(() => {
        connect();
      }, 3000);
    };

    ws.onerror = () => {
      ws.close();
    };
  }, [serverUrl, nickname]);

  useEffect(() => {
    if (nickname) {
      connect();
    }
    return () => {
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
      wsRef.current?.close();
    };
  }, [connect, nickname]);

  const sendMessage = useCallback(
    (toId: string, content: string, msgType: string = "text", fileName?: string, fileSize?: number) => {
      if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;
      const msg: WsEvent = {
        event: "message",
        data: {
          id: "",
          from_id: myUserId,
          from_name: nickname,
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
    [myUserId, nickname]
  );

  const uploadFile = useCallback(
    async (file: File, toId: string): Promise<string | null> => {
      const msgType = file.type.startsWith("image/")
        ? "image"
        : file.type.startsWith("video/")
          ? "video"
          : "file";

      try {
        const arrayBuffer = await file.arrayBuffer();
        const response = await fetch(`http://${serverUrl}/upload`, {
          method: "POST",
          headers: {
            "Content-Type": "application/octet-stream",
            "x-file-name": encodeURIComponent(file.name),
            "x-from-id": myUserId,
            "x-from-name": nickname,
            "x-to-id": toId,
            "x-msg-type": msgType,
          },
          body: arrayBuffer,
        });
        const result = await response.json();
        return result.ok ? result.url : null;
      } catch (err) {
        console.error("Upload failed:", err);
        return null;
      }
    },
    [serverUrl, myUserId, nickname]
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
