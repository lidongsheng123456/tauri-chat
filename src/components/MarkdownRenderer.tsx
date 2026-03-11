import { Mermaid } from "@ant-design/x";
import { Check, Copy } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import rehypeHighlight from "rehype-highlight";
import remarkGfm from "remark-gfm";

/**
 * `MarkdownRenderer` 组件的 Props。
 */
interface MarkdownRendererProps {
    /** 需要渲染为富文本的 Markdown 源字符串，支持 GFM 扩展语法。 */
    content: string;
}

/**
 * 递归提取 React 节点树中的纯文本内容。
 *
 * 用于从 `react-markdown` 渲染的代码块子节点中还原原始代码字符串，
 * 供复制按钮与 Mermaid 渲染使用。
 *
 * 处理以下节点类型：
 * - `null` / `undefined` / `boolean` — 返回空字符串。
 * - `string` / `number` — 直接转为字符串返回。
 * - 数组 — 递归提取每个元素后拼接。
 * - React 元素对象（含 `props.children`）— 递归提取 `children`。
 *
 * @param {React.ReactNode} node - 需要提取文本的 React 节点。
 * @returns {string} 节点树中所有文本内容拼接而成的纯文本字符串。
 */
function extractText(node: React.ReactNode): string {
    if (node == null || typeof node === "boolean") return "";
    if (typeof node === "string" || typeof node === "number")
        return String(node);
    if (Array.isArray(node)) return node.map(extractText).join("");
    if (typeof node === "object" && "props" in node) {
        return extractText(
            (node as React.ReactElement<{ children?: React.ReactNode }>).props
                .children,
        );
    }
    return "";
}

/**
 * 由 `react-markdown` 渲染的代码块自定义组件，根据语言类型分三种方式渲染：
 *
 * 1. **行内代码**（无语言标识）— 渲染为带样式的 `<code>` 行内元素。
 * 2. **Mermaid 围栏代码块**（`` ```mermaid ``）— 通过 `@ant-design/x` 的
 *    `Mermaid` 组件渲染为可交互的流程图/时序图等。
 * 3. **其他围栏代码块** — 语法高亮（由 `rehype-highlight` 处理）+ 右上角一键复制按钮，
 *    复制后 2 秒内显示「已复制」状态，随后自动恢复。
 *
 * 组件卸载时自动清除复制状态的定时器，防止在已卸载组件上调用 `setState`。
 *
 * @param {React.HTMLAttributes<HTMLElement> & { children?: React.ReactNode; node?: unknown }} props
 *   由 `react-markdown` 注入的 HTML 属性，`className` 中含语言标识（如 `language-ts`），
 *   `node` 为 AST 节点（此处忽略）。
 */
function CodeBlock({
    className,
    children,
    ...props
}: React.HTMLAttributes<HTMLElement> & {
    children?: React.ReactNode;
    node?: unknown;
}) {
    const [copied, setCopied] = useState(false);
    const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const match = /language-(\w+)/.exec(className ?? "");
    const lang = match?.[1] ?? "";
    const isInline = !match && !className?.includes("hljs");

    /** 组件卸载时清除复制状态的定时器，防止内存泄漏。 */
    useEffect(() => {
        return () => {
            if (timerRef.current) clearTimeout(timerRef.current);
        };
    }, []);

    /* ── 行内代码 ── */
    if (isInline) {
        return (
            <code className="md-inline-code" {...props}>
                {children}
            </code>
        );
    }

    /* ── Mermaid 流程图 ── */
    if (lang === "mermaid") {
        const code = extractText(children).replace(/\n$/, "");
        return (
            <div className="md-mermaid-block">
                <Mermaid>{code}</Mermaid>
            </div>
        );
    }

    /* ── 普通代码块（语法高亮 + 复制按钮） ── */
    /**
     * 将代码块内容写入剪贴板，复制成功后 2 秒内显示「已复制」状态。
     *
     * 通过 `timerRef` 管理定时器，支持在 2 秒内重复点击时重新计时。
     */
    const handleCopy = () => {
        const text = extractText(children).replace(/\n$/, "");
        navigator.clipboard.writeText(text).catch(() => {});
        setCopied(true);
        if (timerRef.current) clearTimeout(timerRef.current);
        timerRef.current = setTimeout(() => setCopied(false), 2000);
    };

    return (
        <div className="md-code-block">
            {/* 代码块顶部工具栏：左侧显示语言标识，右侧为复制按钮 */}
            <div className="md-code-header">
                <span className="md-code-lang">{lang || "code"}</span>
                <button
                    className="md-code-copy"
                    onClick={handleCopy}
                    title="复制代码"
                >
                    {copied ? <Check size={14} /> : <Copy size={14} />}
                    <span>{copied ? "已复制" : "复制"}</span>
                </button>
            </div>
            <pre className="md-pre">
                <code className={className} {...props}>
                    {children}
                </code>
            </pre>
        </div>
    );
}

/**
 * 外部链接包装组件，强制将所有 `<a>` 标签设置为在新标签页中打开。
 *
 * 通过 `react-markdown` 的 `components` 映射替换默认的 `<a>` 渲染行为，
 * 防止点击 Markdown 中的链接时离开当前 Tauri 应用窗口。
 * `rel="noopener noreferrer"` 用于防止新页面通过 `window.opener` 访问原始页面。
 *
 * @param {React.AnchorHTMLAttributes<HTMLAnchorElement> & { children?: React.ReactNode; node?: unknown }} props
 *   由 `react-markdown` 注入的锚点属性，`node` 为 AST 节点（此处忽略）。
 */
function ExternalLink({
    children,
    ...props
}: React.AnchorHTMLAttributes<HTMLAnchorElement> & {
    children?: React.ReactNode;
    node?: unknown;
}) {
    return (
        <a {...props} target="_blank" rel="noopener noreferrer">
            {children}
        </a>
    );
}

/**
 * Markdown 富文本渲染器，将 Markdown 字符串渲染为带样式的 HTML 内容。
 *
 * 特性说明：
 * - **GFM 扩展**（`remark-gfm`）：支持表格、任务列表、删除线、自动链接等 GitHub Flavored Markdown 语法。
 * - **语法高亮**（`rehype-highlight`）：代码围栏块自动按语言着色，样式由全局 CSS 控制。
 * - **Mermaid 图表**（`@ant-design/x Mermaid`）：` ```mermaid ` 围栏块渲染为可交互图表。
 * - **外部链接**：所有链接强制在新标签页打开，防止跳出 Tauri 应用窗口。
 * - **组件映射表稳定引用**：`components` 对象通过 `useMemo` 缓存，避免 `ReactMarkdown`
 *   因引用变化触发不必要的重渲染，提升流式输出时的性能。
 *
 * @param {MarkdownRendererProps} props - 组件 Props，详见 `MarkdownRendererProps` 接口定义。
 */
export function MarkdownRenderer({ content }: MarkdownRendererProps) {
    /**
     * 组件映射表，将 `react-markdown` 默认渲染的 `code` 和 `a` 元素
     * 替换为自定义的 `CodeBlock` 与 `ExternalLink` 组件。
     *
     * 使用 `useMemo` 确保引用稳定，避免 `ReactMarkdown` 每次渲染时将其视为新对象
     * 而触发完整的子树重渲染（在 AI 流式输出场景下尤为重要）。
     */
    const components = useMemo(
        () => ({
            code: CodeBlock,
            a: ExternalLink,
        }),
        [],
    );

    return (
        <div className="md-content">
            <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                rehypePlugins={[rehypeHighlight]}
                components={components}
            >
                {content}
            </ReactMarkdown>
        </div>
    );
}
