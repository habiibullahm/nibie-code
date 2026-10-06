import type { Metadata } from "next";
import Link from "next/link";
import { Brand } from "@/components/brand";
import { getProductName } from "@/lib/config/branding";
import { absolutePublicUrl, publicShareImage } from "@/lib/config/public-metadata";
import { SiteHeader } from "@/components/site-header";
import { chatPath } from "@/lib/routes";
import "../landing.css";

const description = "How Nibie handles your account, saved preferences, and conversations.";
const title = `Privacy · ${getProductName()}`;
const canonical = absolutePublicUrl("/privacy");
const image = publicShareImage();

export const metadata: Metadata = {
  title: "Privacy",
  description,
  ...(canonical ? { alternates: { canonical } } : {}),
  openGraph: {
    title,
    description,
    ...(canonical ? { url: canonical } : {}),
    siteName: getProductName(),
    type: "website",
    ...(image ? { images: [image] } : {}),
  },
  twitter: {
    card: image ? "summary_large_image" : "summary",
    title,
    description,
    ...(image ? { images: [image] } : {}),
  },
};

export const dynamic = "error";

export default function PrivacyPage() {
  return <div className="landing">
    {canonical ? <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify({
      "@context": "https://schema.org",
      "@type": "WebPage",
      name: title,
      description,
      url: canonical,
    }) }} /> : null}
    <a className="skip-link" href="#content">Skip to content</a>
    <SiteHeader currentPage="privacy" />
    <main id="content" className="landing-shell landing-document">
      <h1>Privacy</h1>
      <p>Nibie is a personal AI workspace. These are the account, preference, and conversation controls in the product today.</p>

      <h2>Your account</h2>
      <p>Conversations are saved to your account. A conversation belongs to the account that created it.</p>

      <h2>Preferences</h2>
      <p>You choose what Nibie knows about you. Saved account preferences can include a preferred name, preferred language, default model, response depth, response style, and an About you note. Personalization uses those choices. This is not hidden memory. You can clear the preferred name and the About you note.</p>
      <p>English and Bahasa Indonesia are saved on your account. Auto follows the language you are using.</p>
      <p>Theme, and the choices for how composing and reading a conversation behaves, stay on this device.</p>

      <h2>Conversations</h2>
      <p>Data & Privacy in Settings can download your conversations and messages as JSON. The file includes titles, messages, timestamps, and each conversation’s selected model.</p>
      <p>Deleting all conversations permanently deletes every conversation and message on your account. Your account and settings stay. This cannot be undone.</p>
      <p>Sign out everywhere ends your Nibie session on every device where you are signed in. It does not delete your account or your conversations.</p>
      <p>Account deletion is not available yet. Signing out and deleting conversations do not remove your Nibie account.</p>

      <h2>Boundaries</h2>
      <ul>
        <li>Account-scoped conversations</li>
        <li>AI credentials stay server-side</li>
        <li>Database-level access controls protect user-owned data</li>
        <li>Personalization is explicitly controlled by the user</li>
      </ul>
      <p>These actions are in Settings after you sign in.</p>
    </main>
    <footer className="landing-footer landing-shell">
      <div className="landing-footer-brand">
        <Brand />
        <p>Personal AI workspace.</p>
      </div>
      <nav aria-label="Footer">
        <Link href="/#product">Product</Link>
        <Link href="/privacy" aria-current="page">Privacy</Link>
        <Link href="/docs">Docs</Link>
        <Link href={chatPath}>Open Nibie</Link>
      </nav>
      <p className="landing-footer-meta">© 2026 Nibie</p>
    </footer>
  </div>;
}
