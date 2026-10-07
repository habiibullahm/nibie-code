"use client";

import { isValidElement, memo, useMemo, useState, type ReactNode } from "react";
import { WrapText } from "lucide-react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { CopyButton } from "@/components/copy-button";
import type { CitationSourceView } from "@/lib/citations/types";

// Model output is untrusted. react-markdown builds React elements (no raw HTML injection) and
// skipHtml drops embedded HTML; links are restricted to an allowlist and images are never loaded.
const safeUrl = /^(https?:|mailto:|#citation-source-\d+$)/i;
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

/** Turn known `[n]` citation markers into in-page links; leave unknown `[n]` as plain text. */
export function linkCitationMarkers(content: string, sources: readonly CitationSourceView[] | undefined): string {
  if (!content || !sources?.length) return content;
  const allowed = new Set(sources.map((source) => source.ordinal));
  return content.replace(/(^|[^\]\w])\[(\d+)\](?!\()/g, (match, prefix: string, digits: string) => {
    const ordinal = Number(digits);
    if (!allowed.has(ordinal)) return match;
    return `${prefix}[[${ordinal}]](#citation-source-${ordinal})`;
  });
}

function buildComponents(): Components {
  return {
    a({ href, children }) {
      const citation = href && /^#citation-source-(\d+)$/.exec(href);
      if (citation) {
        return <a href={href} className="citation-marker" aria-label={`Source ${citation[1]}`}>{children}</a>;
      }
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
}

const components = buildComponents();

export const MessageMarkdown = memo(function MessageMarkdown({
  content,
  sources,
}: {
  content: string;
  sources?: CitationSourceView[];
}) {
  const rendered = useMemo(() => linkCitationMarkers(content, sources), [content, sources]);
  return <div className="markdown"><ReactMarkdown remarkPlugins={[remarkGfm]} skipHtml urlTransform={urlTransform} components={components}>{rendered}</ReactMarkdown></div>;
});
