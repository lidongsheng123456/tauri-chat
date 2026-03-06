import { CheckCircle2, Sparkles, XCircle } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ChatMessage, UserInfo } from "../types";
import { ChatInput } from "./ChatInput";
import { MessageBubble } from "./MessageBubble";

/** 提示消息 */
interface Toast {
  id: number;
  type: "success" | "error";
  message: string;
}

/** 聊天窗口 Props */
interface ChatWindowProps {
  messages: ChatMessage[];
  myUserId: string;
  selectedChat: string;
  users: UserInfo[];
  serverUrl: string;
  onSendMessage: (content: string) => void;
  onUploadFile: (file: File) => void;
}

/** 聊天消息窗口 - 消息列表、拖拽上传 */
export function ChatWindow({
  messages, myUserId, selectedChat, users, serverUrl, onSendMessage, onUploadFile,
}: ChatWindowProps) {
  const [isDragOver, setIsDragOver] = useState(false);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const dragCounter = useRef(0);
  const toastId = useRef(0);
  const toastTimers = useRef<Map<number, ReturnType<typeof setTimeout>>>(new Map());

  useEffect(() => {
    return () => {
      for (const timer of toastTimers.current.values()) clearTimeout(timer);
    };
  }, []);

  /** 显示 3 秒后自动消失的提示 */
  const showToast = useCallback((type: "success" | "error", message: string) => {
    const id = ++toastId.current;
    setToasts((prev) => [...prev, { id, type, message }]);
    const timer = setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
      toastTimers.current.delete(id);
    }, 3000);
    toastTimers.current.set(id, timer);
  }, []);

  const filteredMessages = useMemo(() =>
    messages.filter((m) => {
      if (selectedChat === "all") return m.to_id === "all";
      return (
        (m.from_id === myUserId && m.to_id === selectedChat) ||
        (m.from_id === selectedChat && m.to_id === myUserId)
      );
    }),
    [messages, selectedChat, myUserId]
  );

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [filteredMessages.length]);

  /** 拖拽进入 */
  const handleDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounter.current += 1;
    if (e.dataTransfer.items.length > 0) setIsDragOver(true);
  }, []);

  /** 拖拽离开 */
  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounter.current -= 1;
    if (dragCounter.current === 0) setIsDragOver(false);
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  /** 拖拽释放上传 */
  const handleDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounter.current = 0;
    setIsDragOver(false);
    const files = e.dataTransfer.files;
    if (files.length > 0) {
      for (const file of Array.from(files)) {
        try {
          await onUploadFile(file);
        } catch {
          showToast("error", `"${file.name}" 上传失败`);
        }
      }
    }
  }, [onUploadFile, showToast]);

  const otherUserCount = users.filter((u) => u.user_id !== myUserId).length;
  const chatTitle = selectedChat === "all"
    ? `所有人频道 (${otherUserCount})`
    : users.find((u) => u.user_id === selectedChat)?.nickname || "聊天";
  const chatSubtitle = selectedChat === "all" ? "公共聊天室" : "私密对话";

  return (
    <div
      className={`chat-window ${isDragOver ? "chat-window--drag-active" : ""}`}
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <div className="chat-header">
        <div>
          <h3 className="chat-header__title">{chatTitle}</h3>
          <p className="chat-header__subtitle">{chatSubtitle}</p>
        </div>
      </div>

      <div className="chat-messages">
        {filteredMessages.length === 0 ? (
          <div className="chat-empty">
            <div className="chat-empty__inner animate-fade-in">
              <div className="chat-empty__icon"><Sparkles size={36} /></div>
              <h4 className="chat-empty__title">暂无消息记录</h4>
              <p className="chat-empty__desc">开始一段新的对话吧。在这里，您可以分享文件、图片和想法。</p>
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
        <div ref={messagesEndRef} />
      </div>

      <ChatInput
        onSendMessage={onSendMessage}
        onUploadFile={onUploadFile}
        onShowToast={showToast}
        isDragOver={isDragOver}
      />

      {toasts.length > 0 && (
        <div className="chat-toast-container">
          {toasts.map((toast) => (
            <div key={toast.id} className={`chat-toast chat-toast--${toast.type} animate-slide-up`}>
              {toast.type === "success" ? <CheckCircle2 size={16} /> : <XCircle size={16} />}
              <span>{toast.message}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
