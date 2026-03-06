import { RotateCw, X, ZoomIn, ZoomOut } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

/** 图片预览 Props */
interface ImagePreviewProps {
  src: string;
  alt: string;
  onClose: () => void;
}

/** 图片全屏预览 - 缩放、旋转、拖拽、Esc 关闭 */
export function ImagePreview({ src, alt, onClose }: ImagePreviewProps) {
  const [scale, setScale] = useState(1);
  const [rotate, setRotate] = useState(0);
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const dragStart = useRef({ x: 0, y: 0 });
  const posStart = useRef({ x: 0, y: 0 });

  /** 放大 */
  const handleZoomIn = useCallback(() => {
    setScale((s) => Math.min(s + 0.5, 5));
  }, []);

  /** 缩小 */
  const handleZoomOut = useCallback(() => {
    setScale((s) => {
      const next = Math.max(s - 0.5, 0.5);
      if (next <= 1) setPosition({ x: 0, y: 0 });
      return next;
    });
  }, []);

  /** 顺时针旋转 90° */
  const handleRotate = useCallback(() => {
    setRotate((r) => (r + 90) % 360);
  }, []);

  /** 重置缩放与位置 */
  const handleReset = useCallback(() => {
    setScale(1);
    setRotate(0);
    setPosition({ x: 0, y: 0 });
  }, []);

  /** 滚轮缩放 */
  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.stopPropagation();
    if (e.deltaY < 0) {
      setScale((s) => Math.min(s + 0.25, 5));
    } else {
      setScale((s) => {
        const next = Math.max(s - 0.25, 0.5);
        if (next <= 1) setPosition({ x: 0, y: 0 });
        return next;
      });
    }
  }, []);

  /** 开始拖拽（仅 scale>1 时） */
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (scale <= 1) return;
    e.preventDefault();
    setIsDragging(true);
    dragStart.current = { x: e.clientX, y: e.clientY };
    posStart.current = { ...position };
  }, [scale, position]);

  /** 拖拽移动图片 */
  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!isDragging) return;
    setPosition({
      x: posStart.current.x + (e.clientX - dragStart.current.x),
      y: posStart.current.y + (e.clientY - dragStart.current.y),
    });
  }, [isDragging]);

  /** 结束拖拽 */
  const handleMouseUp = useCallback(() => {
    setIsDragging(false);
  }, []);

  // Close on Escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "+" || e.key === "=") handleZoomIn();
      if (e.key === "-") handleZoomOut();
      if (e.key === "r") handleRotate();
      if (e.key === "0") handleReset();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose, handleZoomIn, handleZoomOut, handleRotate, handleReset]);

  // Prevent body scroll
  useEffect(() => {
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = ""; };
  }, []);

  return createPortal(
    <div
      className="image-preview-overlay"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
    >
      {/* Toolbar */}
      <div className="image-preview-toolbar">
        <button onClick={handleZoomIn} className="image-preview-btn" title="放大 (+)">
          <ZoomIn size={18} />
        </button>
        <span className="image-preview-scale">{Math.round(scale * 100)}%</span>
        <button onClick={handleZoomOut} className="image-preview-btn" title="缩小 (-)">
          <ZoomOut size={18} />
        </button>
        <button onClick={handleRotate} className="image-preview-btn" title="旋转 (R)">
          <RotateCw size={18} />
        </button>
        <div className="image-preview-divider" />
        <button onClick={onClose} className="image-preview-btn image-preview-btn--close" title="关闭 (Esc)">
          <X size={18} />
        </button>
      </div>

      {/* Image */}
      <div
        className="image-preview-container"
        onWheel={handleWheel}
        onMouseDown={handleMouseDown}
        style={{ cursor: scale > 1 ? (isDragging ? "grabbing" : "grab") : "zoom-in" }}
      >
        <img
          src={src}
          alt={alt}
          className="image-preview-img"
          style={{
            transform: `translate(${position.x}px, ${position.y}px) scale(${scale}) rotate(${rotate}deg)`,
          }}
          draggable={false}
          onDoubleClick={handleReset}
        />
      </div>
    </div>,
    document.body
  );
}
