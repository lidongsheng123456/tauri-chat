import { ArrowDownToLine, ArrowUpFromLine, CheckCircle2, X, XCircle } from "lucide-react";
import { useTransfers } from "../hooks/useTransfers";

/** 传输任务指示器 - 显示上传/下载进度与状态 */
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
          <div className="transfer-item__icon">
            {t.status === "active" ? (
              <div className="transfer-spinner animate-spin" />
            ) : t.status === "success" ? (
              <CheckCircle2 size={16} />
            ) : (
              <XCircle size={16} />
            )}
          </div>
          <div className="transfer-item__body">
            <div className="transfer-item__label">
              {t.type === "upload" ? (
                <ArrowUpFromLine size={12} />
              ) : (
                <ArrowDownToLine size={12} />
              )}
              <span>{t.type === "upload" ? "上传" : "下载"}</span>
            </div>
            <div className="transfer-item__name" title={t.fileName}>
              {t.fileName}
            </div>
          </div>
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
