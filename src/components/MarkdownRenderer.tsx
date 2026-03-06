import { Check, Copy } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import rehypeHighlight from "rehype-highlight";
import remarkGfm from "remark-gfm";

/** Markdown 渲染器 Props */
interface MarkdownRendererProps {
  content: string;
}

/** 从 React 节点递归提取纯文本（用于复制代码） */
function extractText(node: React.ReactNode): string {
  if (node == null || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(extractText).join("");
  if (typeof node === "object" && "props" in node) {
    return extractText((node as React.ReactElement<{ children?: React.ReactNode }>).props.children);
  }
  return "";
}

/** 代码块组件 - 支持语法高亮、复制、行内/块级区分 */
function CodeBlock({ className, children, node, ...props }: React.HTMLAttributes<HTMLElement> & { children?: React.ReactNode; node?: unknown }) {
  const [copied, setCopied] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const match = /language-(\w+)/.exec(className || "");
  const isInline = !match && !className?.includes("hljs");

  useEffect(() => {
    return () => { if (timerRef.current) clearTimeout(timerRef.current); };
  }, []);

  if (isInline) {
    return (
      <code className="md-inline-code" {...props}>
        {children}
      </code>
    );
  }

  /** 复制代码到剪贴板 */
  const handleCopy = () => {
    const text = extractText(children).replace(/\n$/, "");
    navigator.clipboard.writeText(text).catch(() => { });
    setCopied(true);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="md-code-block">
      <div className="md-code-header">
        <span className="md-code-lang">{match?.[1] || "code"}</span>
        <button className="md-code-copy" onClick={handleCopy} title="复制代码">
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

/** 外链组件 - 新窗口打开 */
function ExternalLink({ children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { children?: React.ReactNode; node?: unknown }) {
  return (
    <a {...props} target="_blank" rel="noopener noreferrer">
      {children}
    </a>
  );
}

/** Markdown 渲染组件 - GFM、代码高亮、外链新窗口 */
export function MarkdownRenderer({ content }: MarkdownRendererProps) {
  const components = useMemo(() => ({
    code: CodeBlock,
    a: ExternalLink,
  }), []);

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
