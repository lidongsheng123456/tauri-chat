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

interface AiChatWindowProps {
    chatMessages: AiChatMessage[];
    isLoading: boolean;
    toolStatus: string | null;
    onSendMessage: (content: string) => void;
    onClearHistory: () => void;
}

// ─── 纯工具函数 ───────────────────────────────────────────────────────────────

// ─── 快捷提示图标样式 ──────────────────────────────────────────────────────────

const ICON_STYLE: React.CSSProperties = {
    color: "#2563EB",
    display: "flex",
    alignItems: "center",
    flexShrink: 0,
};

// ─── 静态数据（模块级，仅初始化一次）─────────────────────────────────────────

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

/** 固定头像节点 — 模块级创建一次，不在渲染循环中重复生成 */
const BOT_AVATAR = (
    <div className="avatar avatar--sm avatar--bot ai-avatar--img">
        <img src="/fmt.webp" alt="AI" className="ai-avatar-img" />
    </div>
);
const USER_AVATAR = <div className="avatar avatar--sm avatar--me">我</div>;

// ─── 固定样式对象 ──────────────────────────────────────────────────────────────

const AI_CONTENT_STYLE: React.CSSProperties = {
    background: "#ffffff",
    border: "1px solid #E2E8F0",
    boxShadow: "0 1px 4px rgba(0,0,0,0.05)",
    maxWidth: "82%",
    minWidth: "180px",
};

// ─── 思考过程组件 ──────────────────────────────────────────────────────────────

interface ThoughtProcessProps {
    rounds: AiToolRoundTrace[];
    loading: boolean;
}

/** 可折叠的 AI 思考过程面板，显示每轮工具调用的摘要信息 */
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

interface SourceListProps {
    items: { key: string; title: string; url?: string }[];
}

/** 可折叠的引用来源列表，以编号行形式展示每个网页链接 */
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

interface AiMessageContentProps {
    msg: AiChatMessage;
}

/**
 * 渲染完整的 AI 回复内容，按以下顺序排列：
 *   1. 工具执行状态提示（加载中且有 toolStatus 时显示）
 *   2. ThoughtProcess — 可折叠的工具调用轮次摘要
 *   3. MarkdownRenderer — 最终回答正文
 *   4. FileCard.List   — 工具操作过的文件列表
 *   5. SourceList      — 工具引用的网页来源
 */
const AiMessageContent = memo(function AiMessageContent({
    msg,
}: AiMessageContentProps) {
    // 从工具轮次中提取引用来源，依赖 toolRounds 缓存
    const sources = useMemo(
        () => (msg.toolRounds ? extractSources(msg.toolRounds) : []),
        [msg.toolRounds],
    );
    // 从工具轮次中提取文件卡片，依赖 toolRounds 缓存
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

    /** AI 完成耗时超过 5 秒的任务后推送系统通知 */
    useEffect(() => {
        if (isLoading) {
            // 记录任务开始时间
            taskStartRef.current = Date.now();
        } else if (taskStartRef.current !== null) {
            const duration = Date.now() - taskStartRef.current;
            taskStartRef.current = null;
            // 仅对耗时超过 5 秒的任务发送通知
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
    // 当消息数量或最后一条消息内容变化时，自动滚动到底部
    const lastMsgContent = chatMessages[chatMessages.length - 1]?.content;
    useEffect(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }, [chatMessages.length, lastMsgContent]);

    // ── 输入事件处理 ──────────────────────────────────────────────────────────

    /** 发送消息：清空输入框并重置高度 */
    const handleSend = useCallback(() => {
        if (!input.trim() || isLoading) return;
        onSendMessage(input.trim());
        setInput("");
        if (textareaRef.current) textareaRef.current.style.height = "auto";
    }, [input, isLoading, onSendMessage]);

    /** 按 Enter 发送（Shift+Enter 换行） */
    const handleKeyDown = useCallback(
        (e: React.KeyboardEvent) => {
            if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                handleSend();
            }
        },
        [handleSend],
    );

    /** 文本域内容变化时自动扩展高度（最高 120px） */
    const handleTextareaInput = useCallback(
        (e: React.ChangeEvent<HTMLTextAreaElement>) => {
            setInput(e.target.value);
            autoResizeTextarea(e.target);
        },
        [],
    );

    /** 点击快捷提示卡片时，将其描述文本作为消息直接发送 */
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
