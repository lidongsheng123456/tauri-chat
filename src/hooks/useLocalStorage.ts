import { useCallback, useState } from "react";

/**
 * 持久化 localStorage 的 Hook
 *
 * @returns [值, 设置函数, 移除函数]
 */
export function useLocalStorage<T>(key: string, initialValue: T) {
  const [storedValue, setStoredValue] = useState<T>(() => {
    try {
      const item = localStorage.getItem(key);
      return item ? (JSON.parse(item) as T) : initialValue;
    } catch {
      return initialValue;
    }
  });

  const setValue = useCallback(
    (value: T | ((prev: T) => T)) => {
      setStoredValue((prev) => {
        const newValue = value instanceof Function ? value(prev) : value;
        try {
          localStorage.setItem(key, JSON.stringify(newValue));
        } catch (e) {
          console.error("Failed to save to localStorage:", e);
        }
        return newValue;
      });
    },
    [key]
  );

  const removeValue = useCallback(() => {
    try {
      localStorage.removeItem(key);
      setStoredValue(initialValue);
    } catch (e) {
      console.error("Failed to remove from localStorage:", e);
    }
  }, [key, initialValue]);

  return [storedValue, setValue, removeValue] as const;
}
