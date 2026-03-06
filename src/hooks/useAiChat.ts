import { invoke } from "@tauri-apps/api/core";
import { useCallback, useRef, useState } from "react";
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

/**
 * AI 聊天 Hook - 管理 AI 对话状态和消息发送
 *
 * @returns AI 聊天相关的状态和操作方法
 */
export function useAiChat() {
  const [apiKey, setApiKey, removeApiKey] = useLocalStorage<string>("lanchat_ai_api_key", "");
  const [chatMessages, setChatMessages] = useLocalStorage<AiChatMessage[]>(STORAGE_KEY, []);
  const [isLoading, setIsLoading] = useState(false);
  const [toolStatus, setToolStatus] = useState<string | null>(null);
  const abortRef = useRef(false);

  /** 发送消息并请求 AI 回复 */
  const sendMessage = useCallback(async (content: string) => {
    if (!apiKey || !content.trim() || isLoading) return;

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
    abortRef.current = false;

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

      const recentHistory = [...chatMessages, userMsg]
        .filter((m) => !m.loading)
        .slice(-MAX_CONTEXT_MESSAGES);

      for (const msg of recentHistory) {
        contextMessages.push({ role: msg.role, content: msg.content });
      }

      const reply = await invoke<string>("chat_with_ai", {
        apiKey,
        messages: contextMessages,
      });

      if (abortRef.current) return;

      setChatMessages((prev) =>
        prev.map((m) =>
          m.id === loadingMsg.id
            ? { ...m, content: reply, loading: false, toolStatus: undefined, timestamp: Date.now() }
            : m
        )
      );
    } catch (err) {
      setChatMessages((prev) =>
        prev.map((m) =>
          m.id === loadingMsg.id
            ? { ...m, content: `\u274c 请求失败: ${err}`, loading: false, toolStatus: undefined, timestamp: Date.now() }
            : m
        )
      );
    } finally {
      setIsLoading(false);
      setToolStatus(null);
    }
  }, [apiKey, chatMessages, isLoading, setChatMessages]);

  /** 清空对话历史 */
  const clearHistory = useCallback(() => {
    setChatMessages([]);
  }, [setChatMessages]);

  return {
    apiKey,
    setApiKey,
    removeApiKey,
    chatMessages,
    isLoading,
    toolStatus,
    sendMessage,
    clearHistory,
    AI_BOT_ID,
    AI_BOT_NAME,
  };
}
