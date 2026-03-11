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

/** 消息气泡组件的 Props */
interface MessageBubbleProps {
    message: ChatMessage;
    isMine: boolean;
    serverUrl: string;
    showName?: boolean;
}

// ─── 主组件 ───────────────────────────────────────────────────────────────────

/**
 * 单条消息气泡
 * 支持文本、图片、视频和文件消息，文件消息带下载功能
 */
export function MessageBubble({
    message,
    isMine,
    serverUrl,
    showName = true,
}: MessageBubbleProps) {
    const [showPreview, setShowPreview] = useState(false);
    const { addTransfer, updateTransfer, transfers } = useTransfers();

    // 构造完整文件 URL（仅对 /files/ 路径拼接服务器地址）
    const fileUrl = message.content.startsWith("/files/")
        ? `http://${serverUrl}${message.content}`
        : message.content;

    // 下载任务 ID 与状态
    const transferId = `download_${message.id}`;
    const activeTransfer = transfers.find((t) => t.id === transferId);
    const downloading = activeTransfer?.status === "active";
    const downloadDone = activeTransfer?.status === "success";

    /** 通过 Tauri invoke 将文件下载到本地磁盘 */
    const handleDownload = useCallback(
        async (e?: React.MouseEvent) => {
            e?.preventDefault();
            e?.stopPropagation();
            // 已在下载或已完成时不重复触发
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

    /** 根据消息类型渲染气泡内容 */
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

                // 根据下载状态决定显示文字
                let description: React.ReactNode = undefined;
                // FileCard 背景始终为白色（mine/other 均使用白色卡片），
                // 因此描述文字统一使用深色，不能用白色
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

    // 文件消息直接渲染卡片，不套 message-bubble 容器（避免双重背景）
    const isFileMsg = message.msg_type === "file";

    return (
        <div
            className={`message-row ${isMine ? "message-row--mine" : "message-row--other"} animate-slide-up`}
        >
            {/* 对方头像（左侧） */}
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
                {/* 显示发送者昵称（仅对方且开启 showName 时） */}
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

            {/* 自己的头像（右侧） */}
            {isMine && (
                <div className="message-avatar message-avatar--right">
                    <div className="avatar avatar--sm avatar--me">我</div>
                </div>
            )}

            {/* 图片全屏预览灯箱 */}
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
