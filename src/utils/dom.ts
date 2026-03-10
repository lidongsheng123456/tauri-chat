/**
 * dom.ts — DOM 操作工具函数
 *
 * 纯函数，无副作用，无 React 依赖，可在项目任意位置安全引用。
 */

/**
 * 自动调整 textarea 高度以适应内容，超过 maxHeight 时停止增长并出现滚动条。
 *
 * 使用方式：在 onChange 回调中调用，传入事件目标元素即可。
 *
 * @param el        - 需要调整高度的 textarea 元素
 * @param maxHeight - 最大高度限制（像素），默认 120
 *
 * @example
 *   const handleInput = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
 *     setValue(e.target.value);
 *     autoResizeTextarea(e.target);
 *   };
 */
export function autoResizeTextarea(
    el: HTMLTextAreaElement,
    maxHeight = 120,
): void {
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, maxHeight)}px`;
}
