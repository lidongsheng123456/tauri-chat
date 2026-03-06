import { CheckCircle2, FileUp, Folder, Image as ImageIcon, Sparkles, XCircle } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ChatMessage, UserInfo } from "../types";
import { MessageBubble } from "./MessageBubble";

interface Toast {
  id: number;
  type: "success" | "error";
  message: string;
}

interface ChatWindowProps {
  messages: ChatMessage[];
  myUserId: string;
  selectedChat: string;
  users: UserInfo[];
  serverUrl: string;
  onSendMessage: (content: string) => void;
  onUploadFile: (file: File) => void;
}

export function ChatWindow({
  messages,
  myUserId,
  selectedChat,
  users,
  serverUrl,
  onSendMessage,
  onUploadFile,
}: ChatWindowProps) {
  const [input, setInput] = useState("");
  const [isDragOver, setIsDragOver] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const dragCounter = useRef(0);
  const toastId = useRef(0);

  const showToast = useCallback((type: "success" | "error", message: string) => {
    const id = ++toastId.current;
    setToasts((prev) => [...prev, { id, type, message }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 3000);
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

  const handleSend = () => {
    if (!input.trim()) return;
    onSendMessage(input.trim());
    setInput("");
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleTextareaInput = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value);
    const el = e.target;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 120) + "px";
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files && files.length > 0) {
      setIsUploading(true);
      let successCount = 0;
      for (const file of Array.from(files)) {
        try {
          await onUploadFile(file);
          successCount++;
        } catch {
          showToast("error", `"${file.name}" 上传失败`);
        }
      }
      setIsUploading(false);
      if (successCount > 0) {
        showToast("success", `成功上传 ${successCount} 个文件`);
      }
    }
    e.target.value = "";
  };

  const handleDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounter.current += 1;
    if (e.dataTransfer.items.length > 0) {
      setIsDragOver(true);
    }
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounter.current -= 1;
    if (dragCounter.current === 0) {
      setIsDragOver(false);
    }
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const handleDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounter.current = 0;
    setIsDragOver(false);
    const files = e.dataTransfer.files;
    if (files.length > 0) {
      setIsUploading(true);
      let successCount = 0;
      for (const file of Array.from(files)) {
        try {
          await onUploadFile(file);
          successCount++;
        } catch {
          showToast("error", `"${file.name}" 上传失败`);
        }
      }
      setIsUploading(false);
      if (successCount > 0) {
        showToast("success", `成功上传 ${successCount} 个文件`);
      }
    }
  }, [onUploadFile, showToast]);

  const otherUserCount = users.filter((u) => u.user_id !== myUserId).length;

  const chatTitle =
    selectedChat === "all"
      ? `所有人频道 (${otherUserCount})`
      : users.find((u) => u.user_id === selectedChat)?.nickname || "聊天";

  const chatSubtitle =
    selectedChat === "all"
      ? "公共聊天室"
      : "私密对话";

  return (
    <div
      className={`chat-window ${isDragOver ? "chat-window--drag-active" : ""}`}
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {/* Chat Header */}
      <div className="chat-header">
        <div>
          <h3 className="chat-header__title">{chatTitle}</h3>
          <p className="chat-header__subtitle">{chatSubtitle}</p>
        </div>
      </div>

      {/* Drag overlay — outside scrollable area so always visible */}
      {isDragOver && (
        <div className="chat-drag-overlay animate-scale-in">
          <div className="chat-drag-overlay__icon">
            <FileUp size={32} />
          </div>
          <div className="chat-drag-overlay__title">释放以上传文件</div>
          <div className="chat-drag-overlay__desc">支持图片、视频和各类文件</div>
        </div>
      )}

      {/* Upload indicator */}
      {isUploading && (
        <div className="chat-upload-indicator animate-slide-up">
          <div className="chat-upload-spinner animate-spin" />
          <span className="chat-upload-text">文件上传中...</span>
        </div>
      )}

      {/* Messages Area */}
      <div className="chat-messages">
        {filteredMessages.length === 0 ? (
          <div className="chat-empty">
            <div className="chat-empty__inner animate-fade-in">
              <div className="chat-empty__icon">
                <Sparkles size={36} />
              </div>
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

      {/* Input Area */}
      <div className="chat-input-area">
        <div className="chat-input-box">
          {/* Toolbar */}
          <div className="chat-toolbar">
            <button
              onClick={() => imageInputRef.current?.click()}
              className="chat-toolbar__btn"
              title="发送图片/视频"
            >
              <ImageIcon size={20} />
            </button>
            <button
              onClick={() => fileInputRef.current?.click()}
              className="chat-toolbar__btn"
              title="发送文件"
            >
              <Folder size={20} />
            </button>
          </div>

          {/* Input */}
          <div className="chat-input-inner">
            <textarea
              ref={textareaRef}
              value={input}
              onChange={handleTextareaInput}
              onKeyDown={handleKeyDown}
              placeholder="输入消息，Enter 发送，Shift + Enter 换行..."
              className="chat-textarea"
            />
            <div className="chat-send-row">
              <button
                onClick={handleSend}
                disabled={!input.trim()}
                className="chat-send-btn"
              >
                发送
              </button>
            </div>
          </div>
        </div>

        {/* Hidden file inputs */}
        <input ref={imageInputRef} type="file" accept="image/*,video/*" multiple onChange={handleFileChange} className="hidden" />
        <input ref={fileInputRef} type="file" multiple onChange={handleFileChange} className="hidden" />
      </div>

      {/* Toast notifications */}
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
