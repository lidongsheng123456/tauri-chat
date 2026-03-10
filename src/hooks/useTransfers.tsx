import {
    createContext,
    useCallback,
    useContext,
    useEffect,
    useRef,
    useState,
    type ReactNode,
} from "react";

/** 单个传输任务（上传/下载） */
export interface TransferItem {
    id: string;
    type: "upload" | "download";
    fileName: string;
    status: "active" | "success" | "error";
    /** 传输开始时间戳 */
    startedAt: number;
}

/** 传输上下文值 */
interface TransferContextValue {
    transfers: TransferItem[];
    addTransfer: (
        id: string,
        type: "upload" | "download",
        fileName: string,
    ) => void;
    updateTransfer: (id: string, status: "success" | "error") => void;
    removeTransfer: (id: string) => void;
    hasActiveTransfers: boolean;
}

const TransferContext = createContext<TransferContextValue | null>(null);

/** 传输状态 Provider - 管理上传/下载任务列表 */
export function TransferProvider({ children }: { children: ReactNode }) {
    const [transfers, setTransfers] = useState<TransferItem[]>([]);
    const autoRemoveTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(
        new Map(),
    );

    /** 卸载时清理所有自动移除定时器 */
    useEffect(() => {
        // 将 ref 值捕获到局部变量，确保 cleanup 函数执行时访问的是同一个 Map 实例
        const timers = autoRemoveTimers.current;
        return () => {
            for (const timer of timers.values()) clearTimeout(timer);
            timers.clear();
        };
    }, []);

    /** 添加传输任务，相同 id 不重复添加 */
    const addTransfer = useCallback(
        (id: string, type: "upload" | "download", fileName: string) => {
            setTransfers((prev) => {
                if (prev.some((t) => t.id === id)) return prev;
                return [
                    ...prev,
                    {
                        id,
                        type,
                        fileName,
                        status: "active",
                        startedAt: Date.now(),
                    },
                ];
            });
        },
        [],
    );

    /** 移除传输任务，同时取消该任务的自动移除定时器 */
    const removeTransfer = useCallback((id: string) => {
        const timer = autoRemoveTimers.current.get(id);
        if (timer) {
            clearTimeout(timer);
            autoRemoveTimers.current.delete(id);
        }
        setTransfers((prev) => prev.filter((t) => t.id !== id));
    }, []);

    /** 更新传输状态，完成或失败后 3 秒自动移除 */
    const updateTransfer = useCallback(
        (id: string, status: "success" | "error") => {
            setTransfers((prev) =>
                prev.map((t) => (t.id === id ? { ...t, status } : t)),
            );
            // 取消旧定时器，重新计时，避免重复触发
            const prev = autoRemoveTimers.current.get(id);
            if (prev) clearTimeout(prev);
            const timer = setTimeout(() => removeTransfer(id), 3000);
            autoRemoveTimers.current.set(id, timer);
        },
        [removeTransfer],
    );

    const hasActiveTransfers = transfers.some((t) => t.status === "active");

    return (
        <TransferContext.Provider
            value={{
                transfers,
                addTransfer,
                updateTransfer,
                removeTransfer,
                hasActiveTransfers,
            }}
        >
            {children}
        </TransferContext.Provider>
    );
}

/**
 * 获取传输上下文，必须在 TransferProvider 内使用。
 *
 * 注：与 TransferProvider 同文件导出是标准 Context 模式；
 * eslint-disable 避免 react-refresh 对非组件导出的误报。
 */
// eslint-disable-next-line react-refresh/only-export-components
export function useTransfers(): TransferContextValue {
    const ctx = useContext(TransferContext);
    if (!ctx)
        throw new Error("useTransfers must be used within TransferProvider");
    return ctx;
}
