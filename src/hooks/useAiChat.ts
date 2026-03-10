import { invoke } from "@tauri-apps/api/core";
import {
    useCallback,
    useEffect,
    useLayoutEffect,
    useRef,
    useState,
} from "react";
import { formatError } from "../utils/format";
import { getConfig } from "../config";
import { detectToolHint } from "../utils/aiHelper";
import { useLocalStorage } from "./useLocalStorage";

/** AI 对话单条消息（用于 API 请求） */
interface AiMessage {
    role: "user" | "assistant" | "system";
    content: string;
}

export interface AiToolCallTrace {
    tool_call_id: string;
    tool_name: string;
    arguments: unknown;
    result: string;
}

export interface AiToolRoundTrace {
    round: number;
    thinking?: string | null;
    tool_calls: AiToolCallTrace[];
}

interface AiChatResponse {
    summary: string;
    rounds: AiToolRoundTrace[];
}

export interface AiChatMessage {
    id: string;
    role: "user" | "assistant";
    content: string;
    timestamp: number;
    loading?: boolean;
    toolStatus?: string;
    toolRounds?: AiToolRoundTrace[];
}

const AI_BOT_ID = "__ai_bot__";
const AI_BOT_NAME = "AI 助手";
const STORAGE_KEY = "lanchat_ai_messages";

export { AI_BOT_ID, AI_BOT_NAME };

/**
 * AI 聊天 Hook - 管理 AI 对话状态和消息发送
 * API Key 在编译时通过环境变量嵌入 Rust 二进制，前端无需管理密钥
 *
 * @returns AI 聊天相关的状态和操作方法
 */
export function useAiChat() {
    const [hasKey, setHasKey] = useState(false);
    const [chatMessages, setChatMessages] = useLocalStorage<AiChatMessage[]>(
        STORAGE_KEY,
        [],
    );
    const [isLoading, setIsLoading] = useState(false);
    const [toolStatus, setToolStatus] = useState<string | null>(null);
    const mountedRef = useRef(true);
    const streamTimerRef = useRef<number | null>(null);
    const streamSessionRef = useRef(0);
    const chatMessagesRef = useRef(chatMessages);

    // 在浏览器绘制前同步更新 ref，确保 sendMessage 中读到的始终是最新消息列表
    useLayoutEffect(() => {
        chatMessagesRef.current = chatMessages;
    }, [chatMessages]);

    const stopStreaming = useCallback(() => {
        streamSessionRef.current += 1;
        if (streamTimerRef.current !== null) {
            window.clearTimeout(streamTimerRef.current);
            streamTimerRef.current = null;
        }
    }, []);

    useEffect(() => {
        mountedRef.current = true;
        return () => {
            mountedRef.current = false;
            stopStreaming();
        };
    }, [stopStreaming]);

    /** 启动时检查后端是否已配置 API Key（编译时嵌入或凭据管理器） */
    useEffect(() => {
        invoke<boolean>("has_api_key")
            .then((ok) => {
                setHasKey(ok);
                console.info("[AI] has_api_key:", ok);
            })
            .catch((err) => {
                console.error("[AI] has_api_key invoke failed:", err);
                setHasKey(false);
            });
    }, []);

    const streamAssistantReply = useCallback(
        (messageId: string, summary: string, rounds: AiToolRoundTrace[]) =>
            new Promise<void>((resolve) => {
                stopStreaming();
                const sessionId = streamSessionRef.current;
                const chars = Array.from(summary);
                const total = chars.length;
                let cursor = 0;

                setChatMessages((prev) =>
                    prev.map((m) =>
                        m.id === messageId
                            ? {
                                  ...m,
                                  content: "",
                                  loading: false,
                                  toolStatus: undefined,
                                  toolRounds: rounds,
                                  timestamp: Date.now(),
                              }
                            : m,
                    ),
                );

                if (total === 0) {
                    resolve();
                    return;
                }

                const pushChunk = () => {
                    if (
                        !mountedRef.current ||
                        streamSessionRef.current !== sessionId
                    ) {
                        resolve();
                        return;
                    }

                    const remaining = total - cursor;
                    const step =
                        remaining > 400
                            ? 16
                            : remaining > 180
                              ? 10
                              : remaining > 80
                                ? 6
                                : 3;
                    cursor = Math.min(total, cursor + step);

                    setChatMessages((prev) =>
                        prev.map((m) =>
                            m.id === messageId
                                ? {
                                      ...m,
                                      content: chars.slice(0, cursor).join(""),
                                      loading: false,
                                      toolStatus: undefined,
                                      toolRounds: rounds,
                                  }
                                : m,
                        ),
                    );

                    if (cursor >= total) {
                        streamTimerRef.current = null;
                        resolve();
                        return;
                    }

                    streamTimerRef.current = window.setTimeout(pushChunk, 20);
                };

                streamTimerRef.current = window.setTimeout(pushChunk, 20);
            }),
        [setChatMessages, stopStreaming],
    );

    const sendMessage = useCallback(
        async (content: string) => {
            if (!content.trim() || isLoading) return;

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
                        m.id === loadingMsg.id
                            ? { ...m, toolStatus: toolHint }
                            : m,
                    ),
                );
            }

            try {
                console.info("[AI] chat_with_ai invoke start");
                const contextMessages: AiMessage[] = [
                    {
                        role: "system",
                        content:
                            "你是 LanChat 内置的 AI 助手，简洁、友好地回答用户问题。支持中英文。" +
                            "你拥有多种工具能力：浏览网页、搜索互联网、提取网页图片、获取当前时间、编解码文本、查询IP地理位置、统计文本信息、" +
                            "读取文件、写入/创建文件、列出目录、创建目录、删除文件或目录、按关键词搜索文件。" +
                            "用户提供文件路径时，你可以读取代码、修改bug、新建脚本、管理文件夹结构。" +
                            "当用户的问题涉及以上能力时，请主动使用对应的工具获取实时数据后再回答。",
                    },
                ];

                const recentHistory = [...chatMessagesRef.current, userMsg]
                    .filter((m) => !m.loading)
                    .slice(-getConfig().max_context_messages);

                for (const msg of recentHistory) {
                    contextMessages.push({
                        role: msg.role,
                        content: msg.content,
                    });
                }

                const reply = await invoke<AiChatResponse>("chat_with_ai", {
                    messages: contextMessages,
                });
                console.info("[AI] chat_with_ai invoke success", {
                    rounds: reply.rounds.length,
                    summaryLength: reply.summary.length,
                });

                if (!mountedRef.current) return;

                await streamAssistantReply(
                    loadingMsg.id,
                    reply.summary,
                    reply.rounds,
                );
            } catch (err) {
                console.error("[AI] chat_with_ai invoke failed:", err);
                if (!mountedRef.current) return;

                setChatMessages((prev) =>
                    prev.map((m) =>
                        m.id === loadingMsg.id
                            ? {
                                  ...m,
                                  content: `❌ 请求失败: ${formatError(err)}`,
                                  loading: false,
                                  toolStatus: undefined,
                                  timestamp: Date.now(),
                              }
                            : m,
                    ),
                );
            } finally {
                if (mountedRef.current) {
                    setIsLoading(false);
                    setToolStatus(null);
                }
            }
        },
        [isLoading, setChatMessages, streamAssistantReply],
    );

    /** 清空对话历史 */
    const clearHistory = useCallback(() => {
        stopStreaming();
        setIsLoading(false);
        setToolStatus(null);
        setChatMessages([]);
    }, [setChatMessages, stopStreaming]);

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
