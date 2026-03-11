import { RotateCw, X, ZoomIn, ZoomOut } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

/**
 * `ImagePreview` 组件的 Props。
 */
interface ImagePreviewProps {
    /** 需要预览的图片完整 URL，由父组件通过服务器地址拼接生成。 */
    src: string;
    /** 图片的替代文本，用于无障碍访问与图片加载失败时的占位显示。 */
    alt: string;
    /**
     * 关闭预览灯箱的回调。
     *
     * 由以下三种交互触发：点击工具栏关闭按钮、按下 `Escape` 键、点击图片区域外的遮罩层。
     */
    onClose: () => void;
}

/**
 * 图片全屏预览灯箱组件，支持缩放、旋转、拖拽平移与键盘快捷键操作。
 *
 * 功能说明：
 * - **缩放**：工具栏按钮（`+` / `-`）、滚轮滚动、键盘 `+` / `-` 键，缩放范围 50%～500%。
 * - **旋转**：工具栏旋转按钮、键盘 `R` 键，每次顺时针旋转 90°。
 * - **拖拽**：仅在缩放比例 > 1 时可拖拽平移图片，光标样式随拖拽状态切换（`grab` / `grabbing`）。
 * - **重置**：双击图片或按键盘 `0` 键，将缩放、旋转与位置全部还原为初始值。
 * - **关闭**：点击遮罩层（非图片区域）或按 `Escape` 键关闭灯箱。
 * - 打开时锁定 `body` 滚动条，关闭时还原，防止背景内容随滚轮滚动。
 * - 通过 `createPortal` 将灯箱挂载到 `document.body`，避免被父组件的 `overflow: hidden` 裁剪。
 *
 * @param {ImagePreviewProps} props - 组件 Props，详见 `ImagePreviewProps` 接口定义。
 */
export function ImagePreview({ src, alt, onClose }: ImagePreviewProps) {
    const [scale, setScale] = useState(1);
    const [rotate, setRotate] = useState(0);
    const [position, setPosition] = useState({ x: 0, y: 0 });
    const [isDragging, setIsDragging] = useState(false);
    /** 拖拽开始时记录的鼠标位置，用于计算拖拽偏移量。 */
    const dragStart = useRef({ x: 0, y: 0 });
    /** 拖拽开始时记录的图片位置，用于基于起始点计算新位置。 */
    const posStart = useRef({ x: 0, y: 0 });

    /**
     * 放大图片，每次增加 50%，上限为 500%（`scale = 5`）。
     */
    const handleZoomIn = useCallback(() => {
        setScale((s) => Math.min(s + 0.5, 5));
    }, []);

    /**
     * 缩小图片，每次减少 50%，下限为 50%（`scale = 0.5`）。
     *
     * 缩小至 100% 以下时自动重置位置偏移，防止图片偏移到不可见区域。
     */
    const handleZoomOut = useCallback(() => {
        setScale((s) => {
            const next = Math.max(s - 0.5, 0.5);
            if (next <= 1) setPosition({ x: 0, y: 0 });
            return next;
        });
    }, []);

    /**
     * 顺时针旋转图片 90°，旋转角度在 0°、90°、180°、270° 间循环。
     */
    const handleRotate = useCallback(() => {
        setRotate((r) => (r + 90) % 360);
    }, []);

    /**
     * 重置图片的缩放、旋转与位置偏移，恢复到初始展示状态。
     *
     * 双击图片或按键盘 `0` 键时触发。
     */
    const handleReset = useCallback(() => {
        setScale(1);
        setRotate(0);
        setPosition({ x: 0, y: 0 });
    }, []);

    /**
     * 滚轮缩放处理：向上滚动放大 25%，向下滚动缩小 25%，范围同工具栏按钮。
     *
     * 缩小至 100% 以下时自动重置位置偏移。
     * 阻止事件冒泡，防止背景内容随滚轮滚动。
     *
     * @param {React.WheelEvent} e - 滚轮事件对象。
     */
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

    /**
     * 鼠标按下处理：仅在 `scale > 1` 时开始拖拽，记录起始鼠标位置与图片位置。
     *
     * `scale <= 1` 时不启用拖拽，因为图片未放大时不需要平移。
     *
     * @param {React.MouseEvent} e - 鼠标按下事件对象。
     */
    const handleMouseDown = useCallback(
        (e: React.MouseEvent) => {
            if (scale <= 1) return;
            e.preventDefault();
            setIsDragging(true);
            dragStart.current = { x: e.clientX, y: e.clientY };
            posStart.current = { ...position };
        },
        [scale, position],
    );

    /**
     * 鼠标移动处理：在拖拽状态下根据鼠标位移实时更新图片的偏移位置。
     *
     * 新位置 = 拖拽起始位置 + (当前鼠标坐标 - 拖拽开始时鼠标坐标)。
     *
     * @param {React.MouseEvent} e - 鼠标移动事件对象。
     */
    const handleMouseMove = useCallback(
        (e: React.MouseEvent) => {
            if (!isDragging) return;
            setPosition({
                x: posStart.current.x + (e.clientX - dragStart.current.x),
                y: posStart.current.y + (e.clientY - dragStart.current.y),
            });
        },
        [isDragging],
    );

    /**
     * 鼠标释放处理：结束拖拽状态。
     *
     * 同时绑定在 `onMouseLeave` 事件上，防止鼠标移出遮罩层时拖拽状态未释放。
     */
    const handleMouseUp = useCallback(() => {
        setIsDragging(false);
    }, []);

    /**
     * 键盘快捷键处理，监听 `window` 全局键盘事件：
     * - `Escape` — 关闭灯箱。
     * - `+` / `=` — 放大图片。
     * - `-` — 缩小图片。
     * - `R` / `r` — 顺时针旋转 90°。
     * - `0` — 重置缩放、旋转与位置。
     */
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

    /**
     * 打开灯箱时锁定 `body` 滚动条，防止背景内容随滚轮滚动；
     * 组件卸载（灯箱关闭）时还原 `overflow` 样式。
     */
    useEffect(() => {
        document.body.style.overflow = "hidden";
        return () => {
            document.body.style.overflow = "";
        };
    }, []);

    return createPortal(
        <div
            className="image-preview-overlay"
            onClick={(e) => {
                if (e.target === e.currentTarget) onClose();
            }}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
            onMouseLeave={handleMouseUp}
        >
            {/* 顶部工具栏：缩放比例显示、放大、缩小、旋转、关闭按钮 */}
            <div className="image-preview-toolbar">
                <button
                    onClick={handleZoomIn}
                    className="image-preview-btn"
                    title="放大 (+)"
                >
                    <ZoomIn size={18} />
                </button>
                <span className="image-preview-scale">
                    {Math.round(scale * 100)}%
                </span>
                <button
                    onClick={handleZoomOut}
                    className="image-preview-btn"
                    title="缩小 (-)"
                >
                    <ZoomOut size={18} />
                </button>
                <button
                    onClick={handleRotate}
                    className="image-preview-btn"
                    title="旋转 (R)"
                >
                    <RotateCw size={18} />
                </button>
                <div className="image-preview-divider" />
                <button
                    onClick={onClose}
                    className="image-preview-btn image-preview-btn--close"
                    title="关闭 (Esc)"
                >
                    <X size={18} />
                </button>
            </div>

            {/* 图片容器：绑定滚轮缩放与鼠标拖拽事件，光标样式随缩放与拖拽状态动态切换 */}
            <div
                className="image-preview-container"
                onWheel={handleWheel}
                onMouseDown={handleMouseDown}
                style={{
                    cursor:
                        scale > 1
                            ? isDragging
                                ? "grabbing"
                                : "grab"
                            : "zoom-in",
                }}
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
        document.body,
    );
}
