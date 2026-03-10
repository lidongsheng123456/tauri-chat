/**
 * format.ts — 共享格式化工具函数
 *
 * 纯函数，无副作用，可在项目任意位置安全引用。
 */

/**
 * 将字节数格式化为人类可读的文件大小字符串。
 *
 * @example
 *   formatFileSize(0)           // "0 B"
 *   formatFileSize(1536)        // "1.5 KB"
 *   formatFileSize(2097152)     // "2.0 MB"
 *   formatFileSize(1073741824)  // "1.0 GB"
 */
export function formatFileSize(bytes: number): string {
    if (bytes < 1024) return bytes + " B";
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
    if (bytes < 1024 * 1024 * 1024)
        return (bytes / (1024 * 1024)).toFixed(1) + " MB";
    return (bytes / (1024 * 1024 * 1024)).toFixed(1) + " GB";
}

/**
 * 将 catch 块捕获到的未知错误安全地转换为可读字符串。
 *
 * 处理三种最常见的错误形态：
 *  - 纯字符串  → 原样返回
 *  - Error 对象 → 返回 message 属性
 *  - 其他类型  → JSON.stringify，失败时返回 "未知错误"
 */
export function formatError(err: unknown): string {
    if (typeof err === "string") return err;
    if (err instanceof Error) return err.message;
    try {
        return JSON.stringify(err);
    } catch {
        return "未知错误";
    }
}
