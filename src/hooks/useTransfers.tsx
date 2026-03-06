import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from "react";

/** 单个传输任务（上传/下载） */
export interface TransferItem {
  id: string;
  type: "upload" | "download";
  fileName: string;
  status: "active" | "success" | "error";
  /** timestamp when transfer started */
  startedAt: number;
}

/** 传输上下文值 */
interface TransferContextValue {
  transfers: TransferItem[];
  addTransfer: (id: string, type: "upload" | "download", fileName: string) => void;
  updateTransfer: (id: string, status: "success" | "error") => void;
  removeTransfer: (id: string) => void;
  hasActiveTransfers: boolean;
}

const TransferContext = createContext<TransferContextValue | null>(null);

/** 传输状态 Provider - 管理上传/下载任务列表 */
export function TransferProvider({ children }: { children: ReactNode }) {
  const [transfers, setTransfers] = useState<TransferItem[]>([]);
  const autoRemoveTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  /** 添加传输任务 */
  const addTransfer = useCallback((id: string, type: "upload" | "download", fileName: string) => {
    setTransfers((prev) => {
      if (prev.some((t) => t.id === id)) return prev;
      return [...prev, { id, type, fileName, status: "active", startedAt: Date.now() }];
    });
  }, []);

  /** 移除传输任务 */
  const removeTransfer = useCallback((id: string) => {
    const timer = autoRemoveTimers.current.get(id);
    if (timer) {
      clearTimeout(timer);
      autoRemoveTimers.current.delete(id);
    }
    setTransfers((prev) => prev.filter((t) => t.id !== id));
  }, []);

  /** 更新传输状态，完成后 3 秒自动移除 */
  const updateTransfer = useCallback((id: string, status: "success" | "error") => {
    setTransfers((prev) =>
      prev.map((t) => (t.id === id ? { ...t, status } : t))
    );
    // Auto-remove completed transfers after 3s
    const timer = setTimeout(() => {
      removeTransfer(id);
    }, 3000);
    autoRemoveTimers.current.set(id, timer);
  }, [removeTransfer]);

  const hasActiveTransfers = transfers.some((t) => t.status === "active");

  return (
    <TransferContext.Provider value={{ transfers, addTransfer, updateTransfer, removeTransfer, hasActiveTransfers }}>
      {children}
    </TransferContext.Provider>
  );
}

/** 获取传输上下文，必须在 TransferProvider 内使用 */
export function useTransfers() {
  const ctx = useContext(TransferContext);
  if (!ctx) throw new Error("useTransfers must be used within TransferProvider");
  return ctx;
}
