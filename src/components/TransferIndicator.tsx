import {
    ArrowDownToLine,
    ArrowUpFromLine,
    CheckCircle2,
    X,
    XCircle,
} from "lucide-react";
import { useTransfers } from "../hooks/useTransfers";

/**
 * `TransferIndicator` 组件 — 悬浮于界面右下角的文件传输任务状态指示器。
 *
 * 功能说明：
 * - 从 `useTransfers` 上下文中读取当前所有传输任务（上传/下载）。
 * - 每个任务显示一张卡片，包含：传输方向图标、文件名与状态图标。
 * - 任务状态分三种：
 *   - `active`  — 显示旋转加载动画，表示传输进行中。
 *   - `success` — 显示绿色勾选图标，表示传输完成。
 *   - `error`   — 显示红色错误图标，表示传输失败。
 * - 完成或失败的任务右上角出现关闭按钮，点击可手动移除；
 *   进行中的任务不显示关闭按钮，防止误操作。
 * - 无任务时组件返回 `null`，不占用任何布局空间。
 *
 * 该组件须在 `TransferProvider` 内部使用，否则 `useTransfers` 会抛出错误。
 */
export function TransferIndicator() {
    const { transfers, removeTransfer } = useTransfers();

    if (transfers.length === 0) return null;

    return (
        <div className="transfer-indicator">
            {transfers.map((t) => (
                <div
                    key={t.id}
                    className={`transfer-item transfer-item--${t.status} animate-slide-up`}
                >
                    {/* 状态图标区域：进行中显示旋转动画，完成显示勾，失败显示叉 */}
                    <div className="transfer-item__icon">
                        {t.status === "active" ? (
                            <div className="transfer-spinner animate-spin" />
                        ) : t.status === "success" ? (
                            <CheckCircle2 size={16} />
                        ) : (
                            <XCircle size={16} />
                        )}
                    </div>

                    {/* 任务信息区域：传输方向标签（上传/下载）与文件名 */}
                    <div className="transfer-item__body">
                        <div className="transfer-item__label">
                            {t.type === "upload" ? (
                                <ArrowUpFromLine size={12} />
                            ) : (
                                <ArrowDownToLine size={12} />
                            )}
                            <span>{t.type === "upload" ? "上传" : "下载"}</span>
                        </div>
                        {/* 文件名超出宽度时以 title 属性显示完整路径 */}
                        <div className="transfer-item__name" title={t.fileName}>
                            {t.fileName}
                        </div>
                    </div>

                    {/* 关闭按钮：仅在任务完成或失败后显示，允许用户手动清除卡片 */}
                    {t.status !== "active" && (
                        <button
                            className="transfer-item__close"
                            onClick={() => removeTransfer(t.id)}
                        >
                            <X size={14} />
                        </button>
                    )}
                </div>
            ))}
        </div>
    );
}
