"use client";

import { memo, useEffect, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";
import type { CitationSourceView } from "@/lib/citations/types";

function sourceHref(source: CitationSourceView): string | null {
  if (!source.url) return null;
  try {
    const parsed = new URL(source.url);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
    return parsed.toString();
  } catch {
    return null;
  }
}

// One-line summary shown while the list is collapsed: the distinct domains (or titles when a source has none).
function summaryOf(sources: CitationSourceView[]): string {
  const names = sources.map((source) => (source.domain ?? source.title).replace(/^www\./i, ""));
  return [...new Set(names)].join(" · ");
}

export const MessageSources = memo(function MessageSources({
  sources,
}: {
  sources: CitationSourceView[];
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDetailsElement>(null);

  // A citation marker links to #citation-source-N. That target is hidden while collapsed, so expand and scroll to it.
  useEffect(() => {
    const reveal = () => {
      const id = window.location.hash.slice(1);
      if (!/^citation-source-\d+$/.test(id)) return;
      const target = document.getElementById(id);
      if (!target || !root.current?.contains(target)) return;
      setOpen(true);
      requestAnimationFrame(() => target.scrollIntoView({ block: "nearest" }));
    };
    reveal();
    window.addEventListener("hashchange", reveal);
    return () => window.removeEventListener("hashchange", reveal);
  }, []);

  if (!sources.length) return null;
  return (
    <details ref={root} className="message-sources" open={open} onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary className="message-sources-summary" aria-label={`Sources, ${sources.length}`}>
        <span className="message-sources-heading">Sources</span>
        <span className="message-sources-count" aria-hidden="true">{sources.length}</span>
        <span className="message-sources-domains">{summaryOf(sources)}</span>
        <ChevronDown className="message-sources-chevron" size={14} aria-hidden="true" />
      </summary>
      <ol className="message-sources-list">
        {sources.map((source) => {
          const href = sourceHref(source);
          return (
            <li key={source.ordinal} id={`citation-source-${source.ordinal}`} className="message-source">
              <span className="message-source-ordinal" aria-hidden="true">{source.ordinal}</span>
              <span className="message-source-body">
                {href ? (
                  <a href={href} target="_blank" rel="noopener noreferrer nofollow" className="message-source-title">
                    {source.title}
                  </a>
                ) : (
                  <span className="message-source-title">{source.title}</span>
                )}
                {source.domain ? <span className="message-source-domain">{source.domain}</span> : null}
              </span>
            </li>
          );
        })}
      </ol>
    </details>
  );
});
