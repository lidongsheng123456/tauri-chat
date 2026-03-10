/**
 * 文件图标工具函数
 *
 * 将文件扩展名映射到 FileCard 内置图标类型字符串。
 * 同时被 AiChatWindow（工具文件卡片）和 MessageBubble（聊天文件消息）引用，
 * 是整个项目的唯一来源（single source of truth）。
 */

/** 扩展名 → FileCard 图标类型映射表 */
const EXT_MAP: Record<string, string> = {
    // 电子表格
    xlsx: "excel",
    xls: "excel",
    // 文字处理
    docx: "word",
    doc: "word",
    // PDF 文档
    pdf: "pdf",
    // 演示文稿
    pptx: "ppt",
    ppt: "ppt",
    // 压缩包
    zip: "zip",
    gz: "zip",
    tar: "zip",
    rar: "zip",
    "7z": "zip",
    // Markdown
    md: "markdown",
    markdown: "markdown",
    // 图片
    jpg: "image",
    jpeg: "image",
    png: "image",
    gif: "image",
    webp: "image",
    svg: "image",
    // 音频
    mp3: "audio",
    wav: "audio",
    ogg: "audio",
    flac: "audio",
    aac: "audio",
    // 视频
    mp4: "video",
    avi: "video",
    mov: "video",
    mkv: "video",
    webm: "video",
    // 代码
    java: "java",
    js: "javascript",
    mjs: "javascript",
    cjs: "javascript",
    ts: "javascript",
    jsx: "javascript",
    tsx: "javascript",
    py: "python",
};

/**
 * 根据文件名返回 FileCard 内置图标类型。
 * 未知扩展名时回退为 `"default"`。
 *
 * @param name - 完整文件名或路径（仅检查扩展名部分）
 */
export function getFileIconType(name: string): string {
    const ext = name.split(".").pop()?.toLowerCase() ?? "";
    return EXT_MAP[ext] ?? "default";
}
