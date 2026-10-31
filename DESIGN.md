# Nibie Design System

Build-ready rules for the Nibie landing page and marketing surfaces. Follow these before adding or changing UI. If a value here disagrees with the code, update the code to match this file, or change this file in the same PR.

**Audience:** first-time visitors, meaning potential users and developers who are evaluating the product and the code.

## 1. Principles

- **Clean and restrained.** Use flat surfaces, thin borders, and grey text. Add decoration only when it does a job.
- **Dark-first.** Design and review in the dark theme first. The light theme has to keep working.
- **One primary action per screen.** Only one accent button should be visible in any viewport.
- **Generous whitespace.** Use the spacing scale below. Do not squeeze sections together to fit more on screen.
- **No stock visuals.** No gradient glows, blurred blobs, AI sparkles, or stock illustrations.
- **No fake proof.** No fake logos, testimonials, user counts, or metrics.
- **Concrete, short copy.** Say what the product does in plain words.

## 2. Color tokens

Tokens live in `app/globals.css` under `:root, :root[data-theme="dark"]`, which is the default theme. A light theme also exists under `:root[data-theme="light"]` with its own values for the same token names. Never hard-code hex values in components. Use `var(--token)`.

### Dark (default)

| Token | Hex | Usage |
|---|---|---|
| `--bg-app` | `#171717` | Page background |
| `--bg-sidebar` | `#141414` | Product frame background |
| `--bg-raised` | `#1f1f1f` | Cards, raised panels |
| `--bg-subtle` | `#1c1c1c` | Chips, segmented controls |
| `--bg-muted` | `#242424` | User message bubble, insets |
| `--hover` | `#2b2b2b` | Hover fill for secondary and ghost controls |
| `--active` | `#242424` | Selected item fill |
| `--border-soft` | `#292929` | Section dividers, header bottom edge |
| `--border` | `#333333` | Card and frame borders |
| `--border-strong` | `#454545` | Secondary button border, inputs |
| `--text` | `#e7e7e7` | Headings, primary text |
| `--text-2` | `#c7c7c7` | Body copy, lede |
| `--text-3` | `#a6a6a6` | Labels, metadata |
| `--text-4` | `#8f8f8f` | Captions, footer meta. This is the lowest text color allowed. |
| `--accent` | `#d97757` | **Primary button and logo fold only** |
| `--accent-fg` | `#171717` | Text on the accent |
| `--brand-terracotta` | `#d97757` | Logo fold (`--logo-fold`) |
| `--logo-body` | `#f0efec` | Logo body |
| `--link` | `#c8c8c8` | Inline links |
| `--focus` | `#9a9a9a` | Focus outline |
| `--disabled-bg` / `--disabled-fg` | `#303030` / `#6f6f6f` | Disabled controls |
| `--danger` / `--success` / `--warning` | `#d97b82` / `#7fa884` / `#c99a5b` | Status only. Never use these for decoration. |

### Accent rule

- `--accent #d97757` is reserved for **the single primary button** and **the logo**. Do not use it for icons, links, kickers, borders, or glows.
- Primary button: background `#d97757`, text `#171717`. On hover the background is `#c4684a`. On active it is `#bf694d`, about 12% darker.
- **Code change needed:** today `.landing-button` uses `--primary-bg #e7e7e7`, which is a light-grey primary, and `--accent-hover` is `#e18768`, which is *lighter*. Point the primary button at the accent, set the hover to `#c4684a`, and add `--accent-active: #bf694d`.
- **Light theme:** keep the primary button at `#d97757` with `#171717` text (5.74:1). Do not use light-theme `--brand-terracotta #c4623a` as the button fill. `#171717` on it measures only 4.40:1, and `#fcfbf9` on it measures 3.94:1. Both fail AA.
- Secondary buttons use a transparent background, `--text` for the label, a 1px `--border-strong` border, and `--hover` fill on hover.

### Measured contrast (WCAG 2.x)

| Pair | Ratio | Result |
|---|---|---|
| `--text #e7e7e7` on `#171717` | 14.5:1 | AAA |
| `--text-2 #c7c7c7` on `#171717` | 10.6:1 | AAA |
| `--text-3 #a6a6a6` on `#171717` | 7.36:1 | AAA |
| `--text-4 #8f8f8f` on `#171717` | 5.54:1 | AA |
| `#d97757` on `#171717` (logo or accent shapes) | 5.74:1 | AA |
| `#171717` on `#d97757` (primary label) | 5.74:1 | AA |
| `#171717` on `#c4684a` (hover) | 4.63:1 | AA |
| `#171717` on `#bf694d` (active) | 4.56:1 | AA. This is the darkest allowed value. |
| `--focus #9a9a9a` on `#171717` | 6.37:1 | Passes 3:1 for non-text |
| `--border-strong #454545` on `#171717` | 1.87:1 | Decorative. The button is identified by its label, not its border. |

## 3. Typography

Fonts are loaded in `app/layout.tsx` through `next/font/google`. Both are variable fonts.

- **Display:** Bricolage Grotesque. Use `--font-display`, consumed as `--font-brand`. It is for H1, H2, H3, and the wordmark.
- **UI:** Onest. Use `--font-sans`, consumed as `--font-ui`. It is for everything else.

Use this fixed scale and nothing else:

| Role | Font | Size | Line height | Weight | Tracking |
|---|---|---|---|---|---|
| H1 | Display | `clamp(40px, 6vw, 80px)` | 1.05 | 550 | -0.04em |
| H2 | Display | `clamp(32px, 4vw, 48px)` | 1.1 | 550 | -0.03em |
| H3 (card title) | Display | 22px | 1.25 | 550 | -0.02em |
| Body / lede | UI | 17px | 1.65 | 400 | 0 |
| Small (nav, buttons, notes, footer) | UI | 14px | 1.5 | 400. Buttons use 550. | 0 |
| Minimum (mock labels, captions) | UI | 12px | 1.4 | 400–550 | 0 |

- Text smaller than 12px is not allowed anywhere, including inside the product mock.
- Use weights 400, 550, and 650 only. Use 650 for the wordmark and uppercase labels.
- Limit measure to `max-width: 38rem` for body and about 12em for headings.

## 4. Spacing and layout

- **Rhythm:** use multiples of 8px: 8, 16, 24, 32, 48, 64, 72, 112. Use 4px only for internal control gaps.
- **Section padding:** `112px` block padding on desktop and `72px` on mobile (≤760px).
- **Card gap:** `24px`.
- **Content column:** `width: min(1120px, 100%); margin-inline: auto; padding-inline: 24px`. On mobile, use `20px` inline padding.
- **One left edge.** The nav, hero, product mock, sections, and footer border all sit on the same content column. The mock must not be wider than the text above it.

## 5. Radius

| Element | Radius |
|---|---|
| Button | 10px |
| Input / control / chip | 8px |
| Card | 16px |
| Product frame (mock) | 20px (16px at ≤760px) |

## 6. Components

**Button** uses `.landing-button` for the primary style and `.landing-button.landing-button-secondary` for the secondary style.

| | Primary | Secondary |
|---|---|---|
| Default | bg `#d97757`, text `#171717`, no border | transparent, text `--text`, 1px `--border-strong` |
| Hover | bg `#c4684a` | bg `--hover` |
| Active | bg `#bf694d` | bg `--active` |
| Focus | global outline (§7) | global outline (§7) |
| Disabled | bg `--disabled-bg`, text `--disabled-fg`, `cursor: not-allowed` | same |

- **Sizes:** use `md` by default (min-height 44px, padding 0 18px, 14px/550). Use `sm` only in the header (min-height 40px, padding 0 14px). On mobile, the minimum height is always 44px.
- Icons come from `lucide-react` at 16px, with `aria-hidden`, and sit after the label (for example `ArrowRight` or `Github`). An icon is optional, and a button gets at most one.
- Use only **one** primary button per viewport.

**Feature card**
- `--bg-raised` background, 1px `--border`, 16px radius, 32px padding (24px on mobile).
- Content order: lucide icon (20px, `--text-3`), then H3, then one body sentence in `--text-2`.
- No accent color, no shadow, and no hover lift. Cards are not links.

**Product frame (mock)**
- Wrap the mock in `aria-hidden="true"`. Real content lives in the surrounding headings and copy.
- If the mock contains text that a screen reader needs, add an sr-only (`.landing-sr`) equivalent outside it. Labels inside the mock are icons plus short text, with sr-only text where needed.
- `--bg-sidebar` background, 1px `--border`, 20px radius, `--shadow-frame`. No glow. Remove `.landing-showcase-glow`.
- All text in the mock is at least 12px. Today `.history-group p` uses 10px, which must be fixed.
- The send button inside the mock stays grey. The mock never uses the accent.
- Show a short, plausible conversation (one user turn, one Nibie turn). The mock is never wider than the content column.

**Header (`SiteHeader`)**
- Sticky, `--bg-app` at 88%, with a `--border-soft` bottom edge. Inner width follows the content column (§4).
- Left side: `Brand` (logo mark and wordmark). Right side: nav links (14px, `--text-2`, hover `--text`), then a **Sign in** text link, then a sm **Try the demo** button.
- The header button uses the **secondary** (outlined) style, so the hero's primary button stays the only accent button in the first viewport. The header button may switch to primary only on pages that have no hero CTA.
- At ≤760px: show `Brand`, then the 44×44 menu toggle (`Menu`/`X` icons). The menu panel lists the links and a full-width primary button.

**Footer**
- Sits on the content column, with a `--border-soft` top border and 32px top / 48px bottom padding.
- One line: **Built by Muhammad Habiibullah · Source on GitHub**. Put it in 14px `--text-4`, and make "Source on GitHub" a link in `--link`.

## 7. Accessibility

- Keep the global focus style in `globals.css`: `outline: 3px solid var(--focus); outline-offset: 2px`. Do not override it per component. For example, `.site-menu-toggle` currently uses 2px, which needs to be aligned.
- Tap targets are at least 44×44px on mobile.
- **Skip link** (`.skip-link`, "Skip to content" → `#content`) is the first focusable element. When it is focused, it shows at `top: 72px`, just below the header, and is left-aligned to the content column.
- Wrap all motion in `@media (prefers-reduced-motion: no-preference)`, and give it a `reduce` fallback with no transform.
- Meet WCAG AA contrast at minimum (see §2). Never put text below `--text-4`.
- Use one `h1` per page and don't skip heading levels. Mark decorative icons `aria-hidden`.

## 8. Responsive

These are the breakpoints in use in `app/landing.css` and `app/globals.css`. Do not add new ones.

| Breakpoint | Use |
|---|---|
| `max-width: 900px` | Multi-column grids collapse to 1 column (landing) |
| `max-width: 760px` | Main mobile breakpoint: 20px gutters, mobile nav, smaller frame, 72px sections |
| `max-width: 480px` | Small-phone tweaks (app UI) |
| `640 / 720 / 1100px` | App-only (chat or settings). Do not use these on the landing page. |

Mobile rules, checked at **390px** wide:
- Hero buttons stack full-width, with the **primary first**.
- Feature cards use 1 column with a 24px gap.
- There is no horizontal scroll, so check `document.documentElement.scrollWidth === 390`.
- The product frame keeps 20px gutters and does not bleed past the content column.

## 9. Copy rules

- Write in English. Keep copy short and concrete, with no hype words ("revolutionary", "supercharge", "seamless").
- Write for first-time visitors: potential users and developers who are evaluating the product and the code.
- The CTA for `/demo` is always **"Try the demo"**. Do not use "Try Nibie", "Get started", or "Open Nibie" for that link.
- The primary CTA stays "Try the demo" until sign-up becomes the main path. The GitHub link (**"View on GitHub"**) stays visible in the hero for developers.
- Do not call Nibie "open source" or "OSS" until a LICENSE file exists in the repo. "View on GitHub" and "Read the source on GitHub" are fine.
- Never claim a feature that does not exist in the code. Check the repo before adding a claim.
- Do not use fake numbers, quotes, or logos.

## 10. Landing page structure (current spec)

1. **Header.** Brand on the left. Nav links, then **Sign in**, then a sm outlined **Try the demo** button (see §6).
2. **Hero**
   - H1: **A personal AI workspace for thinking, writing, and code.**
   - Sub: **Pick fast or deep models per question, keep context in Rooms, and pick up any conversation where you left it.**
   - Buttons: primary **Try the demo** (`/demo`) and secondary **View on GitHub** (repo URL).
   - Note (14px, `--text-4`): **No sign-up. The demo uses recorded replies.**
3. **Product mock.** A dark chat window on the content column with a sidebar of recent chats, one user turn, one Nibie reply, and a composer with Fast / Balanced / High chips.
4. **Features: "What Nibie does."** Three cards:
   - **Rooms**: keep a project's context, files, and threads together.
   - **Fast or deep, per question**: choose Fast, Balanced, or High for each message.
   - **Pick up where you left off**: conversations are saved, so you can return to the same thread.
5. **How it's built.** Intro line: **A full-stack TypeScript app. Read the source on GitHub.** Stack list, verified against the repo:
   - Next.js (`next`) with React
   - Fastify API (`apps/api`)
   - Supabase Postgres + Drizzle ORM (`drizzle-orm`, `drizzle-kit`)
   - Vitest + Playwright (`vitest`, `@playwright/test`)
6. **Final CTA.** H2 **See it in 30 seconds.** followed by the primary **Try the demo** button. It is the only accent button in that viewport.
7. **Footer.** **Built by Muhammad Habiibullah · Source on GitHub**
