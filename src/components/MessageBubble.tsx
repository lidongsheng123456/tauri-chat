import { FileIcon } from "lucide-react";
import type { ChatMessage } from "../types";

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
  const fileUrl = message.content.startsWith("/files/")
    ? `http://${serverUrl}${message.content}`
    : message.content;

  const renderContent = () => {
    switch (message.msg_type) {
      case "image":
        return (
          <div className="message-media">
            <img
              src={fileUrl}
              alt={message.file_name || "图片"}
              onClick={() => window.open(fileUrl, "_blank")}
              loading="lazy"
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
          <a
            href={fileUrl}
            download={message.file_name}
            target="_blank"
            rel="noopener noreferrer"
            className="message-file"
          >
            <div className={`message-file__icon ${isMine ? "message-file__icon--mine" : "message-file__icon--other"}`}>
              <FileIcon size={24} style={{ color: isMine ? "white" : "var(--text-secondary)" }} />
            </div>
            <div className="message-file__info">
              <div className={`message-file__name ${isMine ? "message-file__name--mine" : "message-file__name--other"}`}>
                {message.file_name || "文件"}
              </div>
              {message.file_size != null && (
                <div className={`message-file__size ${isMine ? "message-file__size--mine" : "message-file__size--other"}`}>
                  {formatFileSize(message.file_size)}
                </div>
              )}
            </div>
          </a>
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
    </div>
  );
}
