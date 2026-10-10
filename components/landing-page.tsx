import { ArrowUp, MessageSquare, Plus } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { Brand, BrandMark } from "@/components/brand";
import { SiteHeader } from "@/components/site-header";
import { getCurrentDevelopmentPreview } from "@/lib/changelog";
import { loadChangelog } from "@/lib/changelog-source";
import { chatPath } from "@/lib/routes";

const useCases: { title: string; copy: string; visual: ReactNode }[] = [
  {
    title: "Think",
    copy: "Work through a decision, question, or idea that is still taking shape.",
    visual: <div className="landing-fragment" aria-hidden="true">
      <p className="landing-fragment-user">The decision still isn’t clear. Help me find the question underneath it.</p>
      <p className="landing-fragment-reply">Start with what would change if you chose today. Leave the rest unnamed until it matters.</p>
    </div>,
  },
  {
    title: "Write",
    copy: "Draft, revise, summarize, and tighten language without losing your voice.",
    visual: <div className="landing-fragment" aria-hidden="true">
      <p className="landing-draft">I just wanted to circle back and touch base on a few things.</p>
      <p className="landing-revision">Here is the update, and the one decision I need from you.</p>
    </div>,
  },
  {
    title: "Code",
    copy: "Talk through bugs, implementation choices, and architecture.",
    visual: <div className="code-block landing-code" aria-hidden="true">
      <div className="code-block-header"><span>ts</span></div>
      <pre><code>{"if (timer) clearTimeout(timer)\ntimer = setTimeout(run, wait)"}</code></pre>
    </div>,
  },
  {
    title: "Explore",
    copy: "Follow a question further and return to the same thread later.",
    visual: <div className="landing-fragment" aria-hidden="true">
      <p className="landing-fragment-label">Earlier</p>
      <p className="landing-fragment-line">What belongs in this room?</p>
      <p className="landing-fragment-label">Returned</p>
      <p className="landing-fragment-line">Keep the same thread. Add only what you noticed since you left.</p>
    </div>,
  },
];

const statements = [
  ["01", "Fast when the question is already clear."],
  ["02", "More depth when the problem needs it."],
  ["03", "A workspace you can return to."],
] as const;

const modes = [
  ["Fast", "Quick answers"],
  ["Balanced", "Best for everyday work"],
  ["High", "Deeper reasoning"],
] as const;

const boundaries = [
  "Account-scoped conversations",
  "AI credentials stay server-side",
  "Database-level access controls protect user-owned data",
  "Personalization is explicitly controlled by the user",
];

function SettingChoice({ label, options, selected }: { label: string; options: readonly string[]; selected: string }) {
  return <div className="landing-setting">
    <p className="landing-setting-label">{label}</p>
    <div className="landing-pills">
      {options.map((option) => <span key={option} className={option === selected ? "is-selected" : undefined}>{option}{option === selected ? <span className="landing-sr">, selected</span> : null}</span>)}
    </div>
  </div>;
}

function WorkspaceFrame() {
  return <div className="landing-showcase-glow">
    <div className="landing-frame" aria-hidden="true">
      <div className="chat-workspace">
        <aside className="workspace-sidebar desktop-sidebar">
          <div className="sidebar-top"><Brand /></div>
          <div className="new-chat-button"><Plus size={17} strokeWidth={2.2} /> <span>New chat</span></div>
          <div className="history-nav">
            <section className="history-group">
              <p>Today</p>
              <div className="history-entry"><div className="history-item is-active"><MessageSquare size={15} /><span>Tighten the team note</span></div></div>
              <div className="history-entry"><div className="history-item"><MessageSquare size={15} /><span>Sketch of the parser</span></div></div>
            </section>
            <section className="history-group">
              <p>Yesterday</p>
              <div className="history-entry"><div className="history-item"><MessageSquare size={15} /><span>Questions about the launch</span></div></div>
            </section>
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
              <div className="message-row user">
                <div className="message-column user">
                  <div className="message-content user"><p>Help me tighten this before I send it to the team.</p></div>
                </div>
                <div className="user-avatar">Y</div>
              </div>
              <div className="message-row assistant">
                <div className="assistant-badge"><BrandMark /></div>
                <div className="message-content assistant">
                  <p className="message-author">Nibie</p>
                  <p>Lead with the decision, then the reason. One sentence on what changed is enough.</p>
                </div>
              </div>
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
            <p className="composer-caption">Your conversations are saved to your account.</p>
          </div>
        </section>
      </div>
    </div>
  </div>;
}

export function LandingPage() {
  const changelogPreview = getCurrentDevelopmentPreview(loadChangelog());
  return <div className="landing">
    <a className="skip-link" href="#content">Skip to content</a>
    <SiteHeader />
    <main id="content">
      <section className="landing-hero landing-shell" aria-labelledby="landing-hero-title">
        <p className="landing-kicker">Personal AI workspace</p>
        <h1 id="landing-hero-title">A quieter place to think with AI.</h1>
        <p className="landing-lede">Nibie is a personal AI workspace that helps you think, research, and continue your work—with less repetition.</p>
        <div className="landing-actions">
          <Link className="landing-button" href={chatPath}>Try Nibie</Link>
          <a className="landing-button landing-button-secondary" href="#product">See how it works</a>
        </div>
      </section>

      <section className="landing-showcase" id="product" aria-labelledby="landing-product-title">
        <h2 id="landing-product-title" className="landing-sr">The workspace</h2>
        <WorkspaceFrame />
      </section>

      <section className="landing-shell landing-block" aria-labelledby="landing-uses-title">
        <h2 id="landing-uses-title" className="landing-sr">What you can do here</h2>
        <div className="landing-uses">
          {useCases.map((item, index) => <article className={index % 2 === 1 ? "landing-use is-flipped" : "landing-use"} key={item.title}>
            <div className="landing-use-copy">
              <h3>{item.title}</h3>
              <p>{item.copy}</p>
            </div>
            {item.visual}
          </article>)}
        </div>
      </section>

      <section className="landing-shell landing-block" aria-labelledby="landing-why-title">
        <h2 id="landing-why-title">AI that gets out of the way.</h2>
        <ol className="landing-statements">
          {statements.map(([index, sentence]) => <li key={index}>
            <span aria-hidden="true">{index}</span>
            <p>{sentence}</p>
          </li>)}
        </ol>
      </section>

      <section className="landing-shell landing-block" id="personalization" aria-labelledby="landing-preferences-title">
        <div className="landing-personal">
          <div className="landing-personal-copy">
            <h2 id="landing-preferences-title">Make Nibie feel more like yours.</h2>
            <p>You choose how Nibie responds and what context you want it to use.</p>
            <p className="landing-emphasis">You decide what Nibie knows about you.</p>
            <p>Personalization comes from the preferences you explicitly choose to save.</p>
          </div>
          <div className="landing-settings">
            <SettingChoice label="Preferred language" options={["Auto", "English", "Bahasa Indonesia"]} selected="Auto" />
            <SettingChoice label="Default model" options={["Fast", "Balanced", "High"]} selected="Balanced" />
            <SettingChoice label="Response depth" options={["Concise", "Default", "Detailed"]} selected="Default" />
            <SettingChoice label="Response style" options={["Natural", "Professional", "Direct"]} selected="Natural" />
            <div className="landing-setting">
              <p className="landing-setting-label">Preferred name</p>
              <p className="landing-setting-value" aria-hidden="true">Your name</p>
              <p className="landing-sr">Not set</p>
            </div>
            <div className="landing-setting">
              <p className="landing-setting-label">About you</p>
              <p className="landing-setting-value is-tall" aria-hidden="true">Role, goals, or working context</p>
              <p className="landing-sr">Not set</p>
            </div>
          </div>
        </div>
      </section>

      <section className="landing-shell landing-block" aria-labelledby="landing-modes-title">
        <h2 id="landing-modes-title" className="landing-sr">Modes</h2>
        <div className="landing-mode-switch" aria-hidden="true">
          <span>Fast</span>
          <span className="is-selected">Balanced</span>
          <span>High</span>
        </div>
        <div className="landing-mode-list">
          {modes.map(([name, copy]) => <article key={name}>
            <h3>{name}</h3>
            <p>{copy}</p>
          </article>)}
        </div>
      </section>

      <section className="landing-quote landing-shell" aria-labelledby="landing-philosophy-title">
        <h2 id="landing-philosophy-title">AI should feel less like a feed and more like a room.</h2>
        <p>A conversation can stay open while you think, revise, and build. Leave, then return to the same thread.</p>
      </section>

      <section className="landing-shell landing-block" id="privacy" aria-labelledby="landing-privacy-title">
        <h2 id="landing-privacy-title">Built with clear boundaries.</h2>
        <ul className="landing-trust">
          {boundaries.map((item) => <li key={item}><h3>{item}</h3></li>)}
        </ul>
        <p className="landing-privacy-link"><Link href="/privacy">Privacy details</Link></p>
      </section>

      <section className="landing-shell landing-notes" aria-labelledby="landing-notes-title">
        <h2 id="landing-notes-title">Now in Nibie</h2>
        <ul>
          {changelogPreview.map((line) => <li key={line}>{line}</li>)}
        </ul>
        <p><Link href="/changelog">Full changelog</Link></p>
      </section>

      <section className="landing-final landing-shell" aria-labelledby="landing-final-title">
        <h2 id="landing-final-title">Make some room to think.</h2>
        <p>Start a conversation with Nibie.</p>
        <Link className="landing-button" href={chatPath}>Try Nibie</Link>
      </section>
    </main>
    <footer className="landing-footer landing-shell">
      <div className="landing-footer-brand">
        <Brand />
        <p>Personal AI workspace.</p>
      </div>
      <nav aria-label="Footer">
        <a href="#product">Product</a>
        <Link href="/privacy">Privacy</Link>
        <Link href="/docs">Docs</Link>
        <Link href="/changelog">Changelog</Link>
        <Link href={chatPath}>Open Nibie</Link>
      </nav>
      <p className="landing-footer-meta">© 2026 Nibie</p>
    </footer>
  </div>;
}
