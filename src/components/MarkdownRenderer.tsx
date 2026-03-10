import { Mermaid } from "@ant-design/x";
import { Check, Copy } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import rehypeHighlight from "rehype-highlight";
import remarkGfm from "remark-gfm";

/** MarkdownRenderer 组件的 Props */
interface MarkdownRendererProps {
    content: string;
}

/** 递归提取 React 节点中的纯文本内容（用于复制代码块文字） */
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
 * 由 react-markdown 渲染的代码块组件：
 *  - mermaid 语言围栏 → 通过 @ant-design/x Mermaid 渲染交互式流程图
 *  - 其他语言围栏    → 语法高亮 + 一键复制按钮
 *  - 行内代码        → 简单样式的 span
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

    // 组件卸载时清除复制状态的定时器，防止内存泄漏
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
    const handleCopy = () => {
        const text = extractText(children).replace(/\n$/, "");
        navigator.clipboard.writeText(text).catch(() => {});
        setCopied(true);
        // 2 秒后恢复复制按钮状态
        if (timerRef.current) clearTimeout(timerRef.current);
        timerRef.current = setTimeout(() => setCopied(false), 2000);
    };

    return (
        <div className="md-code-block">
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

/** 外部链接包装组件 — 强制所有 href 在新标签页中打开 */
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

/** 顶层 Markdown 渲染器 — 支持 GFM 表格、Mermaid 流程图、语法高亮、外部链接 */
export function MarkdownRenderer({ content }: MarkdownRendererProps) {
    // 组件映射表稳定引用，避免 ReactMarkdown 因引用变化触发不必要的重渲染
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
