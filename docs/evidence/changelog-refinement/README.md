# Changelog refinement evidence

Captured locally from the PR worktree based on `main` at `2a881e7` (the merged staging snapshot).

- `changelog-*-dark.png` and `changelog-*-light.png`: public `/changelog` at 1440px desktop and 390px mobile.
- `whats-new-empty-*.png`: in-app Help → What’s new at desktop and mobile. At capture time the panel had no fallback, so with no shipped release it showed the empty state; no version or date is fabricated. What's new now falls back to the Unreleased highlights, marked In progress, so these screenshots are historical.

Earlier UI QA used an uncommitted release fixture to exercise version/date/highlights/New/read-state behavior. That fixture is not included; the screenshots here show the empty state with `CHANGELOG.md` as it was at capture time.
