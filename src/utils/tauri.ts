/**
 * tauri.ts — Tauri 后端调用统一封装
 *
 * 对 `@tauri-apps/api/core` 的 `invoke` 进行安全封装，
 * 统一处理调用失败的情况，避免在各组件与 Hook 中重复编写 try/catch。
 * 使用动态 import 加载 Tauri API，以兼容非 Tauri 环境（如浏览器预览模式）。
 */

/**
 * 安全调用 Tauri 后端命令，失败时静默返回 `null`。
 *
 * 调用失败时不会抛出异常，而是将原始错误对象传递给可选的 `onError` 回调，
 * 方便调用方在需要时进行错误提示或状态更新，同时保持调用点代码简洁。
 *
 * @template T 后端命令成功时返回值的类型。
 *
 * @param {string} cmd - 后端注册的 Tauri Command 名称，需与 Rust 端 `#[tauri::command]` 的函数名一致。
 * @param {Record<string, unknown>} [args] - 传递给后端命令的参数对象，键名须与 Rust 函数参数名（camelCase 转换后）对应。
 * @param {(err: unknown) => void} [onError] - 调用失败时执行的回调函数，接收原始错误对象；不传则静默忽略错误。
 *
 * @returns {Promise<T | null>} 后端命令的返回值；调用失败或后端返回 `Err` 时为 `null`。
 *
 * @example
 * // 基本用法：不关心错误详情
 * const ips = await tauriInvoke<NetworkInterface[]>("get_all_ips");
 * if (ips) { ... }
 *
 * @example
 * // 带错误处理：对应 Rust Command `chat_with_ai_stream`
 * await tauriInvoke(
 *   "chat_with_ai_stream",
 *   { messageId, messages },
 *   (err) => showError(formatError(err)),
 * );
 */
export async function tauriInvoke<T>(
    cmd: string,
    args?: Record<string, unknown>,
    onError?: (err: unknown) => void,
): Promise<T | null> {
    try {
        const { invoke } = await import("@tauri-apps/api/core");
        return await invoke<T>(cmd, args);
    } catch (err) {
        onError?.(err);
        return null;
    }
}
