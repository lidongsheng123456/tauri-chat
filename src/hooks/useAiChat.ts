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

/**
 * 发送给 AI API 的单条上下文消息，用于构造对话历史。
 *
 * 此接口仅在前端内部使用，不对外导出；发送至后端时会被序列化为 JSON 数组。
 */
interface AiMessage {
    /** 消息角色，决定 AI 模型如何理解该条消息的来源与权重。 */
    role: "user" | "assistant" | "system";
    /** 消息的纯文本内容。 */
    content: string;
}

/**
 * 单次工具调用的完整执行轨迹，由后端序列化后随 `done` 事件一并发送至前端。
 *
 * 前端使用此数据在 `ThoughtProcess` 组件中渲染工具调用详情。
 */
export interface AiToolCallTrace {
    /** 工具调用的唯一标识符，与 AI API 响应中的 `tool_call_id` 对应。 */
    tool_call_id: string;
    /** 被调用工具的注册名称，例如 `"web_search"`、`"read_file"`。 */
    tool_name: string;
    /** 工具调用时传入的参数，保留原始 JSON 结构以便前端渲染。 */
    arguments: unknown;
    /** 工具执行后返回的结果文本（超长时后端已截断）。 */
    result: string;
}

/**
 * 一轮工具调用的完整轨迹，包含模型的思考文本与本轮所有工具执行记录。
 *
 * 一次 AI 对话可能经历多轮工具调用，每轮对应一个 `AiToolRoundTrace`，
 * 最终通过 `done` 事件的 `rounds` 字段批量传递至前端。
 */
export interface AiToolRoundTrace {
    /** 轮次编号，从 1 开始递增。 */
    round: number;
    /** 模型在决定调用工具前生成的思考文本，无思考内容时为 `null`。 */
    thinking?: string | null;
    /** 本轮中所有工具调用的执行轨迹列表。 */
    tool_calls: AiToolCallTrace[];
}

/**
 * AI 聊天窗口中的单条消息，用于前端渲染与本地持久化存储。
 *
 * 包含消息内容、加载状态与工具调用轨迹等 UI 展示所需的全部信息。
 */
export interface AiChatMessage {
    /** 消息的唯一标识符，由 `crypto.randomUUID()` 生成，同时作为流式事件的会话 ID。 */
    id: string;
    /** 消息角色，决定气泡的渲染样式与头像。 */
    role: "user" | "assistant";
    /** 消息的文本内容；流式输出阶段会随 `token` 事件实时追加。 */
    content: string;
    /** 消息创建或完成的 Unix 时间戳（毫秒）。 */
    timestamp: number;
    /** 是否处于加载（等待/流式接收）状态，为 `true` 时渲染加载动画。 */
    loading?: boolean;
    /** 当前正在执行的工具状态描述文本，用于在气泡内显示工具执行指示器。 */
    toolStatus?: string;
    /** 本次对话所有工具调用轮次的轨迹，由 `done` 事件写入，用于渲染 `ThoughtProcess` 组件。 */
    toolRounds?: AiToolRoundTrace[];
}

/**
 * 后端通过 Tauri 事件 `"ai-stream"` 实时推送的流式进度事件载荷。
 *
 * 对应 Rust 端的 `AiStreamEvent` 枚举，通过 `serde(tag = "type")` 序列化为带类型标签的 JSON。
 * 前端使用 `message_id` 字段过滤属于当前会话的事件，避免并发请求时事件串扰。
 *
 * 变体说明：
 * - `token`       — AI 生成的文本增量片段，最终回答阶段逐字推送，前端实时追加至消息内容。
 * - `tool_status` — 正在执行某个工具，前端据此清空思考文本并显示工具执行指示器。
 * - `done`        — 全部轮次完成，携带所有工具调用轨迹；最终文本内容已由 `token` 事件写入。
 * - `error`       — 流式处理过程中发生了不可恢复的错误。
 */
type AiStreamEventPayload =
    | { type: "token"; message_id: string; content: string }
    | { type: "tool_status"; message_id: string; status: string; round: number }
    | { type: "done"; message_id: string; rounds: AiToolRoundTrace[] }
    | { type: "error"; message_id: string; message: string };

// ─── 常量 ─────────────────────────────────────────────────────────────────────

const AI_BOT_ID = "__ai_bot__";
const STORAGE_KEY = "lanchat_ai_messages";

export { AI_BOT_ID };

// ─── Hook ─────────────────────────────────────────────────────────────────────

/**
 * 管理 AI 聊天会话状态与消息发送的核心 Hook。
 *
 * 采用真实流式方案与 Tauri 事件驱动架构：
 * 1. 调用对应 Rust Command `chat_with_ai_stream`（立即返回）在后台启动流式推理任务。
 * 2. 监听 Tauri 事件 `"ai-stream"`，通过 `message_id` 精确匹配当前会话的事件。
 * 3. `token` 事件 → 实时追加文本内容，用户无需等待完整回复即可看到逐字输出。
 * 4. `tool_status` 事件 → 清空思考文本，切换为工具执行指示器视图。
 * 5. `done` / `error` 事件 → 写入最终状态，调用 `finishStream` 清理监听器。
 *
 * @returns 包含以下字段的对象：
 * - `hasKey`       — 后端是否已配置有效的 AI API Key。
 * - `chatMessages` — 当前会话的消息列表，持久化于 `localStorage`。
 * - `isLoading`    — 是否正在等待或接收 AI 响应。
 * - `toolStatus`   — 当前工具执行状态的描述文本，无工具调用时为 `null`。
 * - `sendMessage`  — 发送用户消息并启动流式 AI 响应的异步函数。
 * - `clearHistory` — 清空全部对话历史并停止当前流式输出的函数。
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

    /**
     * 取消注册当前流式事件监听器并重置全局加载状态。
     *
     * 在以下场景中调用：收到 `done` 或 `error` 事件、`invoke` 调用失败、`listen` 注册失败。
     * 安全地处理 `unlistenRef.current` 为 `null` 的情况（可重复调用）。
     */
    const finishStream = useCallback(() => {
        unlistenRef.current?.();
        unlistenRef.current = null;
        if (mountedRef.current) {
            setIsLoading(false);
            setToolStatus(null);
        }
    }, []);

    // ── 发送消息 ──────────────────────────────────────────────────────────────

    /**
     * 发送用户消息并通过流式 AI 接口获取回复。
     *
     * 对应 Rust Command: `chat_with_ai_stream`
     *
     * 执行流程：
     * 1. 将用户消息与占位的加载消息追加到消息列表。
     * 2. 注册 `"ai-stream"` 事件监听器（须在 `invoke` 之前完成，避免丢失首个事件）。
     * 3. 调用 `chat_with_ai_stream` 启动后台流式任务（命令立即返回）。
     * 4. 通过事件回调实时更新消息内容，直至收到 `done` 或 `error` 事件。
     *
     * @param {string} content - 用户输入的消息文本，首尾空白字符会被自动裁剪。
     *   若内容为空或当前正在加载中，调用将被静默忽略。
     */
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

    /**
     * 清空全部对话历史记录，并中止当前正在进行的流式输出。
     *
     * 若调用时有活跃的流式任务，会先取消事件监听器以停止后续的状态更新，
     * 但后端的推理任务仍会继续运行直至自然结束（其事件将因无监听器而被丢弃）。
     */
    const clearHistory = useCallback(() => {
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
    };
}
