import {
    ChevronDown,
    Clock,
    Code2,
    ExternalLink,
    Globe,
    Lock,
    MapPin,
    Search,
    Trash2,
    Wrench,
} from "lucide-react";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
    Bubble,
    FileCard,
    Prompts,
    Welcome,
    notification,
} from "@ant-design/x";
import type { PromptsItemType } from "@ant-design/x";
import type { AiChatMessage, AiToolRoundTrace } from "../hooks/useAiChat";
import { extractFileCards, extractSources } from "../utils/aiHelper";
import { autoResizeTextarea } from "../utils/dom";
import { getFileIconType } from "../utils/fileIcon";
import { MarkdownRenderer } from "./MarkdownRenderer";

// ─── 类型定义 ─────────────────────────────────────────────────────────────────

/**
 * `AiChatWindow` 组件的 Props。
 */
interface AiChatWindowProps {
    /** 当前 AI 会话的消息列表，由 `useAiChat` Hook 维护并通过 `localStorage` 持久化。 */
    chatMessages: AiChatMessage[];
    /**
     * 是否正在等待或接收 AI 响应。
     *
     * `true` 时发送按钮显示「思考中…」或「执行中…」并禁用点击，
     * 同时触发任务耗时计时（超过 5 秒完成后推送系统通知）。
     */
    isLoading: boolean;
    /**
     * 当前工具执行状态的描述文本，无工具调用时为 `null`。
     *
     * 有值时在输入框上方显示全局工具状态栏（带旋转地球图标），
     * 发送按钮文字同步显示为「执行中…」。
     */
    toolStatus: string | null;
    /**
     * 发送用户消息的回调，由 `useAiChat.sendMessage` 提供。
     *
     * @param {string} content - 用户输入的消息文本（已去除首尾空格）。
     */
    onSendMessage: (content: string) => void;
    /**
     * 清空对话历史的回调，由 `useAiChat.clearHistory` 提供。
     *
     * 点击顶部垃圾桶按钮时触发，同时中止当前正在进行的流式输出。
     */
    onClearHistory: () => void;
}

// ─── 静态样式与常量 ───────────────────────────────────────────────────────────

/**
 * 快捷提示卡片中图标的统一内联样式。
 *
 * 模块级常量，仅初始化一次，避免在每次渲染时重新分配对象。
 */
const ICON_STYLE: React.CSSProperties = {
    color: "#2563EB",
    display: "flex",
    alignItems: "center",
    flexShrink: 0,
};

// ─── 静态数据（模块级，仅初始化一次）─────────────────────────────────────────

/**
 * AI 聊天欢迎屏上展示的快速开始提示卡片数据列表。
 *
 * 每项包含唯一 `key`、图标、标签与描述文本，
 * 点击时将描述文本作为消息直接发送给 AI。
 * 模块级常量，仅初始化一次，不在渲染循环中重复分配。
 */
const QUICK_PROMPTS: PromptsItemType[] = [
    {
        key: "search",
        icon: (
            <span style={ICON_STYLE}>
                <Search size={14} />
            </span>
        ),
        label: "搜索互联网",
        description: "帮我搜索最新资讯或热点话题",
    },
    {
        key: "code",
        icon: (
            <span style={ICON_STYLE}>
                <Code2 size={14} />
            </span>
        ),
        label: "代码助手",
        description: "帮我读取、分析或修改代码文件",
    },
    {
        key: "time",
        icon: (
            <span style={ICON_STYLE}>
                <Clock size={14} />
            </span>
        ),
        label: "当前时间",
        description: "告诉我现在几点几分",
    },
    {
        key: "browse",
        icon: (
            <span style={ICON_STYLE}>
                <Globe size={14} />
            </span>
        ),
        label: "浏览网页",
        description: "帮我解析和总结一个网页内容",
    },
    {
        key: "encode",
        icon: (
            <span style={ICON_STYLE}>
                <Lock size={14} />
            </span>
        ),
        label: "编码 / 解码",
        description: "Base64 · URL · 十六进制 编解码",
    },
    {
        key: "ip",
        icon: (
            <span style={ICON_STYLE}>
                <MapPin size={14} />
            </span>
        ),
        label: "IP 查询",
        description: "查询 IP 地址所在地理位置信息",
    },
];

/**
 * AI 助手头像节点，模块级创建一次，不在渲染循环中重复生成，
 * 避免 `Bubble` 组件因引用变化触发不必要的重渲染。
 */
const BOT_AVATAR = (
    <div className="avatar avatar--sm avatar--bot ai-avatar--img">
        <img src="/fmt.webp" alt="AI" className="ai-avatar-img" />
    </div>
);

/**
 * 用户（自己）头像节点，与 `BOT_AVATAR` 同理，模块级创建一次。
 */
const USER_AVATAR = <div className="avatar avatar--sm avatar--me">我</div>;

// ─── 固定样式对象 ──────────────────────────────────────────────────────────────

/**
 * AI 消息气泡的内联样式，传入 `Bubble` 组件的 `styles.content` 属性。
 *
 * 模块级常量，确保引用稳定，防止 `Bubble` 因样式对象引用变化而重渲染。
 */
const AI_CONTENT_STYLE: React.CSSProperties = {
    background: "#ffffff",
    border: "1px solid #E2E8F0",
    boxShadow: "0 1px 4px rgba(0,0,0,0.05)",
    maxWidth: "82%",
    minWidth: "180px",
};

// ─── 思考过程组件 ──────────────────────────────────────────────────────────────

/**
 * `ThoughtProcess` 组件的 Props。
 */
interface ThoughtProcessProps {
    /** 本次 AI 对话中所有工具调用轮次的完整轨迹列表，由 `done` 事件写入。 */
    rounds: AiToolRoundTrace[];
    /**
     * 是否仍处于加载（流式接收）状态。
     *
     * `true` 时显示三点脉冲加载动画与「深度思考中…」文本；
     * `false` 时显示可旋转展开箭头与「已思考 N 轮」文本。
     */
    loading: boolean;
}

/**
 * 可折叠的 AI 工具调用思考过程面板。
 *
 * 显示模式：
 * - **加载中**：三点脉冲动画 + 「深度思考中…」，提示用户 AI 正在处理。
 * - **已完成**：可旋转展开箭头 + 「已思考 N 轮」，点击展开/折叠详情。
 *
 * 展开后按轮次渲染每轮的思考文本（如有）与调用的工具标签列表。
 * 使用 `memo` 避免父组件更新时不必要的重渲染。
 *
 * @param {ThoughtProcessProps} props - 组件 Props，详见 `ThoughtProcessProps` 接口定义。
 */
const ThoughtProcess = memo(function ThoughtProcess({
    rounds,
    loading,
}: ThoughtProcessProps) {
    const [open, setOpen] = useState(false);

    return (
        <div className="ai-thought">
            {/* 折叠切换按钮 */}
            <button
                className="ai-thought__toggle"
                onClick={() => setOpen((o) => !o)}
                aria-expanded={open}
            >
                {loading ? (
                    /* 思考中：三点加载动画 */
                    <span className="ai-thought__dot-loader">
                        <span />
                        <span />
                        <span />
                    </span>
                ) : (
                    /* 已完成：可旋转的展开箭头 */
                    <ChevronDown
                        size={12}
                        className={`ai-thought__chevron${open ? " ai-thought__chevron--open" : ""}`}
                    />
                )}
                <span className="ai-thought__toggle-label">
                    {loading ? "深度思考中…" : `已思考 ${rounds.length} 轮`}
                </span>
            </button>

            {/* 展开后的思考内容 */}
            {open && (
                <div className="ai-thought__body animate-fade-in">
                    {rounds.map((round) => (
                        <div key={round.round} className="ai-thought__round">
                            {/* 轮次标签 */}
                            <div className="ai-thought__round-head">
                                <span className="ai-thought__round-pill">
                                    第 {round.round} 轮
                                </span>
                            </div>

                            {/* 本轮思考文本（如有） */}
                            {round.thinking && (
                                <p className="ai-thought__thinking">
                                    {round.thinking}
                                </p>
                            )}

                            {/* 本轮调用的工具标签列表 */}
                            {round.tool_calls.length > 0 && (
                                <div className="ai-thought__tools">
                                    {round.tool_calls.map((tool) => (
                                        <span
                                            key={tool.tool_call_id}
                                            className="ai-thought__tool-tag"
                                        >
                                            <Wrench size={9} />
                                            <span>{tool.tool_name}</span>
                                        </span>
                                    ))}
                                </div>
                            )}
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
});

// ─── 引用来源组件 ──────────────────────────────────────────────────────────────

/**
 * `SourceList` 组件的 Props。
 */
interface SourceListProps {
    /** 引用来源列表，每项包含唯一 key、展示标题与可选的 URL。 */
    items: { key: string; title: string; url?: string }[];
}

/**
 * 可折叠的网页引用来源列表，展示 AI 工具调用中访问过的外部链接。
 *
 * 折叠时显示「引用 N 个来源」标签，展开后以编号列表形式展示每个来源的标题与链接。
 * 点击来源条目在新标签页中打开对应 URL（`rel="noopener noreferrer"`）。
 * 使用 `memo` 避免父组件更新时不必要的重渲染。
 *
 * @param {SourceListProps} props - 组件 Props，详见 `SourceListProps` 接口定义。
 */
const SourceList = memo(function SourceList({ items }: SourceListProps) {
    const [open, setOpen] = useState(false);

    return (
        <div className="ai-sources">
            {/* 折叠切换按钮 */}
            <button
                className="ai-sources__toggle"
                onClick={() => setOpen((o) => !o)}
                aria-expanded={open}
            >
                <Globe size={11} className="ai-sources__icon" />
                <span className="ai-sources__toggle-label">
                    引用 {items.length} 个来源
                </span>
                <ChevronDown
                    size={11}
                    className={`ai-sources__chevron${open ? " ai-sources__chevron--open" : ""}`}
                />
            </button>

            {/* 展开后的来源列表 */}
            {open && (
                <div className="ai-sources__list animate-fade-in">
                    {items.map((item, i) => (
                        <a
                            key={item.key}
                            href={item.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="ai-sources__item"
                            title={item.url}
                        >
                            {/* 序号徽章 */}
                            <span className="ai-sources__num">{i + 1}</span>
                            {/* 标题（超出截断） */}
                            <span className="ai-sources__title">
                                {item.title}
                            </span>
                            {/* 外部链接图标 */}
                            <ExternalLink
                                size={10}
                                className="ai-sources__ext"
                            />
                        </a>
                    ))}
                </div>
            )}
        </div>
    );
});

// ─── AI 消息内容组件 ───────────────────────────────────────────────────────────

/**
 * `AiMessageContent` 组件的 Props。
 */
interface AiMessageContentProps {
    /** 需要渲染的单条 AI 消息数据，包含内容、加载状态与工具调用轨迹。 */
    msg: AiChatMessage;
}

/**
 * 渲染单条 AI 回复消息的完整内容区域，按以下顺序垂直排列各子区域：
 *
 * 1. **工具执行状态提示** — 加载中且 `toolStatus` 有值时，显示旋转地球图标与状态文本。
 * 2. **ThoughtProcess**  — 有工具调用轮次记录时，显示可折叠的思考过程面板。
 * 3. **MarkdownRenderer** — 有正文内容时，渲染 Markdown 格式的最终回答。
 * 4. **FileCard.List**   — 有文件操作记录时，以小尺寸卡片列表展示操作过的文件。
 * 5. **SourceList**      — 有网页引用来源时，展示可折叠的来源链接列表。
 *
 * `sources` 与 `fileCards` 通过 `useMemo` 缓存，仅在 `toolRounds` 变化时重新计算。
 * 使用 `memo` 避免消息列表更新时对未变化消息的重渲染。
 *
 * @param {AiMessageContentProps} props - 组件 Props，详见 `AiMessageContentProps` 接口定义。
 */
const AiMessageContent = memo(function AiMessageContent({
    msg,
}: AiMessageContentProps) {
    /**
     * 从工具调用轨迹中解析引用来源列表，用于在回复下方展示「引用 N 个来源」。
     * 仅在 `toolRounds` 变化时重新计算，流式输出期间不重复执行。
     */
    const sources = useMemo(
        () => (msg.toolRounds ? extractSources(msg.toolRounds) : []),
        [msg.toolRounds],
    );
    /**
     * 从工具调用轨迹中解析文件卡片列表，用于在回复下方展示操作过的文件。
     * 仅在 `toolRounds` 变化时重新计算。
     */
    const fileCards = useMemo(
        () => (msg.toolRounds ? extractFileCards(msg.toolRounds) : []),
        [msg.toolRounds],
    );

    return (
        <div className="ai-msg-content">
            {/* 工具执行状态提示（加载中且存在状态文本时显示） */}
            {msg.loading && msg.toolStatus && (
                <div className="ai-typing ai-typing--tool">
                    <Globe size={13} className="ai-tool-spin" />
                    <span className="ai-typing__label">{msg.toolStatus}</span>
                </div>
            )}

            {/* 思考过程：可折叠的工具调用轮次面板 */}
            {msg.toolRounds && msg.toolRounds.length > 0 && (
                <ThoughtProcess
                    rounds={msg.toolRounds}
                    loading={!!msg.loading}
                />
            )}

            {/* Markdown 正文 */}
            {msg.content && <MarkdownRenderer content={msg.content} />}

            {/* 文件卡片列表（工具操作过的文件） */}
            {fileCards.length > 0 && (
                <div className="ai-file-cards">
                    <FileCard.List
                        size="small"
                        items={fileCards.map((f) => ({
                            name: f.name,
                            description: f.path,
                            // eslint-disable-next-line @typescript-eslint/no-explicit-any
                            icon: getFileIconType(f.name) as any,
                        }))}
                    />
                </div>
            )}

            {/* 引用来源列表 */}
            {sources.length > 0 && <SourceList items={sources} />}
        </div>
    );
});

// ─── 主组件 ───────────────────────────────────────────────────────────────────

/**
 * AI 聊天窗口主组件，提供与 AI 助手的完整对话界面。
 *
 * 功能说明：
 * - **欢迎屏**：无消息时展示品牌欢迎语与 6 张快速开始提示卡片（`QUICK_PROMPTS`）。
 * - **消息列表**：用户消息使用自定义 flex 行布局，AI 消息使用 `Bubble` 组件；
 *   每条 AI 消息通过 `AiMessageContent` 渲染工具状态、思考过程、Markdown 正文、文件卡片与来源链接。
 * - **自动滚动**：消息数量或最新消息内容变化时平滑滚动到底部。
 * - **系统通知**：AI 完成耗时超过 5 秒的任务后推送桌面系统通知（需用户授权）。
 * - **工具状态栏**：有活跃工具调用时在输入框上方显示全局状态提示。
 * - **输入区域**：支持 `Enter` 发送、`Shift+Enter` 换行，textarea 高度自动扩展（最高 120px）。
 * - **清空历史**：点击顶部垃圾桶按钮，调用 `onClearHistory` 清空消息并中止流式输出。
 *
 * @param {AiChatWindowProps} props - 组件 Props，详见 `AiChatWindowProps` 接口定义。
 */
export function AiChatWindow({
    chatMessages,
    isLoading,
    toolStatus,
    onSendMessage,
    onClearHistory,
}: AiChatWindowProps) {
    const [input, setInput] = useState("");
    const messagesEndRef = useRef<HTMLDivElement>(null);
    const textareaRef = useRef<HTMLTextAreaElement>(null);
    // 记录任务开始时间戳，用于判断是否推送完成通知
    const taskStartRef = useRef<number | null>(null);

    // ── 系统通知 ──────────────────────────────────────────────────────────────
    const [, { open: openNotif, requestPermission }] =
        notification.useNotification();

    useEffect(() => {
        // 请求系统通知权限（用户拒绝或环境不支持时静默忽略）
        requestPermission().catch(() => {
            /* 用户拒绝或环境不支持，静默忽略 */
        });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    /**
     * 监听 `isLoading` 变化，对耗时超过 5 秒的 AI 任务推送桌面系统通知。
     *
     * 逻辑：
     * - `isLoading` 由 `false` 变为 `true` 时，记录任务开始时间戳到 `taskStartRef`。
     * - `isLoading` 由 `true` 变为 `false` 时，计算耗时；超过 5000ms 则触发系统通知。
     *
     * 选择 5 秒阈值是为了过滤普通的快速问答，仅对长时间运行的深度分析任务发出提醒，
     * 避免频繁通知打扰用户。
     */
    useEffect(() => {
        if (isLoading) {
            taskStartRef.current = Date.now();
        } else if (taskStartRef.current !== null) {
            const duration = Date.now() - taskStartRef.current;
            taskStartRef.current = null;
            if (duration > 5000) {
                openNotif({
                    title: "AI 助手",
                    body: "AI 已完成分析，请查看回复。",
                    duration: 6000,
                });
            }
        }
    }, [isLoading, openNotif]);

    // ── 自动滚动 ──────────────────────────────────────────────────────────────
    /**
     * 同时监听消息数量与最新消息内容的变化，确保在以下两种场景下均能自动滚动到底部：
     * - 新消息追加时（`chatMessages.length` 增加）。
     * - AI 流式输出期间最新消息内容实时增长时（`lastMsgContent` 变化）。
     */
    const lastMsgContent = chatMessages[chatMessages.length - 1]?.content;
    useEffect(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }, [chatMessages.length, lastMsgContent]);

    // ── 输入事件处理 ──────────────────────────────────────────────────────────

    /**
     * 发送当前输入框中的消息，发送成功后清空输入内容并重置 textarea 高度。
     *
     * 两种情况下调用将被静默忽略：
     * - 输入内容为空或仅含空白字符。
     * - 当前正处于 AI 加载状态（`isLoading === true`），防止并发提交。
     */
    const handleSend = useCallback(() => {
        if (!input.trim() || isLoading) return;
        onSendMessage(input.trim());
        setInput("");
        if (textareaRef.current) textareaRef.current.style.height = "auto";
    }, [input, isLoading, onSendMessage]);

    /**
     * 键盘事件处理：`Enter` 键触发发送，`Shift+Enter` 键插入换行。
     *
     * @param {React.KeyboardEvent} e - 键盘事件对象。
     */
    const handleKeyDown = useCallback(
        (e: React.KeyboardEvent) => {
            if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                handleSend();
            }
        },
        [handleSend],
    );

    /**
     * 文本域 `onChange` 处理：同步更新输入状态并自动扩展 textarea 高度（最高 120px）。
     *
     * @param {React.ChangeEvent<HTMLTextAreaElement>} e - textarea 变更事件对象。
     */
    const handleTextareaInput = useCallback(
        (e: React.ChangeEvent<HTMLTextAreaElement>) => {
            setInput(e.target.value);
            autoResizeTextarea(e.target);
        },
        [],
    );

    /**
     * 快捷提示卡片点击处理：将卡片的 `description`（优先）或 `label` 文本直接作为消息发送。
     *
     * 通过 `@ant-design/x` 的 `Prompts` 组件 `onItemClick` 回调触发，
     * 使用户无需手动输入即可快速体验常用功能。
     *
     * @param {{ data: PromptsItemType }} param - 包含被点击卡片数据的回调参数对象。
     */
    const handlePromptClick = useCallback(
        ({ data }: { data: PromptsItemType }) => {
            const text = String(data.description ?? data.label ?? "");
            if (text) onSendMessage(text);
        },
        [onSendMessage],
    );

    // ── 渲染 ──────────────────────────────────────────────────────────────────

    return (
        <div className="chat-window">
            {/* ════════════════ 顶部标题栏 ════════════════ */}
            <div className="chat-header">
                <div className="ai-header-info">
                    <div className="avatar avatar--bot avatar--sm ai-avatar--img">
                        <img
                            src="/fmt.webp"
                            alt="AI"
                            className="ai-avatar-img"
                        />
                    </div>
                    <div>
                        <h3 className="chat-header__title">AI 助手</h3>
                        <p className="chat-header__subtitle">
                            DeepSeek · 搜索 · 网页 · 工具调用
                        </p>
                    </div>
                </div>
                <button
                    onClick={onClearHistory}
                    className="chat-toolbar__btn"
                    title="清空对话"
                >
                    <Trash2 size={16} />
                </button>
            </div>

            {/* ════════════════ 消息区域 ════════════════ */}
            <div className="chat-messages">
                {chatMessages.length === 0 ? (
                    /* 欢迎屏（无消息时显示） */
                    <div className="ai-welcome-area animate-fade-in">
                        <Welcome
                            icon={
                                <div className="ai-welcome-icon">
                                    <img
                                        src="/fmt.webp"
                                        alt="AI"
                                        className="ai-welcome-icon__img"
                                    />
                                </div>
                            }
                            title="AI 助手"
                            description="开始对话吧，支持搜索互联网、浏览网页、读写文件等多种工具能力。"
                            variant="borderless"
                            style={{ marginBottom: 24 }}
                        />

                        {/* 快速开始提示卡片 */}
                        <Prompts
                            title="快速开始"
                            items={QUICK_PROMPTS as PromptsItemType[]}
                            onItemClick={handlePromptClick}
                            wrap
                            fadeIn
                            styles={{
                                list: { width: "100%" },
                                item: { minWidth: 0 },
                            }}
                        />
                    </div>
                ) : (
                    /* 消息气泡列表 */
                    chatMessages.map((msg) => {
                        const isUser = msg.role === "user";

                        /*
                         * 用户消息：使用纯 flex 行布局，不使用 Bubble 组件。
                         * 原因：Bubble 的根元素 width:100% + body flex:1 会将头像推到最右边。
                         */
                        if (isUser) {
                            return (
                                <div
                                    key={msg.id}
                                    className="ai-user-row animate-slide-up"
                                >
                                    <div className="ai-user-bubble">
                                        {msg.content}
                                    </div>
                                    {USER_AVATAR}
                                </div>
                            );
                        }

                        /*
                         * AI 消息：使用 Bubble 组件处理加载状态和复杂内容。
                         * 仅在真正空闲时（无工具状态、无工具轮次）才启用内置三点加载动画。
                         */
                        const useBuiltinLoading =
                            !!msg.loading &&
                            !msg.toolStatus &&
                            !msg.toolRounds?.length;

                        return (
                            <Bubble
                                key={msg.id}
                                placement="start"
                                loading={useBuiltinLoading}
                                variant="outlined"
                                shape="corner"
                                avatar={BOT_AVATAR}
                                content={msg.content}
                                contentRender={() => (
                                    <AiMessageContent msg={msg} />
                                )}
                                styles={{
                                    root: { gap: 8, alignItems: "flex-start" },
                                    content: AI_CONTENT_STYLE,
                                }}
                            />
                        );
                    })
                )}

                {/* 滚动锚点，用于自动定位到最新消息 */}
                <div ref={messagesEndRef} />
            </div>

            {/* ════════════════ 全局工具执行状态栏（输入框上方） ════════════════ */}
            {toolStatus && (
                <div className="ai-tool-status">
                    <Globe size={13} className="ai-tool-spin" />
                    <span>{toolStatus}</span>
                </div>
            )}

            {/* ════════════════ 输入区域 ════════════════ */}
            <div className="chat-input-area">
                <div className="chat-input-box ai-input-box">
                    <div className="chat-input-inner">
                        <textarea
                            ref={textareaRef}
                            value={input}
                            onChange={handleTextareaInput}
                            onKeyDown={handleKeyDown}
                            placeholder="输入消息，Enter 发送。支持搜索、网页浏览、文件工具调用。"
                            className="chat-textarea"
                        />
                        <div className="chat-send-row">
                            <button
                                onClick={handleSend}
                                disabled={!input.trim() || isLoading}
                                className="chat-send-btn ai-send-btn"
                            >
                                {isLoading
                                    ? toolStatus
                                        ? "执行中..."
                                        : "思考中..."
                                    : "发送"}
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
