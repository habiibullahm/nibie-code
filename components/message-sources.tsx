"use client";

import { memo } from "react";
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

export const MessageSources = memo(function MessageSources({
  sources,
}: {
  sources: CitationSourceView[];
}) {
  if (!sources.length) return null;
  return (
    <section className="message-sources" aria-label="Sources">
      <h3 className="message-sources-heading">Sources</h3>
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
    </section>
  );
});
