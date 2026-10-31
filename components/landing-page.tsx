import { ArrowRight, ArrowUp, Clock, Folder, Gauge, Github, MessageSquare, Plus } from "lucide-react";
import Link from "next/link";
import { Brand, BrandMark } from "@/components/brand";
import { SiteHeader } from "@/components/site-header";
import { createDemoConversations } from "@/lib/chat/demo-data";
import { demoPath, githubRepoUrl } from "@/lib/routes";

const demoConversations = createDemoConversations(Date.parse("2026-10-31T12:00:00.000Z"));
const demoMessages = demoConversations.flatMap((conversation) => conversation.messages);

const features = [
  { title: "Rooms", copy: "Keep a project's context, files, and threads together.", icon: Folder },
  { title: "Fast or deep, per question", copy: "Choose Fast, Balanced, or High for each message.", icon: Gauge },
  { title: "Pick up where you left off", copy: "Conversations are saved, so you can return to the same thread.", icon: Clock },
] as const;

const stack = [
  { name: "Next.js", detail: "App Router and React" },
  { name: "Fastify", detail: "API in apps/api" },
  { name: "Supabase + Drizzle", detail: "Postgres and ORM" },
  { name: "Vitest + Playwright", detail: "Unit and browser tests" },
] as const;

function WorkspaceFrame() {
  return <div className="landing-frame" aria-hidden="true">
    <div className="chat-workspace">
      <aside className="workspace-sidebar desktop-sidebar">
        <div className="sidebar-top"><Brand /></div>
        <div className="new-chat-button"><Plus size={17} strokeWidth={2.2} /> <span>New chat</span></div>
        <div className="history-nav">
          {demoConversations.map((conversation, index) => <section className="history-group" key={conversation.id}>
            <p>{index === 0 ? "Today" : "Yesterday"}</p>
            <div className="history-entry">
              <div className={`history-item${index === 0 ? " is-active" : ""}`}>
                <MessageSquare size={15} />
                <span>{conversation.title}</span>
              </div>
            </div>
          </section>)}
        </div>
      </aside>
      <section className="chat-main">
        <header className="chat-header">
          <div className="icon-button mobile-menu-button"><span className="landing-menu-glyph" /></div>
          <div className="header-model"><span className="model-dot" /><span>Nibie</span><span className="header-divider">/</span><span className="header-context">A little room to think</span></div>
          <div className="header-new-chat"><Plus size={16} /><span>New chat</span></div>
        </header>
        <div className="conversation-scroll has-messages">
          <div className="message-list">
            {demoMessages.map((message) => message.role === "user"
              ? <div className="message-row user" key={message.id}>
                <div className="message-column user">
                  <div className="message-content user"><p>{message.content}</p></div>
                </div>
                <div className="user-avatar">Y</div>
              </div>
              : <div className="message-row assistant" key={message.id}>
                <div className="assistant-badge"><BrandMark /></div>
                <div className="message-content assistant">
                  <p className="message-author">Nibie</p>
                  {message.content.split("\n\n").map((paragraph) => <p key={paragraph}>{paragraph}</p>)}
                </div>
              </div>)}
          </div>
        </div>
        <div className="composer-dock">
          <div className="composer">
            <p className="landing-composer-placeholder">Message Nibie…</p>
            <div className="composer-tools">
              <div className="landing-frame-modes"><span>Fast</span><span className="is-selected">Balanced</span><span>High</span></div>
              <div className="send-button"><ArrowUp size={18} strokeWidth={2.3} /></div>
            </div>
          </div>
        </div>
      </section>
    </div>
  </div>;
}

export function LandingPage() {
  return <div className="landing">
    <a className="skip-link" href="#content">Skip to content</a>
    <SiteHeader />
    <main id="content">
      <section className="landing-hero landing-shell" aria-labelledby="landing-hero-title">
        <h1 id="landing-hero-title">A personal AI workspace for thinking, writing, and code.</h1>
        <p className="landing-lede">Pick fast or deep models per question, keep context in Rooms, and pick up any conversation where you left it.</p>
        <div className="landing-actions">
          <Link className="landing-button" href={demoPath}>Try the demo <ArrowRight size={16} aria-hidden="true" /></Link>
          <a className="landing-button landing-button-secondary" href={githubRepoUrl} target="_blank" rel="noopener noreferrer">View on GitHub <Github size={16} aria-hidden="true" /></a>
        </div>
        <p className="landing-note">No sign-up. The demo uses recorded replies.</p>
      </section>

      <section className="landing-showcase" id="product" aria-labelledby="landing-product-title">
        <h2 id="landing-product-title" className="landing-sr">The workspace</h2>
        <p className="landing-sr">
          Example conversation from the public demo. User: {demoMessages[0]?.content} Nibie: {demoMessages[1]?.content} User: {demoMessages[2]?.content} Nibie: {demoMessages[3]?.content}
        </p>
        <WorkspaceFrame />
      </section>

      <section className="landing-shell landing-block" id="features" aria-labelledby="landing-features-title">
        <h2 id="landing-features-title">What Nibie does.</h2>
        <div className="landing-features">
          {features.map((feature) => <article className="landing-card" key={feature.title}>
            <feature.icon size={20} aria-hidden="true" />
            <h3>{feature.title}</h3>
            <p>{feature.copy}</p>
          </article>)}
        </div>
      </section>

      <section className="landing-shell landing-block" id="how-its-built" aria-labelledby="landing-built-title">
        <h2 id="landing-built-title">How it&apos;s built</h2>
        <p className="landing-lede landing-built-lede">A full-stack TypeScript app. <a href={githubRepoUrl} target="_blank" rel="noopener noreferrer">Read the source on GitHub</a>.</p>
        <ul className="landing-stack">
          {stack.map((item) => <li className="landing-card" key={item.name}>
            <h3>{item.name}</h3>
            <p>{item.detail}</p>
          </li>)}
        </ul>
      </section>

      <section className="landing-final landing-shell" aria-labelledby="landing-final-title">
        <h2 id="landing-final-title">See it in 30 seconds.</h2>
        <Link className="landing-button" href={demoPath}>Try the demo <ArrowRight size={16} aria-hidden="true" /></Link>
      </section>
    </main>
    <footer className="landing-footer landing-shell">
      <p className="landing-footer-credit">Built by Muhammad Habiibullah · <a href={githubRepoUrl} target="_blank" rel="noopener noreferrer">Source on GitHub</a></p>
      <nav aria-label="Footer">
        <Link href="/docs">Docs</Link>
        <Link href="/privacy">Privacy</Link>
        <Link href="/changelog">Changelog</Link>
      </nav>
    </footer>
  </div>;
}
