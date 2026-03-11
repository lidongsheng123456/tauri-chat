import { useCallback, useRef, useState } from "react";

/**
 * useLocalStorage.ts — localStorage 持久化 Hook
 *
 * 对浏览器 `localStorage` 的 React 封装，提供与 `useState` 相同的 API，
 * 同时在每次写入时自动同步到 `localStorage`，实现跨页面刷新的状态持久化。
 *
 * 特性说明：
 * - 初始化时从 `localStorage` 反序列化初始值，键不存在或解析失败时使用 `initialValue`。
 * - `setValue` 支持传入新值或 `(prev) => newValue` 形式的更新函数，与 `useState` 用法完全一致。
 * - `removeValue` 删除键并将状态重置为初始值，通过 `useRef` 捕获初始值，
 *   确保 callback 引用在组件生命周期内保持稳定，不受调用方每次渲染传入新引用的影响。
 * - 写入/删除失败时（如隐私模式下 `localStorage` 被禁用）打印错误并静默降级，
 *   不向上抛出异常，确保应用正常运行。
 */

/**
 * 管理 `localStorage` 持久化键值对的 React Hook。
 *
 * 读取时自动从 `localStorage` 反序列化初始值；
 * 写入时同步更新 React 状态与 `localStorage`，
 * 确保 UI 状态与本地存储始终保持一致。
 *
 * @template T 存储值的类型，需要能被 `JSON.stringify` / `JSON.parse` 正确处理。
 *
 * @param {string} key - `localStorage` 的键名，建议使用具名常量避免拼写错误。
 * @param {T} initialValue - 键不存在或反序列化失败时使用的默认值。
 *
 * @returns {readonly [T, (value: T | ((prev: T) => T)) => void, () => void]}
 *   一个三元素只读元组：
 *   - `[0]` `storedValue` — 当前存储的值，类型为 `T`。
 *   - `[1]` `setValue` — 更新函数，接受新值或 `(prev) => newValue` 形式的更新函数。
 *   - `[2]` `removeValue` — 删除函数，从 `localStorage` 中移除该键并将状态重置为初始值。
 *
 * @example
 * // 基本用法
 * const [theme, setTheme, removeTheme] = useLocalStorage("app_theme", "light");
 *
 * @example
 * // 函数式更新
 * const [count, setCount] = useLocalStorage("visit_count", 0);
 * setCount((prev) => prev + 1);
 */
export function useLocalStorage<T>(key: string, initialValue: T) {
    /**
     * 用 ref 捕获初始值，确保 `removeValue` 的引用始终稳定，
     * 不因调用方每次渲染传入新的引用（如字面量 `[]` 或 `{}`）而重建 callback。
     */
    const initialValueRef = useRef(initialValue);

    const [storedValue, setStoredValue] = useState<T>(() => {
        try {
            const item = localStorage.getItem(key);
            return item ? (JSON.parse(item) as T) : initialValue;
        } catch {
            // localStorage 被禁用（隐私模式）或 JSON 解析失败时，回退为默认值
            return initialValue;
        }
    });

    /**
     * 同时更新 React 状态和 `localStorage`，支持函数式更新形式。
     *
     * 使用 `setStoredValue` 的函数式更新形式，确保并发更新时基于最新状态计算新值，
     * 避免过时闭包导致的状态丢失。
     *
     * @param {T | ((prev: T) => T)} value - 新值，或接收当前值并返回新值的纯函数。
     */
    const setValue = useCallback(
        (value: T | ((prev: T) => T)) => {
            setStoredValue((prev) => {
                const newValue =
                    value instanceof Function ? value(prev) : value;
                try {
                    localStorage.setItem(key, JSON.stringify(newValue));
                } catch (e) {
                    console.error("写入 localStorage 失败:", e);
                }
                return newValue;
            });
        },
        [key],
    );

    /**
     * 从 `localStorage` 中移除该键，并将 React 状态重置为初始值。
     *
     * 通过 `initialValueRef` 访问初始值，而非将 `initialValue` 加入依赖数组，
     * 避免调用方每次渲染传入新引用时触发不必要的 callback 重建。
     *
     * @throws 不会抛出异常；若 `localStorage.removeItem` 失败，仅打印错误日志。
     */
    const removeValue = useCallback(() => {
        try {
            localStorage.removeItem(key);
            setStoredValue(initialValueRef.current);
        } catch (e) {
            console.error("从 localStorage 移除失败:", e);
        }
    }, [key]);

    return [storedValue, setValue, removeValue] as const;
}
