import { invoke } from "@tauri-apps/api/core";
import { useCallback, useRef, useState } from "react";
import { useLocalStorage } from "./useLocalStorage";

interface AiMessage {
  role: "user" | "assistant" | "system";
  content: string;
}

export interface AiChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: number;
  loading?: boolean;
}

const AI_BOT_ID = "__ai_bot__";
const AI_BOT_NAME = "AI 助手";
const STORAGE_KEY = "lanchat_ai_messages";
const MAX_CONTEXT_MESSAGES = 20;

export { AI_BOT_ID, AI_BOT_NAME };

export function useAiChat() {
  const [apiKey, setApiKey, removeApiKey] = useLocalStorage<string>("lanchat_ai_api_key", "ak_10U5lH1mi4407FY5l61Jc4kE47H3f");
  const [chatMessages, setChatMessages] = useLocalStorage<AiChatMessage[]>(STORAGE_KEY, []);
  const [isLoading, setIsLoading] = useState(false);
  const abortRef = useRef(false);

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
    abortRef.current = false;

    try {
      // Build context: last N messages
      const contextMessages: AiMessage[] = [
        { role: "system", content: "你是 LanChat 内置的 AI 助手，简洁、友好地回答用户问题。支持中英文。" },
      ];

      // Get recent history for context
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
            ? { ...m, content: reply, loading: false, timestamp: Date.now() }
            : m
        )
      );
    } catch (err) {
      setChatMessages((prev) =>
        prev.map((m) =>
          m.id === loadingMsg.id
            ? { ...m, content: `❌ 请求失败: ${err}`, loading: false, timestamp: Date.now() }
            : m
        )
      );
    } finally {
      setIsLoading(false);
    }
  }, [apiKey, chatMessages, isLoading, setChatMessages]);

  const clearHistory = useCallback(() => {
    setChatMessages([]);
  }, [setChatMessages]);

  return {
    apiKey,
    setApiKey,
    removeApiKey,
    chatMessages,
    isLoading,
    sendMessage,
    clearHistory,
    AI_BOT_ID,
    AI_BOT_NAME,
  };
}
