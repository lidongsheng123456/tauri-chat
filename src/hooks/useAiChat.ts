import { invoke } from "@tauri-apps/api/core";
import { useCallback, useEffect, useRef, useState } from "react";
import { useLocalStorage } from "./useLocalStorage";

/** AI 对话单条消息（用于 API 请求） */
interface AiMessage {
  role: "user" | "assistant" | "system";
  content: string;
}

/** AI 聊天消息（含加载状态、工具状态） */
export interface AiChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: number;
  loading?: boolean;
  toolStatus?: string;
}

const AI_BOT_ID = "__ai_bot__";
const AI_BOT_NAME = "AI 助手";
const STORAGE_KEY = "lanchat_ai_messages";
const MAX_CONTEXT_MESSAGES = 20;

export { AI_BOT_ID, AI_BOT_NAME };

/** 安全地将错误对象转为可读字符串 */
function formatError(err: unknown): string {
  if (typeof err === "string") return err;
  if (err instanceof Error) return err.message;
  try {
    return JSON.stringify(err);
  } catch {
    return "未知错误";
  }
}

/**
 * AI 聊天 Hook - 管理 AI 对话状态和消息发送
 * API Key 在编译时通过环境变量嵌入 Rust 二进制，前端无需管理密钥
 *
 * @returns AI 聊天相关的状态和操作方法
 */
export function useAiChat() {
  const [hasKey, setHasKey] = useState(false);
  const [chatMessages, setChatMessages] = useLocalStorage<AiChatMessage[]>(STORAGE_KEY, []);
  const [isLoading, setIsLoading] = useState(false);
  const [toolStatus, setToolStatus] = useState<string | null>(null);
  const mountedRef = useRef(true);
  const chatMessagesRef = useRef(chatMessages);
  chatMessagesRef.current = chatMessages;

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  /** 启动时检查后端是否已配置 API Key（编译时嵌入或凭据管理器） */
  useEffect(() => {
    invoke<boolean>("has_api_key").then(setHasKey).catch(() => setHasKey(false));
  }, []);

  /** 发送消息并请求 AI 回复 */
  const sendMessage = useCallback(async (content: string) => {
    if (!hasKey || !content.trim() || isLoading) return;

    const userMsg: AiChatMessage = {
      id: crypto.randomUUID(),
      role: "user",
      content: content.trim(),
      timestamp: Date.now(),
    };

    const loadingMsg: AiChatMessage = {
      id: crypto.randomUUID(),
      role: "assistant",
      content: "",
      timestamp: Date.now(),
      loading: true,
    };

    setChatMessages((prev) => [...prev, userMsg, loadingMsg]);
    setIsLoading(true);
    setToolStatus(null);

    const hasUrl = /https?:\/\/[^\s]+/.test(content);
    if (hasUrl) {
      setToolStatus("正在浏览网页...");
      setChatMessages((prev) =>
        prev.map((m) =>
          m.id === loadingMsg.id
            ? { ...m, toolStatus: "正在浏览网页并获取内容..." }
            : m
        )
      );
    }

    try {
      const contextMessages: AiMessage[] = [
        {
          role: "system",
          content: "你是 LanChat 内置的 AI 助手，简洁、友好地回答用户问题。支持中英文。" +
            "当用户提到网址或要求获取网页信息时，请使用工具获取实时内容后再回答。"
        },
      ];

      const recentHistory = [...chatMessagesRef.current, userMsg]
        .filter((m) => !m.loading)
        .slice(-MAX_CONTEXT_MESSAGES);

      for (const msg of recentHistory) {
        contextMessages.push({ role: msg.role, content: msg.content });
      }

      const reply = await invoke<string>("chat_with_ai", {
        messages: contextMessages,
      });

      if (!mountedRef.current) return;

      setChatMessages((prev) =>
        prev.map((m) =>
          m.id === loadingMsg.id
            ? { ...m, content: reply, loading: false, toolStatus: undefined, timestamp: Date.now() }
            : m
        )
      );
    } catch (err) {
      if (!mountedRef.current) return;
      setChatMessages((prev) =>
        prev.map((m) =>
          m.id === loadingMsg.id
            ? { ...m, content: `\u274c 请求失败: ${formatError(err)}`, loading: false, toolStatus: undefined, timestamp: Date.now() }
            : m
        )
      );
    } finally {
      if (mountedRef.current) {
        setIsLoading(false);
        setToolStatus(null);
      }
    }
  }, [hasKey, isLoading, setChatMessages]);

  /** 清空对话历史 */
  const clearHistory = useCallback(() => {
    setChatMessages([]);
  }, [setChatMessages]);

  return {
    hasKey,
    chatMessages,
    isLoading,
    toolStatus,
    sendMessage,
    clearHistory,
    AI_BOT_ID,
    AI_BOT_NAME,
  };
}
