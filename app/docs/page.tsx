import type { Metadata } from "next";
import Link from "next/link";
import { ArrowUpRight, BookOpen } from "lucide-react";
import { Brand } from "@/components/brand";
import { absolutePublicUrl, publicShareImage } from "@/lib/config/public-metadata";
import { SiteHeader } from "@/components/site-header";
import { chatPath } from "@/lib/routes";
import "../landing.css";
import "./docs.css";

const description = "Learn how to use Nibie: conversations, models, Rooms, personalization, and your data controls.";
const canonical = absolutePublicUrl("/docs");
const image = publicShareImage();

export const metadata: Metadata = {
  title: "Docs",
  description,
  ...(canonical ? { alternates: { canonical } } : {}),
  openGraph: {
    title: "Docs · Nibie",
    description,
    ...(canonical ? { url: canonical } : {}),
    siteName: "Nibie",
    type: "website",
    ...(image ? { images: [image] } : {}),
  },
  twitter: {
    card: image ? "summary_large_image" : "summary",
    title: "Docs · Nibie",
    description,
    ...(image ? { images: [image] } : {}),
  },
};

export const dynamic = "error";

const topics = [
  ["getting-started", "Getting started"],
  ["conversations", "Conversations"],
  ["models", "Choosing a mode"],
  ["rooms", "Rooms & briefs"],
  ["context", "Understanding context"],
  ["personalization", "Personalization"],
  ["chat-preferences", "Chat preferences"],
  ["data-privacy", "Data & privacy"],
  ["common-questions", "Common questions"],
] as const;

export default function DocsPage() {
  return <div className="landing docs">
    <a className="skip-link" href="#content">Skip to content</a>
    <SiteHeader currentPage="docs" />
    <div className="landing-shell docs-layout">
      <aside className="docs-sidebar">
        <p className="docs-nav-title"><BookOpen size={16} aria-hidden="true" /> Nibie docs</p>
        <nav aria-label="Documentation topics">
          {topics.map(([id, label]) => <a key={id} href={`#${id}`}>{label}</a>)}
        </nav>
        <p className="docs-nav-note">A little guidance.<br />A little room to think.</p>
      </aside>
      <details className="docs-mobile-topics">
        <summary>On this page</summary>
        <nav aria-label="Documentation topics">
          {topics.map(([id, label]) => <a key={id} href={`#${id}`}>{label}</a>)}
        </nav>
      </details>
      <main id="content" className="landing-document docs-content" tabIndex={-1}>
        <div className="docs-intro">
          <p className="landing-kicker">The Nibie guide</p>
          <h1>Make yourself at home.</h1>
          <p className="docs-lede">Everything you need to start a conversation, organize your thinking, and make Nibie feel more like yours.</p>
          <div className="docs-start">
            <div><strong>Your first conversation</strong><p>Bring a question, a rough draft, or an idea. Start there.</p></div>
            <Link href={chatPath}>Open Nibie <ArrowUpRight size={16} aria-hidden="true" /></Link>
          </div>
        </div>

        <section id="getting-started" className="docs-section" aria-labelledby="getting-started-title">
          <p className="docs-section-number" aria-hidden="true">01 / Start here</p>
          <h2 id="getting-started-title">Getting started</h2>
          <p>Nibie is a personal AI workspace for thinking, writing, coding, and exploring ideas. A conversation can be a quick question or something you return to over time.</p>
          <ol>
            <li><Link href="/signup">Create an account</Link> or <Link href="/login">sign in</Link>. You can use Google or your email and password.</li>
            <li>Open the workspace and choose <strong>New chat</strong>.</li>
            <li>Write your message, then select the send arrow. By default, <kbd>Enter</kbd> sends and <kbd>Shift</kbd> + <kbd>Enter</kbd> adds a new line.</li>
            <li>Continue with a follow-up. Your conversation is saved to your account so you can return to it from the sidebar.</li>
          </ol>
          <blockquote><p>“Help me turn this rough idea into a plan. Ask me about anything that is missing before you suggest the next steps.”</p></blockquote>
        </section>

        <section id="conversations" className="docs-section" aria-labelledby="conversations-title">
          <p className="docs-section-number" aria-hidden="true">02 / Keep the thread</p>
          <h2 id="conversations-title">Conversations</h2>
          <p>Open a saved conversation from the sidebar to pick up where you left off. Use its rename or delete control to keep your history organized.</p>
          <dl>
            <div><dt>Stop a response</dt><dd>Select <strong>Stop response</strong> in the composer while Nibie is responding.</dd></div>
            <div><dt>Try another answer</dt><dd>Use <strong>Regenerate</strong> on the latest completed reply. If a response failed or stopped, use <strong>Retry</strong>.</dd></div>
            <div><dt>Change your message</dt><dd>Choose <strong>Edit</strong> on your latest message, then <strong>Save &amp; resend</strong>. This replaces the reply to that message.</dd></div>
            <div><dt>Take an answer with you</dt><dd>Use <strong>Copy response</strong>, or the copy control on a code block.</dd></div>
          </dl>
          <p>Editing and regenerating apply to the latest turn. If you want a different direction without replacing that reply, send a new message.</p>
        </section>

        <section id="models" className="docs-section" aria-labelledby="models-title">
          <p className="docs-section-number" aria-hidden="true">03 / Choose your pace</p>
          <h2 id="models-title">Choosing a mode</h2>
          <p>Choose a mode in the composer before sending. Nibie shows the modes configured for your workspace.</p>
          <div className="docs-table-wrap" role="region" aria-label="Model modes" tabIndex={0}>
            <table><caption>Which mode should I use?</caption><thead><tr><th scope="col">Mode</th><th scope="col">A good place to start</th></tr></thead><tbody>
              <tr><th scope="row">Fast</th><td>Quick questions, short drafts, and everyday tasks.</td></tr>
              <tr><th scope="row">Balanced</th><td>Daily thinking, writing, and most conversations.</td></tr>
              <tr><th scope="row">High</th><td>Problems that benefit from a deeper pass, such as debugging or comparing trade-offs.</td></tr>
            </tbody></table>
          </div>
          <p>The mode chooses how capable the model is, not how long the answer is. Ask for a short answer or a detailed one in your message and Nibie follows that in any mode; deeper modes can take longer to start answering.</p>
          <p>Set your default in <strong>Settings → Nibie</strong>. It applies to new chats; existing conversations keep their own model.</p>
        </section>

        <section id="rooms" className="docs-section" aria-labelledby="rooms-title">
          <p className="docs-section-number" aria-hidden="true">04 / Give work a home</p>
          <h2 id="rooms-title">Rooms &amp; briefs</h2>
          <p>A Room keeps related threads together and gives Nibie context for that work. Use one for a project, a learning goal, or an ongoing topic.</p>
          <ol>
            <li>Select <strong>New room</strong> in the sidebar and give it a name.</li>
            <li>Add a description and instructions, then choose <strong>Save room</strong>. Instructions explain how you want Nibie to work in this Room.</li>
            <li>Fill in the Brief and select <strong>Save brief</strong>.</li>
            <li>Select <strong>New thread</strong> inside the Room to start a conversation with that context.</li>
          </ol>
          <p>The Brief has five editable fields: <strong>Goal</strong>, <strong>Current focus</strong>, <strong>Important decisions</strong>, <strong>Open questions</strong>, and <strong>Next</strong>. Keep it short and update it as your work changes.</p>
          <blockquote><p><strong>Example instructions:</strong> “Help me learn TypeScript. Explain one concept at a time, use small examples, and ask me to try it before moving on.”</p></blockquote>
          <p>To move an existing thread, use the <strong>Room</strong> selector in the chat header. Choose <strong>General</strong> to remove it from a Room. Deleting a Room keeps its threads as general threads.</p>
        </section>

        <section id="context" className="docs-section" aria-labelledby="context-title">
          <p className="docs-section-number" aria-hidden="true">05 / Know what is in view</p>
          <h2 id="context-title">Understanding context</h2>
          <p>Select <strong>Context</strong> above the composer to see what Nibie is using in the conversation. The panel reports your profile, Room context when relevant, a thread summary when available, and recent conversation messages.</p>
          <p>Room instructions and the Brief apply to threads in that Room. Profile context comes from the preferences you choose to save. A Room does not automatically bring every other thread into a reply.</p>
          <p>Long conversations have limited space for context. Some older messages or optional context may be left out; the Context panel explains what was included. Restate an important detail in your current message if Nibie needs it.</p>
        </section>

        <section id="personalization" className="docs-section" aria-labelledby="personalization-title">
          <p className="docs-section-number" aria-hidden="true">06 / Make it yours</p>
          <h2 id="personalization-title">Personalization</h2>
          <p>Open <strong>Settings</strong> using the gear beside your account in the sidebar. These choices are saved to your account:</p>
          <dl>
            <div><dt>Profile</dt><dd>Set the name shown on your account. Leave it blank to use your sign-in name.</dd></div>
            <div><dt>General</dt><dd>Choose Auto, English, or Bahasa Indonesia. Auto follows the language you are using.</dd></div>
            <div><dt>Nibie</dt><dd>Choose a default model, response length (Concise, Balanced, Detailed), and response style (Natural, Professional, Direct).</dd></div>
            <div><dt>Personalization</dt><dd>Add an <strong>About you</strong> note with your role, goals, or working context. Leave it blank to clear it.</dd></div>
          </dl>
          <p>You can ask for a different language, length, or tone in an individual message. These are preferences, and personalization comes from the details you explicitly save.</p>
        </section>

        <section id="chat-preferences" className="docs-section" aria-labelledby="chat-preferences-title">
          <p className="docs-section-number" aria-hidden="true">07 / Settle in</p>
          <h2 id="chat-preferences-title">Chat preferences</h2>
          <p><strong>Settings → Chat</strong> controls how you compose and read on this device.</p>
          <ul>
            <li><strong>Enter to send:</strong> on by default. Turn it off to make Enter add a new line; use <kbd>Ctrl</kbd> + <kbd>Enter</kbd> or <kbd>⌘</kbd> + <kbd>Enter</kbd> to send.</li>
            <li><strong>Auto-follow streaming:</strong> follows new text while you are near the bottom. Turn it off to keep your place.</li>
            <li><strong>Show timestamps:</strong> displays a short time beside each message.</li>
            <li><strong>Restore last conversation:</strong> reopens your last accessible chat when you return. It is off by default.</li>
            <li><strong>Long prompts:</strong> the composer grows as you write. Choose <strong>Expand composer</strong> for more space, then <strong>Collapse composer</strong> to return to compact view. After its height limit, the text area scrolls internally.</li>
          </ul>
          <p>Choose Dark, Light, or the device setting under <strong>Settings → General → Theme</strong>. Theme and chat preferences stay on this device.</p>
        </section>

        <section id="data-privacy" className="docs-section" aria-labelledby="data-privacy-title">
          <p className="docs-section-number" aria-hidden="true">08 / Stay in control</p>
          <h2 id="data-privacy-title">Data &amp; privacy</h2>
          <p>Open <strong>Settings → Data &amp; Privacy</strong> for your account’s conversation controls.</p>
          <dl>
            <div><dt>Export conversations</dt><dd>Select <strong>Export JSON</strong> to download titles, messages, timestamps, and each conversation’s selected model.</dd></div>
            <div><dt>Delete all conversations</dt><dd>Type the confirmation shown in Settings. This permanently deletes every conversation and message on your account. Your account and settings stay, and the deletion cannot be undone.</dd></div>
            <div><dt>Sign out everywhere</dt><dd>Ends your Nibie sessions across devices. It does not delete your conversations or account.</dd></div>
          </dl>
          <p>Account deletion is not available yet. See <Link href="/privacy">Privacy details</Link> for the current account and preference boundaries.</p>
        </section>

        <section id="common-questions" className="docs-section" aria-labelledby="common-questions-title">
          <p className="docs-section-number" aria-hidden="true">09 / A few useful answers</p>
          <h2 id="common-questions-title">Common questions</h2>
          <details><summary>Can I attach files?</summary><p>Attachments are not available yet. You can paste relevant text into a message.</p></details>
          <details><summary>Why is a model missing?</summary><p>Only configured modes appear in the model picker. If your saved default is unavailable, Nibie uses an available mode for new chats.</p></details>
          <details><summary>What should I do if a response fails?</summary><p>Use Retry on the latest turn. If your session has expired, sign in again and reopen the conversation. Avoid sending the same message repeatedly while a response is still running.</p></details>
          <details><summary>Do I need an account?</summary><p>The documentation is public. <Link href="/signup">Create an account</Link> or <Link href="/login">sign in</Link> to use the workspace and save your conversations.</p></details>
          <details><summary>Does Nibie remember everything?</summary><p>Saved conversations and active AI context are different. Nibie uses selected context from the current thread, your saved profile, and its Room when relevant. Check the Context panel and repeat details that matter to your next question.</p></details>
        </section>
        <div className="docs-end"><p>A question is a good place to start.</p><Link className="landing-button" href={chatPath}>Start a conversation <ArrowUpRight size={16} aria-hidden="true" /></Link></div>
      </main>
    </div>
    <footer className="landing-footer landing-shell">
      <div className="landing-footer-brand"><Brand /><p>Personal AI workspace.</p></div>
      <nav aria-label="Footer">
        <Link href="/#product">Product</Link>
        <Link href="/docs" aria-current="page">Docs</Link>
        <Link href="/privacy">Privacy</Link>
        <Link href={chatPath}>Open Nibie</Link>
      </nav>
      <p className="landing-footer-meta">© 2026 Nibie</p>
    </footer>
  </div>;
}
