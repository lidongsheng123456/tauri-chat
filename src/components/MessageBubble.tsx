import { Download, FileIcon } from "lucide-react";
import type { ChatMessage } from "../types";

interface MessageBubbleProps {
  message: ChatMessage;
  isMine: boolean;
  serverUrl: string;
  showName?: boolean;
}

const AVATAR_COLORS = [
  "bg-rose-500", "bg-violet-500", "bg-sky-500", "bg-amber-500",
  "bg-emerald-500", "bg-pink-500", "bg-indigo-500", "bg-teal-500",
];

function getAvatarBg(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}

function formatTime(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" });
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
          <div className="max-w-[260px]">
            <img
              src={fileUrl}
              alt={message.file_name || "图片"}
              className="rounded-lg max-w-full cursor-pointer hover:brightness-95 transition-all duration-200"
              onClick={() => window.open(fileUrl, "_blank")}
              loading="lazy"
            />
            {message.file_name && (
              <div className={`text-xs mt-1.5 ${isMine ? "text-white/60" : "text-gray-400"}`}>{message.file_name}</div>
            )}
          </div>
        );

      case "video":
        return (
          <div className="max-w-[300px]">
            <video
              src={fileUrl}
              controls
              className="rounded-lg max-w-full bg-black/5"
              preload="metadata"
            />
            {message.file_name && (
              <div className={`text-xs mt-1.5 ${isMine ? "text-white/60" : "text-gray-400"}`}>{message.file_name}</div>
            )}
          </div>
        );

      case "file":
        return (
          <a
            href={fileUrl}
            download={message.file_name}
            target="_blank"
            rel="noopener noreferrer"
            className={`flex items-center gap-3 p-3 rounded-xl border transition-colors duration-150 cursor-pointer min-w-[200px] ${isMine
              ? "border-white/15 hover:bg-white/10"
              : "border-gray-200 bg-gray-50 hover:bg-gray-100"
              }`}
          >
            <div className={`w-10 h-10 rounded-lg flex items-center justify-center shrink-0 ${isMine ? "bg-white/15" : "bg-accent/10"}`}>
              <FileIcon className={`w-5 h-5 ${isMine ? "text-white/90" : "text-accent"}`} />
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-sm font-medium truncate">{message.file_name || "文件"}</div>
              {message.file_size != null && (
                <div className={`text-xs mt-0.5 ${isMine ? "text-white/50" : "text-gray-400"}`}>
                  {formatFileSize(message.file_size)}
                </div>
              )}
            </div>
            <Download className={`w-4 h-4 shrink-0 ${isMine ? "text-white/50" : "text-gray-300"}`} />
          </a>
        );

      default:
        return (
          <div className="text-sm leading-relaxed whitespace-pre-wrap wrap-break-word">
            {message.content}
          </div>
        );
    }
  };

  const bubbleStyle = isMine
    ? "bg-bubble-mine text-white rounded-2xl rounded-br-sm"
    : "bg-bubble-other text-gray-800 shadow-sm border border-gray-100 rounded-2xl rounded-bl-sm";

  return (
    <div className={`flex mb-4 ${isMine ? "justify-end animate-slide-right" : "justify-start animate-slide-left"}`}>
      {/* Avatar for others */}
      {!isMine && showName && (
        <div className={`w-9 h-9 rounded-xl ${getAvatarBg(message.from_name)} flex items-center justify-center text-white text-xs font-bold shrink-0 mt-5 mr-2.5`}>
          {message.from_name.charAt(0).toUpperCase()}
        </div>
      )}
      <div className={`max-w-[65%] flex flex-col ${isMine ? "items-end" : "items-start"}`}>
        {!isMine && showName && (
          <div className="text-xs text-gray-400 mb-1 ml-1 font-medium">{message.from_name}</div>
        )}
        <div className={`px-4 py-2.5 ${bubbleStyle}`}>
          {renderContent()}
        </div>
        <div className={`text-[11px] text-gray-400/60 mt-1 ${isMine ? "mr-1" : "ml-1"}`}>
          {formatTime(message.timestamp)}
        </div>
      </div>
    </div>
  );
}
