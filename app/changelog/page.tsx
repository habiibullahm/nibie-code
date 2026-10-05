import type { Metadata } from "next";
import Link from "next/link";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { Brand } from "@/components/brand";
import { SiteHeader } from "@/components/site-header";
import { getWordmark } from "@/lib/config/branding";
import { absolutePublicUrl, publicShareImage } from "@/lib/config/public-metadata";
import { loadChangelog } from "@/lib/changelog-source";
import { chatPath } from "@/lib/routes";
import "../landing.css";
import "./changelog.css";

const description = "Product updates, improvements, and fixes for Nibie.";
const name = getWordmark();
const pageTitle = `${name} Changelog`;
const canonical = absolutePublicUrl("/changelog");
const image = publicShareImage();

export const metadata: Metadata = {
  title: { absolute: pageTitle },
  description,
  robots: { index: true, follow: true },
  ...(canonical ? { alternates: { canonical } } : {}),
  openGraph: {
    title: pageTitle,
    description,
    ...(canonical ? { url: canonical } : {}),
    siteName: name,
    type: "website",
    ...(image ? { images: [image] } : {}),
  },
  twitter: {
    card: image ? "summary_large_image" : "summary",
    title: pageTitle,
    description,
    ...(image ? { images: [image] } : {}),
  },
};

export const dynamic = "error";

const changelogMarkdownComponents: Components = {
  p: ({ children }) => <>{children}</>,
  a: ({ href, children }) => href && /^https?:\/\//i.test(href) ? <a href={href}>{children}</a> : <span>{children}</span>,
};

function sectionId(version: string, heading: string) {
  return `${version}-${heading}`.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

export default function ChangelogPage() {
  const changelog = loadChangelog();

  return <div className="landing changelog-page">
    {canonical ? <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify({
      "@context": "https://schema.org",
      "@type": "WebPage",
      name: pageTitle,
      description,
      url: canonical,
    }) }} /> : null}
    <a className="skip-link" href="#content">Skip to content</a>
    <SiteHeader />
    <main id="content" className="landing-shell landing-document changelog-column">
      <header className="changelog-hero">
        <p className="changelog-eyebrow">Product updates</p>
        <h1>{changelog.title}</h1>
        {changelog.intro.map((paragraph) => <p className="changelog-intro" key={paragraph}>{paragraph}</p>)}
      </header>
      {changelog.entries.map((entry) => {
        const versionLabel = entry.version.trim().toLowerCase();
        const isUnreleased = versionLabel === "unreleased";
        const isDevelopment = versionLabel === "current development";
        return <article className={`changelog-entry${isUnreleased ? " changelog-entry--unreleased" : ""}${isDevelopment ? " changelog-entry--development" : ""}`} key={entry.version}>
          <header className="changelog-entry-header">
            <div className="changelog-entry-title">
              {isDevelopment ? <p className="changelog-entry-kind">Development snapshot</p> : null}
              <h2>{entry.version}</h2>
              {isUnreleased ? <span className="changelog-entry-status">In progress</span> : null}
            </div>
            {entry.date ? <p className="changelog-date">{entry.date}</p> : null}
          </header>
          <div className="changelog-entry-content">
            {entry.groups.map((group) => {
              const headingId = sectionId(entry.version, group.heading);
              const isKnownIssues = group.heading.trim().toLowerCase() === "known issues";
              return <section className={`changelog-group${isKnownIssues ? " changelog-group--known-issues" : ""}`} key={group.heading} aria-labelledby={headingId}>
                <h3 id={headingId}>{group.heading}</h3>
                <ul>
                  {group.items.map((item) => <li key={item}><ReactMarkdown remarkPlugins={[remarkGfm]} skipHtml components={changelogMarkdownComponents}>{item}</ReactMarkdown></li>)}
                </ul>
              </section>;
            })}
          </div>
        </article>;
      })}
    </main>
    <footer className="landing-footer landing-shell">
      <div className="landing-footer-brand">
        <Brand />
        <p>Personal AI workspace.</p>
      </div>
      <nav aria-label="Footer">
        <Link href="/#product">Product</Link>
        <Link href="/docs">Docs</Link>
        <Link href="/privacy">Privacy</Link>
        <Link href="/changelog" aria-current="page">Changelog</Link>
        <Link href={chatPath}>Open Nibie</Link>
      </nav>
      <p className="landing-footer-meta">© 2026 Nibie</p>
    </footer>
  </div>;
}
