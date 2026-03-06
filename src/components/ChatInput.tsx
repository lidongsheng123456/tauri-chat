import { FileUp, Folder, Image as ImageIcon } from "lucide-react";
import { useCallback, useRef, useState } from "react";
import { useTransfers } from "../hooks/useTransfers";

/** 聊天输入区域 Props */
interface ChatInputProps {
  onSendMessage: (content: string) => void;
  onUploadFile: (file: File) => void;
  onShowToast: (type: "success" | "error", message: string) => void;
  isDragOver: boolean;
}

/** 聊天输入区域 - 文本输入、文件/图片上传工具栏 */
export function ChatInput({ onSendMessage, onUploadFile, onShowToast, isDragOver }: ChatInputProps) {
  const [input, setInput] = useState("");
  const { addTransfer, updateTransfer, hasActiveTransfers } = useTransfers();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

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
  const handleFileChange = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
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
          onShowToast("error", `"${file.name}" 上传失败`);
        }
      }
    }
    e.target.value = "";
  }, [onUploadFile, onShowToast, addTransfer, updateTransfer]);

  return (
    <>
      {/* Drag overlay */}
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

      {/* Input Area */}
      <div className="chat-input-area">
        <div className="chat-input-box">
          <div className="chat-toolbar">
            <button onClick={() => imageInputRef.current?.click()} className="chat-toolbar__btn" title="发送图片/视频">
              <ImageIcon size={20} />
            </button>
            <button onClick={() => fileInputRef.current?.click()} className="chat-toolbar__btn" title="发送文件">
              <Folder size={20} />
            </button>
          </div>

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
              <button onClick={handleSend} disabled={!input.trim()} className="chat-send-btn">
                发送
              </button>
            </div>
          </div>
        </div>

        <input ref={imageInputRef} type="file" accept="image/*,video/*" multiple onChange={handleFileChange} className="hidden" />
        <input ref={fileInputRef} type="file" multiple onChange={handleFileChange} className="hidden" />
      </div>
    </>
  );
}
