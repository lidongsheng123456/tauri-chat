import { FileCard } from "@ant-design/x";
import { Download } from "lucide-react";
import { useCallback, useState } from "react";
import { useTransfers } from "../hooks/useTransfers";
import { getAvatarColorClass } from "../utils/avatar";
import { type ChatMessage } from "../types";
import { getFileIconType } from "../utils/fileIcon";
import { formatFileSize } from "../utils/format";
import { tauriInvoke } from "../utils/tauri";
import { ImagePreview } from "./ImagePreview";

// ─── 类型定义 ─────────────────────────────────────────────────────────────────

/**
 * `MessageBubble` 组件的 Props。
 */
interface MessageBubbleProps {
    /** 需要渲染的单条聊天消息数据，类型包含文本、图片、视频和文件四种形态。 */
    message: ChatMessage;
    /**
     * 是否为当前用户自己发送的消息。
     *
     * `true` 时气泡靠右对齐（蓝色背景），`false` 时靠左对齐（白色背景），
     * 同时决定头像的显示位置与样式。
     */
    isMine: boolean;
    /**
     * 聊天服务器地址（含端口），格式为 `host:port`（如 `"192.168.1.1:9120"`）。
     *
     * 用于将消息中的相对路径（`/files/<name>`）拼接为完整的可访问 URL，
     * 以及在下载文件时作为 Tauri Command `download_chat_file` 的参数传入。
     */
    serverUrl: string;
    /**
     * 是否显示发送者昵称与头像。
     *
     * 群聊模式下为 `true`，显示发送者名称与左侧头像；
     * 私聊模式下为 `false`，隐藏昵称与对方头像以保持界面简洁。
     * 默认值为 `true`。
     */
    showName?: boolean;
}

// ─── 主组件 ───────────────────────────────────────────────────────────────────

/**
 * 单条聊天消息气泡组件，根据 `msg_type` 自动选择渲染方式：
 * - `text`  — 纯文本气泡，带背景色区分自己/他人。
 * - `image` — 可点击的图片缩略图，点击后弹出 `ImagePreview` 全屏灯箱。
 * - `video` — 内嵌 `<video>` 播放器，带原生控制条。
 * - `file`  — Ant Design X `FileCard` 卡片，点击或悬停后显示下载按钮。
 *
 * 文件下载通过 Tauri Command `download_chat_file` 调用 Rust 后端完成，
 * 下载状态由 `useTransfers` 上下文统一管理，防止重复触发。
 * 文件消息不套 `message-bubble` 容器，直接渲染 `FileCard`，避免双重背景色。
 *
 * @param {MessageBubbleProps} props - 组件 Props，详见 `MessageBubbleProps` 接口定义。
 */
export function MessageBubble({
    message,
    isMine,
    serverUrl,
    showName = true,
}: MessageBubbleProps) {
    const [showPreview, setShowPreview] = useState(false);
    const { addTransfer, updateTransfer, transfers } = useTransfers();

    /**
     * 构造文件的完整访问 URL。
     *
     * 若 `content` 以 `/files/` 开头（服务器相对路径），则拼接服务器地址前缀；
     * 否则原样使用（兼容已是完整 URL 的历史消息）。
     */
    const fileUrl = message.content.startsWith("/files/")
        ? `http://${serverUrl}${message.content}`
        : message.content;

    /** 当前消息对应下载任务的唯一 ID，格式为 `download_<messageId>`。 */
    const transferId = `download_${message.id}`;
    /** 当前下载任务在 `useTransfers` 上下文中的状态记录。 */
    const activeTransfer = transfers.find((t) => t.id === transferId);
    /** 是否正在下载中（`status === "active"`）。 */
    const downloading = activeTransfer?.status === "active";
    /** 是否已下载完成（`status === "success"`）。 */
    const downloadDone = activeTransfer?.status === "success";

    /**
     * 触发文件下载，调用 Rust 后端将文件保存到本机下载目录。
     *
     * 对应 Rust Command: `download_chat_file`
     *
     * 下载流程：
     * 1. 通过 `addTransfer` 注册下载任务，触发 `TransferIndicator` 显示进度。
     * 2. 调用 `tauriInvoke("download_chat_file", ...)` 执行实际下载（优先本地缓存，其次远程拉取）。
     * 3. 下载完成后调用 `updateTransfer(id, "success")` 更新状态；失败时调用 `updateTransfer(id, "error")`。
     *
     * 防重入：正在下载或已完成时调用将被静默忽略，防止重复触发。
     *
     * @param {React.MouseEvent} [e] - 可选的鼠标事件，调用时阻止事件冒泡。
     * @returns {Promise<void>}
     */
    const handleDownload = useCallback(
        async (e?: React.MouseEvent) => {
            e?.preventDefault();
            e?.stopPropagation();
            if (downloading || downloadDone) return;
            const fileName = message.file_name || "download";
            addTransfer(transferId, "download", fileName);
            const result = await tauriInvoke<string>(
                "download_chat_file",
                { filePath: message.content, fileName, serverUrl },
                (err) => {
                    console.error("文件下载失败:", err);
                    updateTransfer(transferId, "error");
                },
            );
            if (result !== null) {
                updateTransfer(transferId, "success");
            }
        },
        [
            downloading,
            downloadDone,
            message.file_name,
            message.content,
            serverUrl,
            transferId,
            addTransfer,
            updateTransfer,
        ],
    );

    /**
     * 根据 `message.msg_type` 渲染气泡内容区域。
     *
     * 各类型渲染逻辑：
     * - `image` — 懒加载缩略图，点击后打开全屏 `ImagePreview` 灯箱。
     * - `video` — 内嵌原生 `<video>` 播放器，预加载元数据以获取封面帧。
     * - `file`  — `FileCard` 卡片，根据下载状态切换描述文字与遮罩层图标。
     * - 其他    — 纯文本消息气泡，通过 CSS 类名区分自己/他人的背景色。
     *
     * @returns {React.ReactNode} 气泡内容的 JSX 节点。
     */
    const renderContent = () => {
        switch (message.msg_type) {
            // ── 图片消息 ──────────────────────────────────────────────────────
            case "image":
                return (
                    <div className="message-media">
                        <img
                            src={fileUrl}
                            alt={message.file_name || "图片"}
                            onClick={() => setShowPreview(true)}
                            loading="lazy"
                            className="message-media__img--clickable"
                        />
                    </div>
                );

            // ── 视频消息 ──────────────────────────────────────────────────────
            case "video":
                return (
                    <div className="message-media">
                        <video src={fileUrl} controls preload="metadata" />
                    </div>
                );

            // ── 文件消息 ──────────────────────────────────────────────────────
            case "file": {
                const fileName = message.file_name || "文件";
                const iconType = getFileIconType(fileName);

                /**
                 * 根据下载状态动态生成 FileCard 的描述文字节点。
                 * FileCard 背景始终为白色，因此描述文字统一使用深色，不随气泡主题色变化。
                 */
                let description: React.ReactNode = undefined;
                if (downloadDone) {
                    description = (
                        <span style={{ color: "var(--accent)" }}>
                            ✓ 已保存到下载目录
                        </span>
                    );
                } else if (downloading) {
                    description = (
                        <span style={{ color: "var(--text-muted)" }}>
                            下载中…
                        </span>
                    );
                } else if (message.file_size != null) {
                    description = (
                        <span style={{ color: "var(--text-muted)" }}>
                            {formatFileSize(message.file_size)}
                        </span>
                    );
                }

                return (
                    <div
                        className={`msg-filecard ${isMine ? "msg-filecard--mine" : "msg-filecard--other"}`}
                    >
                        <FileCard
                            // eslint-disable-next-line @typescript-eslint/no-explicit-any
                            icon={iconType as any}
                            name={fileName}
                            byte={message.file_size}
                            description={description}
                            mask={
                                !downloadDone ? (
                                    <div
                                        className="msg-filecard__mask"
                                        onClick={handleDownload}
                                        style={{
                                            cursor: downloading
                                                ? "default"
                                                : "pointer",
                                        }}
                                    >
                                        {downloading ? (
                                            /* 下载进行中：旋转加载图标 */
                                            <div
                                                className="chat-upload-spinner animate-spin"
                                                style={{
                                                    width: 20,
                                                    height: 20,
                                                    borderColor:
                                                        "rgba(255,255,255,0.8)",
                                                    borderTopColor:
                                                        "transparent",
                                                }}
                                            />
                                        ) : (
                                            /* 未下载：显示下载图标 */
                                            <Download size={18} color="white" />
                                        )}
                                    </div>
                                ) : undefined
                            }
                            onClick={
                                !downloading && !downloadDone
                                    ? handleDownload
                                    : undefined
                            }
                        />
                    </div>
                );
            }

            // ── 默认：纯文本消息 ──────────────────────────────────────────────
            default:
                return (
                    <div
                        className={`message-text ${isMine ? "message-text--mine" : "message-text--other"}`}
                    >
                        {message.content}
                    </div>
                );
        }
    };

    /**
     * 文件消息直接渲染 `FileCard`，不套 `message-bubble` 容器，
     * 避免外层气泡背景色与 FileCard 白色背景产生双重嵌套的视觉问题。
     */
    const isFileMsg = message.msg_type === "file";

    return (
        <div
            className={`message-row ${isMine ? "message-row--mine" : "message-row--other"} animate-slide-up`}
        >
            {/* 对方头像（左侧），仅在非自己消息且开启 showName 时显示 */}
            {!isMine && showName && (
                <div className="message-avatar message-avatar--left">
                    <div
                        className={`avatar avatar--sm ${getAvatarColorClass(message.from_name)}`}
                    >
                        {message.from_name.charAt(0).toUpperCase()}
                    </div>
                </div>
            )}

            <div
                className={`message-content ${isMine ? "message-content--mine" : "message-content--other"}`}
            >
                {/* 发送者昵称，仅对方消息且 showName 为 true 时渲染 */}
                {!isMine && showName && (
                    <div className="message-sender">{message.from_name}</div>
                )}

                {isFileMsg ? (
                    /* 文件卡片：直接渲染，跳过 message-bubble 包装 */
                    renderContent()
                ) : (
                    <div
                        className={`message-bubble ${isMine ? "message-bubble--mine" : "message-bubble--other"}`}
                    >
                        {renderContent()}
                    </div>
                )}
            </div>

            {/* 自己的头像（右侧），仅自己发送的消息显示 */}
            {isMine && (
                <div className="message-avatar message-avatar--right">
                    <div className="avatar avatar--sm avatar--me">我</div>
                </div>
            )}

            {/* 图片全屏预览灯箱，点击图片后通过 portal 渲染到 body */}
            {showPreview && message.msg_type === "image" && (
                <ImagePreview
                    src={fileUrl}
                    alt={message.file_name || "图片"}
                    onClose={() => setShowPreview(false)}
                />
            )}
        </div>
    );
}
