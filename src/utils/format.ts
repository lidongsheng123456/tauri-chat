/**
 * format.ts — 共享格式化工具函数
 *
 * 纯函数，无副作用，可在项目任意位置安全引用。
 */

/**
 * 将字节数格式化为人类可读的文件大小字符串。
 *
 * 使用 1024 进制换算，依次尝试 B、KB、MB、GB 四个量级，
 * 选取最合适的单位并保留 1 位小数（B 单位除外）。
 *
 * @param {number} bytes - 需要格式化的文件字节数，应为非负整数。
 *
 * @returns {string} 格式化后的文件大小字符串，例如 `"0 B"`、`"1.5 KB"`、`"2.0 MB"`、`"1.0 GB"`。
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
 * 将 `catch` 块捕获到的未知错误安全地转换为可读字符串。
 *
 * 处理三种最常见的错误形态：
 * - 纯字符串  → 原样返回。
 * - `Error` 对象 → 返回 `message` 属性。
 * - 其他任意类型（对象、数字等）→ 尝试 `JSON.stringify`，失败时返回 `"未知错误"`。
 *
 * 设计目标：在 `catch (err: unknown)` 场景下替代手动类型守卫，
 * 保证调用方始终能得到一个非空字符串，便于展示在 Toast 或错误提示中。
 *
 * @param {unknown} err - `catch` 块捕获到的任意类型错误值。
 *
 * @returns {string} 错误的可读描述字符串；永远不会返回空字符串。
 *
 * @example
 *   formatError("网络超时")            // "网络超时"
 *   formatError(new Error("解析失败"))  // "解析失败"
 *   formatError({ code: 404 })         // '{"code":404}'
 *   formatError(undefined)             // "未知错误"（JSON.stringify(undefined) 抛出后的回退值）
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
