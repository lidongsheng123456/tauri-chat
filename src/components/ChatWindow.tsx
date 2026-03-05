import { Film, Hash, ImageIcon, Lock, MessageCircle, Paperclip, Send, Upload } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { ChatMessage, UserInfo } from "../types";
import { MessageBubble } from "./MessageBubble";

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
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const videoInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const filteredMessages = messages.filter((m) => {
    if (selectedChat === "all") return m.to_id === "all";
    return (
      (m.from_id === myUserId && m.to_id === selectedChat) ||
      (m.from_id === selectedChat && m.to_id === myUserId)
    );
  });

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [filteredMessages.length]);

  const handleSend = () => {
    if (!input.trim()) return;
    onSendMessage(input.trim());
    setInput("");
    if (textareaRef.current) {
      textareaRef.current.style.height = "44px";
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
    el.style.height = "44px";
    el.style.height = Math.min(el.scrollHeight, 120) + "px";
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files) {
      setIsUploading(true);
      for (const file of Array.from(files)) {
        await onUploadFile(file);
      }
      setIsUploading(false);
    }
    e.target.value = "";
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    const files = e.dataTransfer.files;
    if (files.length > 0) {
      setIsUploading(true);
      for (const file of Array.from(files)) {
        await onUploadFile(file);
      }
      setIsUploading(false);
    }
  };

  const chatTitle =
    selectedChat === "all"
      ? "群聊"
      : users.find((u) => u.user_id === selectedChat)?.nickname || "聊天";

  const chatSubtitle =
    selectedChat === "all"
      ? `${users.length} 位成员在线`
      : "私密对话";

  return (
    <div
      className="flex-1 flex flex-col h-full bg-chat-bg relative min-w-0"
      onDragOver={(e) => { e.preventDefault(); setIsDragOver(true); }}
      onDragLeave={() => setIsDragOver(false)}
      onDrop={handleDrop}
    >
      {/* Chat Header */}
      <div className="px-6 py-4 bg-white border-b border-gray-200/70 flex items-center gap-3.5 shrink-0">
        <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${selectedChat === "all" ? "bg-accent/10" : "bg-violet-500/10"}`}>
          {selectedChat === "all"
            ? <Hash className="w-5 h-5 text-accent" />
            : <Lock className="w-5 h-5 text-violet-500" />
          }
        </div>
        <div className="min-w-0">
          <h3 className="font-semibold text-gray-900 text-base truncate">{chatTitle}</h3>
          <p className="text-xs text-gray-400 mt-0.5">{chatSubtitle}</p>
        </div>
      </div>

      {/* Messages Area */}
      <div className="flex-1 overflow-y-auto px-6 py-4 relative">
        {/* Drag overlay */}
        {isDragOver && (
          <div className="absolute inset-4 bg-accent/5 border-2 border-dashed border-accent/30 rounded-2xl z-10 flex flex-col items-center justify-center animate-scale-in">
            <div className="w-16 h-16 rounded-2xl bg-accent/10 flex items-center justify-center mb-4">
              <Upload className="w-8 h-8 text-accent" />
            </div>
            <div className="text-accent font-semibold text-base">释放以发送文件</div>
            <div className="text-accent/50 text-sm mt-1">支持图片、视频和任意文件</div>
          </div>
        )}

        {/* Upload indicator */}
        {isUploading && (
          <div className="absolute top-4 left-1/2 -translate-x-1/2 bg-white shadow-lg shadow-black/8 rounded-full px-5 py-2.5 flex items-center gap-2.5 z-10 animate-fade-in border border-gray-100">
            <div className="w-4 h-4 border-2 border-accent border-t-transparent rounded-full animate-spin" />
            <span className="text-sm text-gray-600 font-medium">上传中...</span>
          </div>
        )}

        {filteredMessages.length === 0 ? (
          <div className="flex items-center justify-center h-full">
            <div className="text-center animate-fade-in">
              <div className="w-20 h-20 rounded-2xl bg-gray-100 flex items-center justify-center mx-auto mb-5">
                <MessageCircle className="w-9 h-9 text-gray-300" />
              </div>
              <p className="text-gray-500 font-semibold text-base">暂无消息</p>
              <p className="text-gray-400 text-sm mt-2">发送第一条消息开始聊天吧</p>
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
      <div className="px-5 py-3.5 bg-white border-t border-gray-100 shrink-0">
        {/* Toolbar */}
        <div className="flex items-center gap-1 mb-2.5">
          <button
            onClick={() => imageInputRef.current?.click()}
            className="p-2 text-gray-400 hover:text-accent hover:bg-accent/8 rounded-lg transition-colors duration-150 cursor-pointer"
            title="发送图片"
          >
            <ImageIcon className="w-5 h-5" />
          </button>
          <button
            onClick={() => videoInputRef.current?.click()}
            className="p-2 text-gray-400 hover:text-accent hover:bg-accent/8 rounded-lg transition-colors duration-150 cursor-pointer"
            title="发送视频"
          >
            <Film className="w-5 h-5" />
          </button>
          <button
            onClick={() => fileInputRef.current?.click()}
            className="p-2 text-gray-400 hover:text-accent hover:bg-accent/8 rounded-lg transition-colors duration-150 cursor-pointer"
            title="发送文件"
          >
            <Paperclip className="w-5 h-5" />
          </button>
        </div>

        {/* Input row */}
        <div className="flex items-end gap-3">
          <div className="flex-1 min-w-0">
            <textarea
              ref={textareaRef}
              value={input}
              onChange={handleTextareaInput}
              onKeyDown={handleKeyDown}
              placeholder="输入消息...  Enter 发送，Shift+Enter 换行"
              rows={1}
              className="w-full px-4 py-3 bg-input-bg border border-gray-200 rounded-xl resize-none focus:ring-2 focus:ring-accent/20 focus:border-accent/30 outline-none text-sm text-gray-800 placeholder-gray-400 transition-all duration-150"
              style={{ height: "44px", maxHeight: "120px" }}
            />
          </div>

          <button
            onClick={handleSend}
            disabled={!input.trim()}
            className="p-3 bg-accent text-white rounded-xl hover:bg-accent-hover active:scale-95 transition-all duration-150 disabled:opacity-30 disabled:cursor-not-allowed disabled:active:scale-100 shadow-sm hover:shadow-md cursor-pointer shrink-0"
          >
            <Send className="w-5 h-5" />
          </button>
        </div>

        {/* Hidden file inputs */}
        <input ref={imageInputRef} type="file" accept="image/*" multiple onChange={handleFileChange} className="hidden" />
        <input ref={videoInputRef} type="file" accept="video/*" multiple onChange={handleFileChange} className="hidden" />
        <input ref={fileInputRef} type="file" multiple onChange={handleFileChange} className="hidden" />
      </div>
    </div>
  );
}
