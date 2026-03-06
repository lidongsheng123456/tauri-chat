import { CheckCircle2, FileUp, Folder, Image as ImageIcon, Sparkles, XCircle } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTransfers } from "../hooks/useTransfers";
import type { ChatMessage, UserInfo } from "../types";
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

/** 聊天消息窗口 - 支持文本、图片、视频、文件及拖拽上传 */
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
  const [toasts, setToasts] = useState<Toast[]>([]);
  const { addTransfer, updateTransfer, hasActiveTransfers } = useTransfers();
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
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

  /** 发送当前输入内容 */
  const handleSend = () => {
    if (!input.trim()) return;
    onSendMessage(input.trim());
    setInput("");
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
    }
  };

  /** Enter 发送，Shift+Enter 换行 */
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  /** 输入时自动增高 textarea */
  const handleTextareaInput = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value);
    const el = e.target;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 120) + "px";
  };

  /** 处理文件选择上传 */
  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files && files.length > 0) {
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
    e.target.value = "";
  };

  /** 拖拽进入时显示上传遮罩 */
  const handleDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounter.current += 1;
    if (e.dataTransfer.items.length > 0) {
      setIsDragOver(true);
    }
  }, []);

  /** 拖拽离开时隐藏遮罩 */
  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounter.current -= 1;
    if (dragCounter.current === 0) {
      setIsDragOver(false);
    }
  }, []);

  /** 阻止默认拖拽行为以允许 drop */
  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  /** 拖拽释放时上传文件 */
  const handleDrop = useCallback(async (e: React.DragEvent) => {
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
  }, [onUploadFile, showToast, addTransfer, updateTransfer]);

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
      {hasActiveTransfers && (
        <div className="chat-upload-indicator animate-slide-up">
          <div className="chat-upload-spinner animate-spin" />
          <span className="chat-upload-text">文件传输中...</span>
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
