import { CheckCircle2, Sparkles, XCircle } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ChatMessage, UserInfo } from "../types";
import { useTransfers } from "../hooks/useTransfers";
import { ChatInput } from "./ChatInput";
import { MessageBubble } from "./MessageBubble";

/**
 * Toast 提示消息的数据结构。
 */
interface Toast {
    /** Toast 的唯一标识符，由自增计数器生成，用于精确匹配与移除。 */
    id: number;
    /** 提示类型，决定图标与样式（成功为绿色勾，错误为红色叉）。 */
    type: "success" | "error";
    /** 提示文本内容。 */
    message: string;
}

/**
 * `ChatWindow` 组件的 Props。
 */
interface ChatWindowProps {
    /** 当前所有聊天消息列表，由 `useChat` Hook 维护，包含所有会话的消息。 */
    messages: ChatMessage[];
    /** 当前客户端自身的用户 ID，用于判断消息是否由自己发送（决定气泡方向）。 */
    myUserId: string;
    /**
     * 当前选中的会话 ID：
     * - `"all"` — 群聊频道，展示 `to_id === "all"` 的消息。
     * - 其他值  — 私聊会话，展示与该用户 ID 之间的双向消息。
     */
    selectedChat: string;
    /** 当前所有在线用户列表，用于推导聊天标题与在线人数。 */
    users: UserInfo[];
    /** 聊天服务器地址（含端口），格式为 `host:port`，用于构造文件的完整访问 URL。 */
    serverUrl: string;
    /**
     * 发送文本消息的回调，由父组件 `App` 封装后传入。
     *
     * @param {string} content - 已去除首尾空格的消息文本内容。
     */
    onSendMessage: (content: string) => void;
    /**
     * 上传文件的回调，由父组件 `App` 封装后传入。
     *
     * @param {File} file - 用户选择或拖拽的文件对象。
     */
    onUploadFile: (file: File) => void;
}

/**
 * 聊天消息窗口组件，负责展示消息列表、处理拖拽上传与操作结果提示。
 *
 * 功能说明：
 * - 根据 `selectedChat` 对消息列表进行过滤，仅展示当前会话的相关消息。
 * - 消息数量变化时自动平滑滚动到最新消息（`scrollIntoView({ behavior: "smooth" })`）。
 * - 支持将文件拖拽至窗口任意位置上传，通过计数器（`dragCounter`）解决嵌套元素触发
 *   `dragenter` / `dragleave` 导致的闪烁问题。
 * - 操作结果（上传成功/失败）以右下角 Toast 形式展示，3 秒后自动消失。
 * - 所有 Toast 定时器在组件卸载时统一清理，防止内存泄漏。
 *
 * @param {ChatWindowProps} props - 组件 Props，详见 `ChatWindowProps` 接口定义。
 */
export function ChatWindow({
    messages,
    myUserId,
    selectedChat,
    users,
    serverUrl,
    onSendMessage,
    onUploadFile,
}: ChatWindowProps) {
    const [isDragOver, setIsDragOver] = useState(false);
    const [toasts, setToasts] = useState<Toast[]>([]);
    const { addTransfer, updateTransfer } = useTransfers();
    const messagesEndRef = useRef<HTMLDivElement>(null);
    /**
     * 拖拽进入计数器，用于解决嵌套元素触发 `dragenter` / `dragleave` 引发的闪烁问题。
     * 进入子元素时 +1，离开子元素时 -1，归零时才真正视为离开窗口。
     */
    const dragCounter = useRef(0);
    /** Toast ID 自增计数器，确保每条 Toast 有唯一标识。 */
    const toastId = useRef(0);
    /** Toast 自动消失定时器的 Map，key 为 Toast ID，卸载时统一清理。 */
    const toastTimers = useRef<Map<number, ReturnType<typeof setTimeout>>>(
        new Map(),
    );

    /** 组件卸载时清理所有 Toast 定时器，防止在已卸载组件上调用 setState。 */
    useEffect(() => {
        // 捕获 ref 当前值到局部变量，确保 cleanup 执行时访问的是同一个 Map 实例
        const timers = toastTimers.current;
        return () => {
            for (const timer of timers.values()) clearTimeout(timer);
        };
    }, []);

    /**
     * 展示一条操作结果 Toast 提示，3 秒后自动消失。
     *
     * 同一时间可存在多条 Toast，每条独立计时。
     * 定时器句柄记录在 `toastTimers` Map 中，组件卸载时统一清理。
     *
     * @param {"success" | "error"} type  - 提示类型，决定图标与配色。
     * @param {string}              message - 提示文本内容。
     */
    const showToast = useCallback(
        (type: "success" | "error", message: string) => {
            const id = ++toastId.current;
            setToasts((prev) => [...prev, { id, type, message }]);
            const timer = setTimeout(() => {
                setToasts((prev) => prev.filter((t) => t.id !== id));
                toastTimers.current.delete(id);
            }, 3000);
            toastTimers.current.set(id, timer);
        },
        [],
    );

    /**
     * 根据 `selectedChat` 对消息列表进行过滤，仅保留当前会话的相关消息。
     *
     * 过滤规则：
     * - `selectedChat === "all"` — 保留 `to_id === "all"` 的群聊消息。
     * - 其他值 — 保留发送方或接收方与 `selectedChat` 匹配的私聊消息（双向均收录）。
     *
     * 使用 `useMemo` 避免每次渲染都重新遍历完整消息列表。
     */
    const filteredMessages = useMemo(
        () =>
            messages.filter((m) => {
                if (selectedChat === "all") return m.to_id === "all";
                return (
                    (m.from_id === myUserId && m.to_id === selectedChat) ||
                    (m.from_id === selectedChat && m.to_id === myUserId)
                );
            }),
        [messages, selectedChat, myUserId],
    );

    /** 消息数量变化时自动平滑滚动到消息列表底部（锚点为 `messagesEndRef`）。 */
    useEffect(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }, [filteredMessages.length]);

    /**
     * 拖拽进入处理：增加计数器，若拖拽项包含文件则显示覆盖遮罩层。
     *
     * @param {React.DragEvent} e - 拖拽事件对象。
     */
    const handleDragEnter = useCallback((e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        dragCounter.current += 1;
        if (e.dataTransfer.items.length > 0) setIsDragOver(true);
    }, []);

    /**
     * 拖拽离开处理：减少计数器，归零时隐藏遮罩层（表示真正离开了整个窗口区域）。
     *
     * @param {React.DragEvent} e - 拖拽事件对象。
     */
    const handleDragLeave = useCallback((e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        dragCounter.current -= 1;
        if (dragCounter.current === 0) setIsDragOver(false);
    }, []);

    /**
     * 拖拽悬停处理：阻止浏览器默认行为（如直接打开文件），不做额外状态更新。
     *
     * @param {React.DragEvent} e - 拖拽事件对象。
     */
    const handleDragOver = useCallback((e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
    }, []);

    /**
     * 拖拽释放处理：重置计数器与遮罩层，逐一上传拖拽释放的所有文件。
     *
     * 每个文件独立通过 `addTransfer` 注册传输任务，上传结果同步到
     * `TransferIndicator`；单文件失败不影响其他文件的上传流程。
     *
     * @param {React.DragEvent} e - 拖拽事件对象，通过 `e.dataTransfer.files` 获取文件列表。
     */
    const handleDrop = useCallback(
        async (e: React.DragEvent) => {
            e.preventDefault();
            e.stopPropagation();
            dragCounter.current = 0;
            setIsDragOver(false);
            const files = e.dataTransfer.files;
            if (files.length > 0) {
                for (const file of Array.from(files)) {
                    const transferId = `upload_${Date.now()}_${file.name}`;
                    addTransfer(transferId, "upload", file.name);
                    try {
                        await onUploadFile(file);
                        updateTransfer(transferId, "success");
                    } catch {
                        updateTransfer(transferId, "error");
                        showToast("error", `"${file.name}" 上传失败`);
                    }
                }
            }
        },
        [onUploadFile, showToast, addTransfer, updateTransfer],
    );

    /** 当前私聊对象以外的在线用户数量，用于群聊标题中的「N 人在线」显示。 */
    const otherUserCount = users.filter((u) => u.user_id !== myUserId).length;
    /** 聊天窗口标题：群聊显示「所有人频道 (N)」，私聊显示对方昵称。 */
    const chatTitle =
        selectedChat === "all"
            ? `所有人频道 (${otherUserCount})`
            : users.find((u) => u.user_id === selectedChat)?.nickname || "聊天";
    /** 聊天窗口副标题：群聊显示「公共聊天室」，私聊显示「私密对话」。 */
    const chatSubtitle = selectedChat === "all" ? "公共聊天室" : "私密对话";

    return (
        <div
            className={`chat-window ${isDragOver ? "chat-window--drag-active" : ""}`}
            onDragEnter={handleDragEnter}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
        >
            {/* 聊天窗口顶部标题栏 */}
            <div className="chat-header">
                <div>
                    <h3 className="chat-header__title">{chatTitle}</h3>
                    <p className="chat-header__subtitle">{chatSubtitle}</p>
                </div>
            </div>

            {/* 消息列表区域 */}
            <div className="chat-messages">
                {filteredMessages.length === 0 ? (
                    /* 无消息时展示空状态引导提示 */
                    <div className="chat-empty">
                        <div className="chat-empty__inner animate-fade-in">
                            <div className="chat-empty__icon">
                                <Sparkles size={36} />
                            </div>
                            <h4 className="chat-empty__title">暂无消息记录</h4>
                            <p className="chat-empty__desc">
                                开始一段新的对话吧。在这里，您可以分享文件、图片和想法。
                            </p>
                        </div>
                    </div>
                ) : (
                    filteredMessages.map((msg) => (
                        <MessageBubble
                            key={msg.id}
                            message={msg}
                            isMine={msg.from_id === myUserId}
                            serverUrl={serverUrl}
                            showName={selectedChat === "all"}
                        />
                    ))
                )}
                {/* 滚动锚点，消息更新后自动定位到此处 */}
                <div ref={messagesEndRef} />
            </div>

            {/* 底部聊天输入区域 */}
            <ChatInput
                onSendMessage={onSendMessage}
                onUploadFile={onUploadFile}
                onShowToast={showToast}
                isDragOver={isDragOver}
            />

            {/* 右下角 Toast 提示容器 */}
            {toasts.length > 0 && (
                <div className="chat-toast-container">
                    {toasts.map((toast) => (
                        <div
                            key={toast.id}
                            className={`chat-toast chat-toast--${toast.type} animate-slide-up`}
                        >
                            {toast.type === "success" ? (
                                <CheckCircle2 size={16} />
                            ) : (
                                <XCircle size={16} />
                            )}
                            <span>{toast.message}</span>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}
