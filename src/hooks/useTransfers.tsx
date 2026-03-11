import {
    createContext,
    useCallback,
    useContext,
    useEffect,
    useRef,
    useState,
    type ReactNode,
} from "react";

/**
 * useTransfers.tsx — 文件传输任务状态管理
 *
 * 通过 React Context 在组件树中共享上传/下载任务的实时状态，
 * 使 `ChatInput`（触发上传）、`MessageBubble`（触发下载）与
 * `TransferIndicator`（展示进度）三个独立组件能够访问同一份传输任务列表，
 * 无需通过 props 逐层传递。
 *
 * 使用方式：
 * 1. 在应用顶层（`App.tsx`）用 `TransferProvider` 包裹需要共享状态的子树。
 * 2. 在任意子组件中调用 `useTransfers()` Hook 获取任务列表与操作方法。
 */

/**
 * 单个文件传输任务的数据结构，代表一次上传或下载操作的完整状态快照。
 */
export interface TransferItem {
    /**
     * 传输任务的全局唯一标识符。
     *
     * 由调用方（`ChatInput` 或 `MessageBubble`）在发起传输前生成，
     * 格式约定为 `upload_<timestamp>_<filename>` 或 `download_<messageId>`。
     */
    id: string;
    /** 传输方向：`"upload"` 表示上传，`"download"` 表示下载。 */
    type: "upload" | "download";
    /** 传输文件的原始文件名，用于在 `TransferIndicator` 卡片中展示。 */
    fileName: string;
    /**
     * 传输任务的当前状态：
     * - `"active"`  — 传输进行中，显示旋转动画。
     * - `"success"` — 传输成功，显示绿色勾选图标，3 秒后自动移除。
     * - `"error"`   — 传输失败，显示红色错误图标，3 秒后自动移除。
     */
    status: "active" | "success" | "error";
    /** 传输任务开始时的 Unix 时间戳（毫秒），由 `addTransfer` 写入。 */
    startedAt: number;
}

/**
 * `TransferContext` 上下文值的类型，由 `TransferProvider` 提供，
 * 通过 `useTransfers()` Hook 消费。
 */
interface TransferContextValue {
    /** 当前所有传输任务的列表，包含进行中、已完成与失败的任务。 */
    transfers: TransferItem[];
    /**
     * 添加一个新的传输任务，状态初始为 `"active"`。
     *
     * 若相同 `id` 的任务已存在，调用将被静默忽略（幂等操作），防止重复注册。
     *
     * @param {string} id       - 任务的唯一标识符，由调用方生成。
     * @param {"upload" | "download"} type - 传输方向。
     * @param {string} fileName - 传输文件的原始文件名。
     */
    addTransfer: (
        id: string,
        type: "upload" | "download",
        fileName: string,
    ) => void;
    /**
     * 将指定任务的状态更新为成功或失败，并在 3 秒后自动从列表中移除该任务。
     *
     * 若在 3 秒内再次调用（极少见），会取消旧定时器并重新计时，防止重复触发。
     *
     * @param {string} id                    - 需要更新的任务唯一标识符。
     * @param {"success" | "error"} status   - 新的终态状态。
     */
    updateTransfer: (id: string, status: "success" | "error") => void;
    /**
     * 立即从列表中移除指定任务，同时取消其自动移除定时器。
     *
     * 通常由 `TransferIndicator` 中的手动关闭按钮调用；
     * 也被 `updateTransfer` 内部的自动移除定时器在延迟后调用。
     *
     * @param {string} id - 需要移除的任务唯一标识符。
     */
    removeTransfer: (id: string) => void;
    /**
     * 当前是否存在状态为 `"active"` 的传输任务。
     *
     * 由 `ChatInput` 用于在输入框上方显示「文件传输中…」提示条；
     * 派生自 `transfers` 列表，无需单独维护。
     */
    hasActiveTransfers: boolean;
}

const TransferContext = createContext<TransferContextValue | null>(null);

/**
 * 文件传输状态的全局 Provider 组件，管理上传/下载任务的完整生命周期。
 *
 * 需要在应用根节点附近挂载（本项目在 `App.tsx` 的已登录分支中），
 * 其所有后代组件均可通过 `useTransfers()` Hook 访问传输状态与操作方法。
 *
 * 内部通过 `useRef` 维护一个 `Map<id, timer>` 来管理各任务的自动移除定时器，
 * 组件卸载时统一清理所有定时器，防止在已卸载组件上触发 `setState`。
 *
 * @param {{ children: ReactNode }} props - 标准 React children prop。
 */
export function TransferProvider({ children }: { children: ReactNode }) {
    const [transfers, setTransfers] = useState<TransferItem[]>([]);
    /**
     * 各任务的自动移除定时器 Map，key 为任务 ID，value 为 `setTimeout` 返回的句柄。
     * 使用 `useRef` 存储，确保 Map 实例在组件生命周期内保持引用稳定。
     */
    const autoRemoveTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(
        new Map(),
    );

    /**
     * 组件卸载时统一清理所有待执行的自动移除定时器。
     *
     * 捕获 `autoRemoveTimers.current` 到局部变量，确保 cleanup 函数执行时
     * 访问的是同一个 Map 实例（React 严格模式下 effect 可能重新执行）。
     */
    useEffect(() => {
        const timers = autoRemoveTimers.current;
        return () => {
            for (const timer of timers.values()) clearTimeout(timer);
            timers.clear();
        };
    }, []);

    /**
     * 添加一个状态为 `"active"` 的新传输任务。
     *
     * 通过 `prev.some((t) => t.id === id)` 进行去重，
     * 相同 id 已存在时直接返回原数组（引用不变，不触发重渲染）。
     *
     * @param {string} id       - 任务唯一标识符，由调用方在发起传输前生成。
     * @param {"upload" | "download"} type - 传输方向。
     * @param {string} fileName - 传输文件的原始文件名，用于卡片展示。
     */
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

    /**
     * 立即从任务列表中移除指定任务，并取消其自动移除定时器。
     *
     * 同时从 `autoRemoveTimers` Map 中删除对应条目，
     * 防止定时器回调在任务已被手动移除后再次触发 `setTransfers`。
     *
     * @param {string} id - 需要移除的任务唯一标识符。
     */
    const removeTransfer = useCallback((id: string) => {
        const timer = autoRemoveTimers.current.get(id);
        if (timer) {
            clearTimeout(timer);
            autoRemoveTimers.current.delete(id);
        }
        setTransfers((prev) => prev.filter((t) => t.id !== id));
    }, []);

    /**
     * 将指定任务的状态更新为终态（`"success"` 或 `"error"`），
     * 并注册一个 3 秒后自动移除该任务的定时器。
     *
     * 若在 3 秒内再次调用（例如重试逻辑触发），会先取消旧定时器再重新注册，
     * 避免因多个定时器并发执行导致重复移除的问题。
     *
     * @param {string} id                  - 需要更新的任务唯一标识符。
     * @param {"success" | "error"} status - 传输完成的终态，决定卡片图标与颜色。
     */
    const updateTransfer = useCallback(
        (id: string, status: "success" | "error") => {
            setTransfers((prev) =>
                prev.map((t) => (t.id === id ? { ...t, status } : t)),
            );
            // 取消旧定时器，重新计时，避免并发调用时触发多次移除
            const prev = autoRemoveTimers.current.get(id);
            if (prev) clearTimeout(prev);
            const timer = setTimeout(() => removeTransfer(id), 3000);
            autoRemoveTimers.current.set(id, timer);
        },
        [removeTransfer],
    );

    /** 是否存在进行中的传输任务，由 `ChatInput` 用于显示传输进度提示条。 */
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
 * 获取文件传输上下文，消费由 `TransferProvider` 提供的传输任务状态与操作方法。
 *
 * 该 Hook **必须**在 `TransferProvider` 的后代组件中调用，
 * 否则会抛出明确的错误提示，帮助开发者快速定位错误。
 *
 * 与 `TransferProvider` 同文件导出是标准 Context 模式，
 * eslint-disable 注释用于避免 `react-refresh` 插件对非组件导出的误报。
 *
 * @returns {TransferContextValue} 包含传输任务列表与 `addTransfer`、`updateTransfer`、
 *   `removeTransfer`、`hasActiveTransfers` 的上下文值对象。
 *
 * @throws {Error} 若在 `TransferProvider` 外部调用，抛出
 *   `"useTransfers must be used within TransferProvider"` 错误。
 */
// eslint-disable-next-line react-refresh/only-export-components
export function useTransfers(): TransferContextValue {
    const ctx = useContext(TransferContext);
    if (!ctx)
        throw new Error("useTransfers must be used within TransferProvider");
    return ctx;
}
