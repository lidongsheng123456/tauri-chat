import { invoke } from "@tauri-apps/api/core";
import { Download, FileIcon } from "lucide-react";
import { useState } from "react";
import type { ChatMessage } from "../types";
import { ImagePreview } from "./ImagePreview";

interface MessageBubbleProps {
  message: ChatMessage;
  isMine: boolean;
  serverUrl: string;
  showName?: boolean;
}

const AVATAR_COLOR_COUNT = 7;

function getAvatarColorClass(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
  return `avatar-color-${Math.abs(hash) % AVATAR_COLOR_COUNT}`;
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return bytes + " B";
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
  if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + " MB";
  return (bytes / (1024 * 1024 * 1024)).toFixed(1) + " GB";
}

export function MessageBubble({ message, isMine, serverUrl, showName = true }: MessageBubbleProps) {
  const [showPreview, setShowPreview] = useState(false);

  const fileUrl = message.content.startsWith("/files/")
    ? `http://${serverUrl}${message.content}`
    : message.content;

  const [downloading, setDownloading] = useState(false);
  const [downloadResult, setDownloadResult] = useState<string | null>(null);

  const handleDownload = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (downloading) return;
    setDownloading(true);
    setDownloadResult(null);
    try {
      // Use Tauri command to copy file to Downloads folder (bypasses webview restrictions)
      const savedPath = await invoke<string>("download_chat_file", {
        filePath: message.content,
        fileName: message.file_name || "download",
        serverUrl: serverUrl,
      });
      setDownloadResult(savedPath);
      setTimeout(() => setDownloadResult(null), 3000);
    } catch (err) {
      console.error("Download failed:", err);
      alert(`下载失败: ${err}`);
    } finally {
      setDownloading(false);
    }
  };

  const renderContent = () => {
    switch (message.msg_type) {
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

      case "video":
        return (
          <div className="message-media">
            <video
              src={fileUrl}
              controls
              preload="metadata"
            />
          </div>
        );

      case "file":
        return (
          <div className="message-file">
            <div className={`message-file__icon ${isMine ? "message-file__icon--mine" : "message-file__icon--other"}`}>
              <FileIcon size={24} style={{ color: isMine ? "white" : "var(--text-secondary)" }} />
            </div>
            <div className="message-file__info">
              <div className={`message-file__name ${isMine ? "message-file__name--mine" : "message-file__name--other"}`}>
                {message.file_name || "文件"}
              </div>
              {downloadResult ? (
                <div className={`message-file__size ${isMine ? "message-file__size--mine" : "message-file__size--other"}`}>
                  ✓ 已保存到下载目录
                </div>
              ) : message.file_size != null ? (
                <div className={`message-file__size ${isMine ? "message-file__size--mine" : "message-file__size--other"}`}>
                  {formatFileSize(message.file_size)}
                </div>
              ) : null}
            </div>
            <button
              onClick={handleDownload}
              disabled={downloading}
              className={`message-file__download ${isMine ? "message-file__download--mine" : "message-file__download--other"} ${downloading ? "message-file__download--loading" : ""}`}
              title={downloading ? "下载中..." : "下载文件"}
            >
              {downloading ? <div className={`chat-upload-spinner animate-spin ${isMine ? "chat-upload-spinner--white" : ""}`} style={{ width: 16, height: 16 }} /> : <Download size={18} />}
            </button>
          </div>
        );

      default:
        return (
          <div className={`message-text ${isMine ? "message-text--mine" : "message-text--other"}`}>
            {message.content}
          </div>
        );
    }
  };

  return (
    <div className={`message-row ${isMine ? "message-row--mine" : "message-row--other"} animate-slide-up`}>
      {/* Avatar for others */}
      {!isMine && showName && (
        <div className="message-avatar message-avatar--left">
          <div className={`avatar avatar--sm ${getAvatarColorClass(message.from_name)}`}>
            {message.from_name.charAt(0).toUpperCase()}
          </div>
        </div>
      )}

      <div className={`message-content ${isMine ? "message-content--mine" : "message-content--other"}`}>
        {!isMine && showName && (
          <div className="message-sender">{message.from_name}</div>
        )}
        <div className={`message-bubble ${isMine ? "message-bubble--mine" : "message-bubble--other"}`}>
          {renderContent()}
        </div>
      </div>

      {/* Avatar for me */}
      {isMine && (
        <div className="message-avatar message-avatar--right">
          <div className="avatar avatar--sm avatar--me">我</div>
        </div>
      )}

      {/* Image Preview Lightbox */}
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
