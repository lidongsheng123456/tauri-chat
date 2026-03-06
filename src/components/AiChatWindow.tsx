import { Bot, Globe, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { AiChatMessage } from "../hooks/useAiChat";
import { MarkdownRenderer } from "./MarkdownRenderer";

/** AI 聊天窗口 Props */
interface AiChatWindowProps {
  chatMessages: AiChatMessage[];
  isLoading: boolean;
  toolStatus: string | null;
  onSendMessage: (content: string) => void;
  onClearHistory: () => void;
}

/** AI 聊天窗口 - Markdown 渲染、加载态 */
export function AiChatWindow({
  chatMessages,
  isLoading,
  toolStatus,
  onSendMessage,
  onClearHistory,
}: AiChatWindowProps) {
  const [input, setInput] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chatMessages.length, chatMessages[chatMessages.length - 1]?.content]);

  /** 发送消息 */
  const handleSend = () => {
    if (!input.trim() || isLoading) return;
    onSendMessage(input.trim());
    setInput("");
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
    }
  };

  /** Enter 发送 */
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
            <p className="chat-header__subtitle">
              DeepSeek Chat · 支持网页浏览
            </p>
          </div>
        </div>
        <button
          onClick={onClearHistory}
          className="chat-toolbar__btn"
          title="清空对话"
        >
          <Trash2 size={18} />
        </button>
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
              <p className="chat-empty__desc">
                开始和 AI 对话吧！支持上下文连续对话。
                <br />
                发送网址可让 AI 自动浏览并获取网页内容。
              </p>
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
                      {msg.toolStatus ? (
                        <div style={{ display: "flex", alignItems: "center", gap: 8, color: "var(--color-text-secondary, #888)" }}>
                          <Globe size={14} className="ai-tool-spin" />
                          <span>{msg.toolStatus}</span>
                        </div>
                      ) : (
                        <>
                          <span className="ai-typing__dot" />
                          <span className="ai-typing__dot" />
                          <span className="ai-typing__dot" />
                        </>
                      )}
                    </div>
                  ) : msg.role === "assistant" ? (
                    <MarkdownRenderer content={msg.content} />
                  ) : (
                    <div className="message-text message-text--mine" style={{ whiteSpace: "pre-wrap" }}>
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

      {/* Tool Status Bar */}
      {toolStatus && (
        <div className="ai-tool-status">
          <Globe size={14} className="ai-tool-spin" />
          <span>{toolStatus}</span>
        </div>
      )}

      {/* Input */}
      <div className="chat-input-area">
        <div className="chat-input-box">
          <div className="chat-input-inner">
            <textarea
              ref={textareaRef}
              value={input}
              onChange={handleTextareaInput}
              onKeyDown={handleKeyDown}
              placeholder="输入消息，Enter 发送... 支持发送网址让 AI 浏览网页"
              className="chat-textarea"
            />
            <div className="chat-send-row">
              <button
                onClick={handleSend}
                disabled={!input.trim() || isLoading}
                className="chat-send-btn"
              >
                {isLoading ? (toolStatus ? "浏览中..." : "思考中...") : "发送"}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
