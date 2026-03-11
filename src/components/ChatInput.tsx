import { FileUp, Folder, Image as ImageIcon } from "lucide-react";
import { useCallback, useRef, useState } from "react";
import { useTransfers } from "../hooks/useTransfers";
import { autoResizeTextarea } from "../utils/dom";

/**
 * `ChatInput` 组件的 Props。
 */
interface ChatInputProps {
    /**
     * 发送文本消息的回调。
     *
     * @param {string} content - 已去除首尾空格的消息文本内容。
     */
    onSendMessage: (content: string) => void;
    /**
     * 上传文件的回调，由父组件负责实际的 HTTP 上传逻辑。
     *
     * @param {File} file - 用户选择或拖拽的文件对象。
     */
    onUploadFile: (file: File) => void;
    /**
     * 显示操作结果 Toast 提示的回调。
     *
     * @param {"success" | "error"} type    - 提示类型，决定图标与样式。
     * @param {string}              message - 提示文本内容。
     */
    onShowToast: (type: "success" | "error", message: string) => void;
    /** 当前是否有文件正在被拖拽悬停于聊天窗口上方，为 `true` 时渲染拖拽释放遮罩层。 */
    isDragOver: boolean;
}

/**
 * 聊天输入区域组件，提供文本输入、图片/视频上传与任意文件上传功能。
 *
 * 功能说明：
 * - 文本域支持自动高度扩展（最高 120px），超出后出现滚动条。
 * - 按 `Enter` 发送消息，按 `Shift+Enter` 换行，不触发发送。
 * - 工具栏提供两个隐藏的 `<input type="file">` 触发按钮：
 *   一个仅接受图片/视频，另一个接受任意类型文件。
 * - 文件上传通过 `useTransfers` 上下文追踪传输状态，
 *   传输进行中时在输入框上方展示进度提示条。
 * - 拖拽悬停时在输入区域上方渲染全屏覆盖的释放提示遮罩层。
 *
 * @param {ChatInputProps} props - 组件 Props，详见 `ChatInputProps` 接口定义。
 */
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

    /**
     * 发送当前输入框中的文本内容，发送成功后清空输入框并重置 textarea 高度。
     *
     * 若输入内容为空或仅含空白字符，调用将被静默忽略。
     */
    const handleSend = useCallback(() => {
        if (!input.trim()) return;
        onSendMessage(input.trim());
        setInput("");
        if (textareaRef.current) {
            textareaRef.current.style.height = "auto";
        }
    }, [input, onSendMessage]);

    /**
     * 键盘事件处理：`Enter` 键触发发送，`Shift+Enter` 键插入换行。
     *
     * @param {React.KeyboardEvent} e - 键盘事件对象。
     */
    const handleKeyDown = useCallback(
        (e: React.KeyboardEvent) => {
            if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                handleSend();
            }
        },
        [handleSend],
    );

    /**
     * 文本域 `onChange` 处理：同步更新输入状态并自动扩展 textarea 高度（最高 120px）。
     *
     * @param {React.ChangeEvent<HTMLTextAreaElement>} e - textarea 变更事件对象。
     */
    const handleTextareaInput = useCallback(
        (e: React.ChangeEvent<HTMLTextAreaElement>) => {
            setInput(e.target.value);
            autoResizeTextarea(e.target);
        },
        [],
    );

    /**
     * 处理通过工具栏按钮触发的文件选择上传。
     *
     * 支持多文件同时选择，每个文件独立追踪传输状态：
     * 1. 调用 `addTransfer` 注册传输任务（显示进度条）。
     * 2. 调用 `onUploadFile` 执行实际上传。
     * 3. 上传成功后调用 `updateTransfer(id, "success")`，失败后调用 `updateTransfer(id, "error")` 并显示 Toast 提示。
     * 4. 重置 `<input>` 的 `value`，允许用户重复选择同一文件。
     *
     * @param {React.ChangeEvent<HTMLInputElement>} e - 文件选择 input 的 change 事件对象。
     */
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
            {/* 拖拽释放遮罩层：文件拖拽悬停于窗口上方时显示 */}
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

            {/* 文件传输进行中提示条：有活跃传输任务时显示在输入框上方 */}
            {hasActiveTransfers && (
                <div className="chat-upload-indicator animate-slide-up">
                    <div className="chat-upload-spinner animate-spin" />
                    <span className="chat-upload-text">文件传输中...</span>
                </div>
            )}

            {/* 输入区域主体 */}
            <div className="chat-input-area">
                <div className="chat-input-box">
                    {/* 工具栏：图片/视频 & 任意文件选择按钮 */}
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

                {/* 隐藏的文件选择 input：仅接受图片与视频 */}
                <input
                    ref={imageInputRef}
                    type="file"
                    accept="image/*,video/*"
                    multiple
                    onChange={handleFileChange}
                    className="hidden"
                />
                {/* 隐藏的文件选择 input：接受任意类型文件 */}
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
