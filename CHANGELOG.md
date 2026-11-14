# Changelog

## 0.1.0 — unreleased

- Add a tablet/desktop project sidebar, an independently scrolling conversation
  and an always-reachable composer. Open sessions at their latest message,
  follow live output without interrupting a reader scrolling back, and offer a
  Latest messages action. Show loading placeholders, immediate message delivery
  feedback and visible sending/thinking/response/tool/approval states. Keep
  rejected or uncertain messages and drafts without retrying. Add responsive
  browser checks and delivery-race regression tests.

- Follow the system appearance with a saved Light/Dark override in Devices.
  Improve contrast, large text, touch targets, keyboard and approval focus;
  preserve conversation nodes during streaming and announce completed replies
  without reading every token. Add automated browser accessibility checks.

- Cache only the complete static shell for offline use; announce app updates
  without taking over open windows. Keep the last view and draft through
  reconnect, lock controls until fresh state arrives, and keep unknown mirrors
  attached. Explain incompatible client/server protocols before any action.

- Add a phone-sized preview shell with Sessions, Attention and Devices navigation
  and system light/dark themes.
- Add a deterministic, revision-labelled bundle with per-file integrity metadata,
  Node tests, ESLint and cross-platform CI.
- Add camera/manual pairing with a browser-managed HttpOnly credential.
- Follow shared terminal sessions with conversation text, live tool activity,
  plans and project-labelled controls. Send, queue follow-ups, stop a turn and
  invoke advertised slash commands through the typed command route. Observe
  access and unconfirmed state keep controls locked; lost mutation replies
  show an unknown outcome and are never retried automatically.
