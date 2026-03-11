/**
 * tauri.ts — Tauri 后端调用工具函数
 *
 * 对 @tauri-apps/api/core 的 invoke 进行安全封装，
 * 统一处理调用失败的情况，避免在各组件中重复编写 try/catch。
 */

/**
 * 安全调用 Tauri 后端命令。
 *
 * 使用动态 import 加载 Tauri API，以兼容非 Tauri 环境（如浏览器预览）。
 * 调用失败时静默返回 null，若传入 onError 回调则同时将错误对象传递给调用方。
 *
 * @param cmd     - 后端注册的命令名称
 * @param args    - 传递给后端命令的参数对象（可选）
 * @param onError - 调用失败时执行的回调，接收原始错误对象（可选）
 * @returns       后端返回值，失败时返回 null
 *
 * @example 基本用法（不关心错误详情）
 *   const ips = await tauriInvoke<NetworkInterface[]>("get_all_ips");
 *   if (ips) { ... }
 *
 * @example 带错误处理
 *   await tauriInvoke(
 *     "chat_with_ai_stream",
 *     { messageId, messages },
 *     (err) => showError(formatError(err)),
 *   );
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
