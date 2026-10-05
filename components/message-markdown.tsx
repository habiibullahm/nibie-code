"use client";

import { isValidElement, memo, useState, type ReactNode } from "react";
import { WrapText } from "lucide-react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { CopyButton } from "@/components/copy-button";

// Model output is untrusted. react-markdown builds React elements (no raw HTML injection) and
// skipHtml drops embedded HTML; links are restricted to an allowlist and images are never loaded.
const safeUrl = /^(https?:|mailto:)/i;
function urlTransform(url: string) { return safeUrl.test(url.trim()) ? url : ""; }

function textOf(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textOf).join("");
  if (isValidElement<{ children?: ReactNode }>(node)) return textOf(node.props.children);
  return "";
}

function CodeBlock({ language, text }: { language: string | undefined; text: string }) {
  const [wrapped, setWrapped] = useState(false);
  return <div className={`code-block${wrapped ? " is-wrapped" : ""}`}>
    <div className="code-block-header">
      <span>{language ?? "text"}</span>
      <div className="code-block-actions">
        <button type="button" className="copy-button is-compact is-icon-only code-wrap-button" aria-label="Wrap code" aria-pressed={wrapped} title={wrapped ? "Disable line wrapping" : "Enable line wrapping"} onClick={() => setWrapped((value) => !value)}><WrapText size={14} aria-hidden="true" /></button>
        <CopyButton text={text} label={language ? `Copy ${language} code block` : "Copy code block"} compact iconOnly />
      </div>
    </div>
    <pre tabIndex={0}><code>{text}</code></pre>
  </div>;
}

const components: Components = {
  a({ href, children }) {
    return href ? <a href={href} target="_blank" rel="noopener noreferrer nofollow">{children}</a> : <span>{children}</span>;
  },
  img({ alt }) { return alt ? <span>{alt}</span> : null; },
  pre({ children }) {
    const code = isValidElement<{ className?: string }>(children) ? children : null;
    const language = /language-([\w+#.-]+)/.exec(code?.props.className ?? "")?.[1];
    const text = textOf(children).replace(/\n$/, "");
    return <CodeBlock language={language} text={text} />;
  },
  table({ children }) { return <div className="markdown-table"><table>{children}</table></div>; },
};

export const MessageMarkdown = memo(function MessageMarkdown({ content }: { content: string }) {
  return <div className="markdown"><ReactMarkdown remarkPlugins={[remarkGfm]} skipHtml urlTransform={urlTransform} components={components}>{content}</ReactMarkdown></div>;
});
