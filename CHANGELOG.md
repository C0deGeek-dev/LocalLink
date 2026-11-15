# Changelog

## 0.1.3 — unreleased

- Say "device" instead of "phone" wherever any paired browser is meant
  (pairing, access, notifications and revocation copy). LocalHub#287.

- Keep the open session's name current: a refreshed project list, the snapshot
  and a live `session_renamed` record update the header and the list without
  reattaching, and a completed `/name` or `/rename` reads the list back.
  LocalHub#289.

- A notification tap opens the place its kind belongs to: an approval request
  opens Attention, a finished turn opens Sessions, a test opens Devices. Only the
  kind is read from the push; the visible text stays generic and links in a
  payload are never followed. LocalHub#290.

## 0.1.2 — unreleased

- Restyle the app after the LocalX site: near-black surfaces with a teal signal
  colour, monospace labels, a refreshed light palette and a new icon. Give phones
  most of the screen for the conversation: one compact header with app status,
  a one-row session header with a back button that opens the session list as a
  sheet, a single-row composer that grows with the draft, and the bottom
  navigation hidden while typing. Draw icons in CSS so no images are loaded
  outside the app's own files.

## 0.1.1 — unreleased

- Automatically activate complete verified app updates and refresh open windows,
  including clients still using the earlier cache-first worker. Check on open,
  focus, reconnect and while visible. Include the app version in asset/cache
  identity and show the installed version. Retain one complete offline shell;
  incomplete updates cannot replace it. Hand drafts to the updated tab without
  replaying input or approvals; disclose any unconfirmed action. Add real browser
  upgrade tests covering multiple tabs, version-only changes and failed installs.

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
