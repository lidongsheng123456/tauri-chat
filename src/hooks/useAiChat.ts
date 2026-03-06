import { invoke } from "@tauri-apps/api/core";
import { useCallback, useEffect, useRef, useState } from "react";
import { getConfig } from "../config";
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

export { AI_BOT_ID, AI_BOT_NAME };

/** 根据消息内容推测可能触发的工具，返回状态提示 */
function detectToolHint(content: string): string | null {
  const lower = content.toLowerCase();
  if (/https?:\/\/[^\s]+/.test(content)) return "正在浏览网页并获取内容...";
  if (/搜索|搜一下|查找|查一查|帮我查|search|google/i.test(lower)) return "正在搜索互联网...";
  if (/几点|时间|日期|今天|星期|what time|today/i.test(lower)) return "正在获取当前时间...";
  if (/编码|解码|base64|encode|decode|hex/i.test(lower)) return "正在编码/解码...";
  if (/ip.*位置|ip.*地址|geolocation|ip.*查询/i.test(lower)) return "正在查询 IP 信息...";
  if (/图片|提取.*图|images|extract.*img/i.test(lower) && /https?:\/\//.test(content)) return "正在提取网页图片...";
  if (/读取文件|查看文件|read.*file|打开.*文件|看一下.*代码/i.test(lower)) return "正在读取文件...";
  if (/写入文件|创建文件|新建.*文件|write.*file|生成.*脚本|修改.*文件|改.*bug/i.test(lower)) return "正在操作文件...";
  if (/列出.*目录|目录.*结构|文件夹.*内容|list.*dir|ls /i.test(lower)) return "正在浏览目录...";
  if (/搜索文件|查找文件|search.*file|找.*文件/i.test(lower)) return "正在搜索文件...";
  if (/删除文件|删除目录|delete.*file|remove/i.test(lower)) return "正在删除...";
  if (/创建目录|新建文件夹|mkdir|create.*dir/i.test(lower)) return "正在创建目录...";
  return null;
}

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

    const toolHint = detectToolHint(content);
    if (toolHint) {
      setToolStatus(toolHint);
      setChatMessages((prev) =>
        prev.map((m) =>
          m.id === loadingMsg.id ? { ...m, toolStatus: toolHint } : m
        )
      );
    }

    try {
      const contextMessages: AiMessage[] = [
        {
          role: "system",
          content: "你是 LanChat 内置的 AI 助手，简洁、友好地回答用户问题。支持中英文。" +
            "你拥有多种工具能力：浏览网页、搜索互联网、提取网页图片、获取当前时间、编解码文本、查询IP地理位置、统计文本信息、" +
            "读取文件、写入/创建文件、列出目录、创建目录、删除文件或目录、按关键词搜索文件。" +
            "用户提供文件路径时，你可以读取代码、修改bug、新建脚本、管理文件夹结构。" +
            "当用户的问题涉及以上能力时，请主动使用对应的工具获取实时数据后再回答。"
        },
      ];

      const recentHistory = [...chatMessagesRef.current, userMsg]
        .filter((m) => !m.loading)
        .slice(-getConfig().max_context_messages);

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
