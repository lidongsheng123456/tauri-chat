import { Bot, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { AiChatMessage } from "../hooks/useAiChat";

interface AiChatWindowProps {
  chatMessages: AiChatMessage[];
  isLoading: boolean;
  onSendMessage: (content: string) => void;
  onClearHistory: () => void;
}

export function AiChatWindow({
  chatMessages,
  isLoading,
  onSendMessage,
  onClearHistory,
}: AiChatWindowProps) {
  const [input, setInput] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chatMessages.length, chatMessages[chatMessages.length - 1]?.content]);

  const handleSend = () => {
    if (!input.trim() || isLoading) return;
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

  return (
    <div className="chat-window">
      {/* Header */}
      <div className="chat-header">
        <div style={{ display: "flex", alignItems: "center", gap: 12, flex: 1 }}>
          <div className="avatar avatar--bot avatar--sm">
            <Bot size={16} />
          </div>
          <div>
            <h3 className="chat-header__title">AI 助手</h3>
            <p className="chat-header__subtitle">LongCat-Flash-Chat</p>
          </div>
        </div>
        <div style={{ display: "flex", gap: 4 }}>
          <button
            onClick={onClearHistory}
            className="chat-toolbar__btn"
            title="清空对话"
          >
            <Trash2 size={18} />
          </button>
        </div>
      </div>

      {/* Messages */}
      <div className="chat-messages">
        {chatMessages.length === 0 ? (
          <div className="chat-empty">
            <div className="chat-empty__inner animate-fade-in">
              <div className="chat-empty__icon">
                <Bot size={36} />
              </div>
              <h4 className="chat-empty__title">AI 助手</h4>
              <p className="chat-empty__desc">开始和 AI 对话吧！支持上下文连续对话。</p>
            </div>
          </div>
        ) : (
          chatMessages.map((msg) => (
            <div
              key={msg.id}
              className={`message-row ${msg.role === "user" ? "message-row--mine" : "message-row--other"} animate-slide-up`}
            >
              {msg.role === "assistant" && (
                <div className="message-avatar message-avatar--left">
                  <div className="avatar avatar--sm avatar--bot">
                    <Bot size={14} />
                  </div>
                </div>
              )}

              <div className={`message-content ${msg.role === "user" ? "message-content--mine" : "message-content--other"}`}>
                {msg.role === "assistant" && (
                  <div className="message-sender">AI 助手</div>
                )}
                <div className={`message-bubble ${msg.role === "user" ? "message-bubble--mine" : "message-bubble--other"}`}>
                  {msg.loading ? (
                    <div className="ai-typing">
                      <span className="ai-typing__dot" />
                      <span className="ai-typing__dot" />
                      <span className="ai-typing__dot" />
                    </div>
                  ) : (
                    <div className={`message-text ${msg.role === "user" ? "message-text--mine" : "message-text--other"}`} style={{ whiteSpace: "pre-wrap" }}>
                      {msg.content}
                    </div>
                  )}
                </div>
              </div>

              {msg.role === "user" && (
                <div className="message-avatar message-avatar--right">
                  <div className="avatar avatar--sm avatar--me">我</div>
                </div>
              )}
            </div>
          ))
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div className="chat-input-area">
        <div className="chat-input-box">
          <div className="chat-input-inner">
            <textarea
              ref={textareaRef}
              value={input}
              onChange={handleTextareaInput}
              onKeyDown={handleKeyDown}
              placeholder="输入消息，Enter 发送..."
              className="chat-textarea"
            />
            <div className="chat-send-row">
              <button
                onClick={handleSend}
                disabled={!input.trim() || isLoading}
                className="chat-send-btn"
              >
                {isLoading ? "思考中..." : "发送"}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
