import { useCallback, useRef, useState } from "react";

/**
 * 持久化 localStorage 的 Hook
 *
 * 读取时自动从 localStorage 反序列化初始值；
 * 写入时同步更新 React 状态与 localStorage。
 *
 * @param key          - localStorage 键名
 * @param initialValue - 键不存在或解析失败时的默认值
 * @returns [当前值, 设置函数, 移除函数]
 */
export function useLocalStorage<T>(key: string, initialValue: T) {
    // 用 ref 捕获初始值，确保 removeValue 的引用始终稳定，
    // 不因调用方每次渲染传入新的引用（如 []）而重建 callback。
    const initialValueRef = useRef(initialValue);

    const [storedValue, setStoredValue] = useState<T>(() => {
        try {
            const item = localStorage.getItem(key);
            return item ? (JSON.parse(item) as T) : initialValue;
        } catch {
            // 解析失败时回退为默认值
            return initialValue;
        }
    });

    /**
     * 更新值：同时写入 React 状态和 localStorage。
     * 支持传入新值或 (prevValue) => newValue 形式的更新函数。
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
     * 移除值：从 localStorage 删除键，并将状态重置为初始值。
     * 使用 ref 中捕获的初始值，避免因外部引用变化触发不必要的重建。
     */
    const removeValue = useCallback(() => {
        try {
            localStorage.removeItem(key);
            setStoredValue(initialValueRef.current);
        } catch (e) {
            console.error("从 localStorage 移除失败:", e);
        }
    }, [key]); // 不再依赖 initialValue，改由 ref 访问

    return [storedValue, setValue, removeValue] as const;
}
