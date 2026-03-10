import { FileUp, Folder, Image as ImageIcon } from "lucide-react";
import { useCallback, useRef, useState } from "react";
import { useTransfers } from "../hooks/useTransfers";
import { autoResizeTextarea } from "../utils/dom";

/** 聊天输入区域 Props */
interface ChatInputProps {
    onSendMessage: (content: string) => void;
    onUploadFile: (file: File) => void;
    onShowToast: (type: "success" | "error", message: string) => void;
    isDragOver: boolean;
}

/** 聊天输入区域 - 文本输入、文件/图片上传工具栏 */
export function ChatInput({
    onSendMessage,
    onUploadFile,
    onShowToast,
    isDragOver,
}: ChatInputProps) {
    const [input, setInput] = useState("");
    const { addTransfer, updateTransfer, hasActiveTransfers } = useTransfers();
    const fileInputRef = useRef<HTMLInputElement>(null);
    const imageInputRef = useRef<HTMLInputElement>(null);
    const textareaRef = useRef<HTMLTextAreaElement>(null);

    /** 发送当前输入内容，发送后清空输入框并重置高度 */
    const handleSend = useCallback(() => {
        if (!input.trim()) return;
        onSendMessage(input.trim());
        setInput("");
        if (textareaRef.current) {
            textareaRef.current.style.height = "auto";
        }
    }, [input, onSendMessage]);

    /** Enter 发送，Shift+Enter 换行 */
    const handleKeyDown = useCallback(
        (e: React.KeyboardEvent) => {
            if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                handleSend();
            }
        },
        [handleSend],
    );

    /** 输入时自动扩展 textarea 高度（最高 120px） */
    const handleTextareaInput = useCallback(
        (e: React.ChangeEvent<HTMLTextAreaElement>) => {
            setInput(e.target.value);
            autoResizeTextarea(e.target);
        },
        [],
    );

    /** 处理文件选择上传（toolbar 按钮触发） */
    const handleFileChange = useCallback(
        async (e: React.ChangeEvent<HTMLInputElement>) => {
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
            // 重置 input 值，允许重复选择同一文件
            e.target.value = "";
        },
        [onUploadFile, onShowToast, addTransfer, updateTransfer],
    );

    return (
        <>
            {/* 拖拽释放遮罩层 */}
            {isDragOver && (
                <div className="chat-drag-overlay animate-scale-in">
                    <div className="chat-drag-overlay__icon">
                        <FileUp size={32} />
                    </div>
                    <div className="chat-drag-overlay__title">
                        释放以上传文件
                    </div>
                    <div className="chat-drag-overlay__desc">
                        支持图片、视频和各类文件
                    </div>
                </div>
            )}

            {/* 文件传输进行中提示条 */}
            {hasActiveTransfers && (
                <div className="chat-upload-indicator animate-slide-up">
                    <div className="chat-upload-spinner animate-spin" />
                    <span className="chat-upload-text">文件传输中...</span>
                </div>
            )}

            {/* 输入区域 */}
            <div className="chat-input-area">
                <div className="chat-input-box">
                    {/* 工具栏：图片/视频 & 文件选择按钮 */}
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

                {/* 隐藏的文件选择 input：图片/视频 */}
                <input
                    ref={imageInputRef}
                    type="file"
                    accept="image/*,video/*"
                    multiple
                    onChange={handleFileChange}
                    className="hidden"
                />
                {/* 隐藏的文件选择 input：任意类型 */}
                <input
                    ref={fileInputRef}
                    type="file"
                    multiple
                    onChange={handleFileChange}
                    className="hidden"
                />
            </div>
        </>
    );
}
