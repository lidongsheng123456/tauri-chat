import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { tauriInvoke } from "../utils/tauri";
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

// ─── 类型定义 ─────────────────────────────────────────────────────────────────

/** AI 对话单条消息（用于 API 请求上下文） */
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

export interface AiChatMessage {
    id: string;
    role: "user" | "assistant";
    content: string;
    timestamp: number;
    loading?: boolean;
    toolStatus?: string;
    toolRounds?: AiToolRoundTrace[];
}

/**
 * 后端通过 Tauri 事件 "ai-stream" 推送的流式事件载荷。
 * 使用联合类型按 `type` 字段区分：
 *   - token       — 新增文本片段（最终回答阶段）
 *   - tool_status — 正在执行某工具
 *   - done        — 全部完成，携带工具轮次轨迹
 *   - error       — 发生错误
 */
type AiStreamEventPayload =
    | { type: "token"; message_id: string; content: string }
    | { type: "tool_status"; message_id: string; status: string; round: number }
    | { type: "done"; message_id: string; rounds: AiToolRoundTrace[] }
    | { type: "error"; message_id: string; message: string };

// ─── 常量 ─────────────────────────────────────────────────────────────────────

const AI_BOT_ID = "__ai_bot__";
const AI_BOT_NAME = "AI 助手";
const STORAGE_KEY = "lanchat_ai_messages";

export { AI_BOT_ID, AI_BOT_NAME };

// ─── Hook ─────────────────────────────────────────────────────────────────────

/**
 * AI 聊天 Hook — 管理 AI 对话状态与消息发送。
 *
 * 采用真实流式方案：
 *   1. 调用 `chat_with_ai_stream` 命令（立即返回）启动后台流式任务。
 *   2. 监听 Tauri 事件 `"ai-stream"`，按 `message_id` 过滤当前会话的事件。
 *   3. `token` 事件 → 实时追加内容，用户无需等待完整回复。
 *   4. `tool_status` 事件 → 清空 thinking tokens，显示工具执行指示器。
 *   5. `done` / `error` 事件 → 结束会话，清理监听器。
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
    const unlistenRef = useRef<UnlistenFn | null>(null);
    const chatMessagesRef = useRef(chatMessages);

    // 在浏览器绘制前同步更新 ref，确保 sendMessage 中读到的始终是最新消息列表
    useLayoutEffect(() => {
        chatMessagesRef.current = chatMessages;
    }, [chatMessages]);

    // 组件卸载时清理监听器
    useEffect(() => {
        mountedRef.current = true;
        return () => {
            mountedRef.current = false;
            unlistenRef.current?.();
            unlistenRef.current = null;
        };
    }, []);

    // 启动时检查后端是否已配置 API Key
    useEffect(() => {
        tauriInvoke<boolean>("has_api_key").then((ok) => {
            setHasKey(ok ?? false);
            console.info("[AI] has_api_key:", ok ?? false);
        });
    }, []);

    // ── 内部辅助 ──────────────────────────────────────────────────────────────

    /** 取消注册当前事件监听器并重置 loading 状态 */
    const finishStream = useCallback(() => {
        unlistenRef.current?.();
        unlistenRef.current = null;
        if (mountedRef.current) {
            setIsLoading(false);
            setToolStatus(null);
        }
    }, []);

    // ── 发送消息 ──────────────────────────────────────────────────────────────

    const sendMessage = useCallback(
        async (content: string) => {
            if (!content.trim() || isLoading) return;

            // 取消上一次可能残留的监听器（防御性清理）
            unlistenRef.current?.();
            unlistenRef.current = null;

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

            // 根据用户输入内容预判可能触发的工具，在第一个 token 到达前提供提示
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

            // 构造上下文消息列表（包含历史 + 本次用户消息）
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
                contextMessages.push({ role: msg.role, content: msg.content });
            }

            // 将错误写入 loadingMsg 气泡并结束流（listen/invoke 两处共用）
            const showError = (err: unknown) => {
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
                finishStream();
            };

            // ① 先注册监听器，避免事件在 invoke 前到达而丢失
            try {
                unlistenRef.current = await listen<AiStreamEventPayload>(
                    "ai-stream",
                    (event) => {
                        if (!mountedRef.current) return;

                        const payload = event.payload;

                        // 过滤掉不属于当前会话的事件
                        if (payload.message_id !== loadingMsg.id) return;

                        switch (payload.type) {
                            case "token": {
                                // 实时追加 token，首个 token 到达时清除 loading 状态和工具提示
                                setChatMessages((prev) =>
                                    prev.map((m) =>
                                        m.id === loadingMsg.id
                                            ? {
                                                  ...m,
                                                  content:
                                                      m.content +
                                                      payload.content,
                                                  loading: false,
                                                  toolStatus: undefined,
                                              }
                                            : m,
                                    ),
                                );
                                // 仅在有工具状态时才清除，避免无谓的 setState
                                setToolStatus((prev) =>
                                    prev !== null ? null : prev,
                                );
                                break;
                            }

                            case "tool_status": {
                                // 工具执行阶段：清空之前流式输出的 thinking tokens，显示工具指示器
                                setToolStatus(payload.status);
                                setChatMessages((prev) =>
                                    prev.map((m) =>
                                        m.id === loadingMsg.id
                                            ? {
                                                  ...m,
                                                  content: "",
                                                  loading: true,
                                                  toolStatus: payload.status,
                                              }
                                            : m,
                                    ),
                                );
                                break;
                            }

                            case "done": {
                                // 全部完成：最终内容已通过 token 事件实时写入，此处只补充工具轨迹
                                setChatMessages((prev) =>
                                    prev.map((m) =>
                                        m.id === loadingMsg.id
                                            ? {
                                                  ...m,
                                                  loading: false,
                                                  toolStatus: undefined,
                                                  toolRounds:
                                                      payload.rounds.length > 0
                                                          ? payload.rounds
                                                          : m.toolRounds,
                                                  timestamp: Date.now(),
                                              }
                                            : m,
                                    ),
                                );
                                console.info(
                                    "[AI] stream done, rounds:",
                                    payload.rounds.length,
                                );
                                finishStream();
                                break;
                            }

                            case "error": {
                                console.error(
                                    "[AI] stream error:",
                                    payload.message,
                                );
                                showError(payload.message);
                                break;
                            }
                        }
                    },
                );
            } catch (err) {
                // listen 本身失败（极少见）
                console.error("[AI] listen failed:", err);
                showError(err);
                return;
            }

            // ② 启动后台流式任务（命令立即返回，进度通过事件异步推送）
            console.info(
                "[AI] chat_with_ai_stream invoke start, id:",
                loadingMsg.id,
            );
            await tauriInvoke(
                "chat_with_ai_stream",
                { messageId: loadingMsg.id, messages: contextMessages },
                (err) => {
                    // invoke 本身失败（API Key 未配置等启动错误）
                    console.error(
                        "[AI] chat_with_ai_stream invoke failed:",
                        err,
                    );
                    showError(err);
                },
            );
            console.info(
                "[AI] chat_with_ai_stream invoke returned (stream running in background)",
            );
        },
        [isLoading, setChatMessages, finishStream],
    );

    // ── 清空对话 ──────────────────────────────────────────────────────────────

    const clearHistory = useCallback(() => {
        // 清空时如果正在流式输出，先停止监听
        unlistenRef.current?.();
        unlistenRef.current = null;
        setIsLoading(false);
        setToolStatus(null);
        setChatMessages([]);
    }, [setChatMessages]);

    // ─────────────────────────────────────────────────────────────────────────

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
