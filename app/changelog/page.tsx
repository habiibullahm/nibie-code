import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Metadata } from "next";
import Link from "next/link";
import { Brand } from "@/components/brand";
import { SiteHeader } from "@/components/site-header";
import { getWordmark } from "@/lib/config/branding";
import { absolutePublicUrl, publicShareImage } from "@/lib/config/public-metadata";
import { parseChangelog } from "@/lib/changelog";
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

function loadChangelog() {
  return parseChangelog(readFileSync(join(process.cwd(), "CHANGELOG.md"), "utf8"));
}

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
      <p className="changelog-name">{name}</p>
      <h1>{changelog.title}</h1>
      {changelog.intro.map((paragraph) => <p className="changelog-intro" key={paragraph}>{paragraph}</p>)}
      {changelog.entries.map((entry) => <article className="changelog-entry" key={entry.version}>
        <h2>{entry.version}</h2>
        {entry.date ? <p className="changelog-date">{entry.date}</p> : null}
        {entry.groups.map((group) => <section className="changelog-group" key={group.heading} aria-labelledby={sectionId(entry.version, group.heading)}>
          <h3 id={sectionId(entry.version, group.heading)}>{group.heading}</h3>
          <ul>
            {group.items.map((item) => <li key={item}>{item}</li>)}
          </ul>
        </section>)}
      </article>)}
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
