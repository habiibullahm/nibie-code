import type { Metadata } from "next";
import { LandingPage } from "@/components/landing-page";
import { absolutePublicUrl, publicShareImage } from "@/lib/config/public-metadata";
import "./landing.css";

const title = "Nibie — A personal AI workspace for thinking, writing, and code";
const description = "Choose Fast, Balanced, or High per question, keep context in Rooms, and pick up any conversation where you left it.";

// Absolute only when the public origin is known. A missing production origin must not become localhost.
const canonical = absolutePublicUrl("/");
const image = publicShareImage();

export const metadata: Metadata = {
  title: { absolute: title },
  description,
  ...(canonical ? { alternates: { canonical } } : {}),
  openGraph: {
    title,
    description,
    ...(canonical ? { url: canonical } : {}),
    siteName: "Nibie",
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

// Legacy /?conversation=<id> bookmarks redirect in proxy.ts, so this page does not read the request.
export const dynamic = "error";

export default function HomePage() {
  return <>
    {canonical ? <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify({
      "@context": "https://schema.org",
      "@type": "WebSite",
      name: "Nibie",
      description,
      url: canonical,
    }) }} /> : null}
    <LandingPage />
  </>;
}
