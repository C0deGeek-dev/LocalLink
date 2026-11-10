# Accessibility

LocalLink follows the device's light/dark appearance by default. Devices →
Appearance offers Follow system, Light and Dark. The browser saves only this
appearance preference when storage is available. With storage blocked the choice
still works for the current page. Returning to Follow system removes the saved
override and responds to system changes while the app is open.

Controls have at least 48 × 48 CSS pixel targets. Text uses scalable units;
conversation prose wraps, while code and tool output scroll independently and
can receive keyboard focus. Status uses words as well as styling. Reduced-motion
preferences disable animations, transitions and smooth scrolling. At narrow widths
the composer and navigation remain in normal document flow to avoid covering text.

Keyboard navigation includes Skip to content, destination heading focus, native
disclosure controls and an approval dialog. Opening an approval focuses the request
heading; Escape or Close dismisses it without answering. Focus returns to the
request button, or the Attention heading when that request is no longer present.
The dialog keeps the project, exact detail, risk and expiry above the answer buttons.

The conversation is not a live region. A separate polite announcement reports a
completed reply once; token text is never announced automatically. Status messages
change only when their content changes. Existing conversation nodes, expanded
activity groups and request buttons survive streaming updates. Unchanged stored
messages survive a sliding history snapshot; identical repeated messages have no
server-supplied identity, so removing one of several identical occurrences remains
ambiguous. Reconnect establishes a new baseline rather than announcing old replies
as newly finished.

## Automated verification

Use Node 24, then:

```text
npm ci --ignore-scripts
npm run check
npx playwright install chromium
npm run check:a11y
npm run verify:bundle
```

To use an already installed Edge instead of downloading Chromium:

```text
npm run check:a11y -- --channel=msedge
```

The browser check serves the built bundle through intercepted HTTPS routes in a
fresh isolated browser context, simulates API/socket responses, and blocks service
workers. It never contacts a real gateway or uses personal credentials. Playwright
and axe-core are development dependencies and are excluded from the client bundle.
Linux CI runs this check with Playwright's Chromium alongside the normal checks.

The 2026-11-10 local run passed 58 Node tests and 22 axe scans in headless Edge:
320 CSS pixels wide; light/dark; normal/doubled root text for pairing, session,
Attention, approval and Devices; plus disconnected retained state at doubled text.
The check asserts no horizontal page overflow, 48-pixel control targets, skip-link
and navigation focus, stable focused code through streaming and a sliding snapshot,
stable request buttons, dialog Escape/return focus, one completion announcement per
turn including a short turn between render frames, persisted theme override and
live system-theme changes. Reduced motion is enabled during these runs.

No axe violations were reported. Axe leaves contrast on clipped code or dialog
detail for manual review in some states; the check additionally asserts actual
computed foreground/background contrast of at least 4.5:1 on code, approval detail
and navigation. Screenshots were inspected for wrapping and readable surfaces.
This is not a WCAG certification or proof of screen-reader behavior on Android.
Set `LOCALLINK_A11Y_OUTPUT` to a local output directory to retain JSON and screenshots.

## Android TalkBack walkthrough — pending

No real TalkBack walkthrough has been performed or recorded. Use a trusted HTTPS
phone address and an attended PC session. Record Android version, phone model,
Chrome version, TalkBack version, client revision, date, and a recording location.
Hide pairing codes, private conversation and commands before sharing a recording.

1. Enable TalkBack and screen recording with spoken feedback captured. Start with
   the system theme and default text size. Swipe through Sessions: confirm headings,
   manual pairing labels/help, scan action and camera-denied/manual recovery are read.
   Pair explicitly; confirm the address and scope are understandable.
2. Choose a project and shared session. Explore a stored message and code block,
   then let the PC stream a reply with tools. Reading focus must stay on the current
   message; no token-by-token announcements. Expand Tool activity and read output.
   Confirm one completed-reply announcement after the turn ends.
3. Send a harmless message, queue a follow-up, and Stop a disposable turn. Check
   project labels, acknowledgement/unknown-outcome wording and disabled-control
   reasons. Never infer a successful action from the initial tap alone.
4. Open Attention, then a disposable approval request. Confirm heading entry,
   project/detail/risk/expiry before Deny and Allow once, close without answering,
   and return focus. Reopen and exercise a safe denial and a PC-side resolution race;
   confirm the authoritative outcome is spoken without duplicated announcements.
5. Disconnect the phone network. Confirm stale-view wording, readable history and
   locked controls. Restore it and reconnect: retain the draft, reconcile first,
   and never repeat a mutation. Check that new content can be explored after reconnect.
6. Open Devices. Switch Light, Dark and Follow system; change the Android theme
   while the app is open and reload a manual override. Increase Android font/display
   size and browser text scaling. Repeat all destinations and the long approval;
   every control must remain reachable, with no hidden or overlapping text.
7. Enable Android's reduced-motion preference and repeat navigation/disclosures.
   If a hardware keyboard is available, repeat Tab/Shift+Tab, Enter/Space and dialog
   Escape. Record observations, unexpected speech/focus, fixes and a repeat result.

Keep real-device accessibility acceptance open until the recording and observed
results exist. The isolated browser checks do not replace it.
