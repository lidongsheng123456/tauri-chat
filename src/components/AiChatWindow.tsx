import { Bot, Globe, Trash2, Wrench } from "lucide-react";
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

function formatUnknown(value: unknown): string {
  if (typeof value === "string") return value;

  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

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
    el.style.height = `${Math.min(el.scrollHeight, 120)}px`;
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
            <p className="chat-header__subtitle">DeepSeek Chat · 搜索 · 网页 · 工具</p>
          </div>
        </div>
        <button onClick={onClearHistory} className="chat-toolbar__btn" title="清空对话">
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
                开始和 AI 对话吧，支持上下文连续对话。
                <br />
                也支持搜索互联网、浏览网页、提取图片、查时间、编解码、IP 查询等。
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
                {msg.role === "assistant" && <div className="message-sender">AI 助手</div>}
                <div className={`message-bubble ${msg.role === "user" ? "message-bubble--mine" : "message-bubble--other"}`}>
                  {msg.loading ? (
                    <div className="ai-typing">
                      {msg.toolStatus ? (
                        <div
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 8,
                            color: "var(--color-text-secondary, #888)",
                          }}
                        >
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
                    <>
                      {msg.toolRounds && msg.toolRounds.length > 0 && (
                        <div className="ai-trace">
                          <div className="ai-trace__title">工具调用过程（最多 10 轮）</div>
                          {msg.toolRounds.map((round) => (
                            <div key={`${msg.id}-round-${round.round}`} className="ai-trace-round">
                              <div className="ai-trace-round__index">第 {round.round} 轮思考</div>
                              {round.thinking && <div className="ai-trace-round__thinking">{round.thinking}</div>}

                              {round.tool_calls.map((tool) => (
                                <details
                                  key={`${msg.id}-${round.round}-${tool.tool_call_id}`}
                                  className="ai-trace-tool"
                                  open
                                >
                                  <summary className="ai-trace-tool__summary">
                                    <Wrench size={12} />
                                    <span>{tool.tool_name}</span>
                                  </summary>
                                  <div className="ai-trace-tool__body">
                                    <div className="ai-trace-tool__label">参数</div>
                                    <pre className="ai-trace-tool__block">{formatUnknown(tool.arguments)}</pre>
                                    <div className="ai-trace-tool__label">结果</div>
                                    <pre className="ai-trace-tool__block">{tool.result}</pre>
                                  </div>
                                </details>
                              ))}
                            </div>
                          ))}
                          <div className="ai-trace__summary">最终总结</div>
                        </div>
                      )}
                      <MarkdownRenderer content={msg.content} />
                    </>
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
              placeholder="输入消息，Enter 发送。支持搜索、网页浏览、文件工具调用。"
              className="chat-textarea"
            />
            <div className="chat-send-row">
              <button onClick={handleSend} disabled={!input.trim() || isLoading} className="chat-send-btn">
                {isLoading ? (toolStatus ? "执行工具中..." : "思考中...") : "发送"}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
