# LocalLink

LocalLink is the phone companion for [LocalPilot](https://github.com/C0deGeek-dev/LocalPilot):
a web app, installable on your phone, that attaches to a LocalPilot session
running on your own computer. Follow the session, answer its permission
requests, send follow-ups and cancel a turn from the phone, while the session
keeps running in the terminal that owns it.

There is no LocalX server, account or domain in between. The phone reaches the
LocalPilot gateway on your computer through an HTTPS address you control (for
example your own Tailscale network; see `localpilot remote setup`), using a
device credential issued by pairing with your computer.

Status: not yet usable. The client is under construction; nothing here is
released.

## Development

Use Node 24 (the reproducible CI version is in `.node-version`).

```text
npm ci --ignore-scripts
npm run check
npm run preview
```

Open `http://127.0.0.1:4173`. This local preview has three destinations and
system light/dark themes with a manual choice under Devices → Appearance.
Only the appearance choice is saved in browser storage; drafts and session
state stay in memory. Pairing requires the app to be served by your
LocalPilot gateway at its trusted HTTPS address; the HTTP preview cannot pair
and does not proxy the gateway. The preview can cache its static shell; live
sessions, approvals and notifications require the gateway.

Accessibility verification and the Android TalkBack walkthrough are documented
in [docs/accessibility.md](docs/accessibility.md). Automated checks use isolated
browser fixtures and do not establish real-device acceptance.

## Pairing

Open the app at the HTTPS address shown by LocalPilot on your computer.
Keep the PC’s pairing screen open. Scan its QR code using your phone camera
or LocalLink’s **Scan QR code**, or paste the complete pairing link into
**Pairing link or code**. For a bare code, also enter its workspace ID.
Check the PC address, then choose **Pair this phone**. LocalLink shows the
granted observe/control scope after the gateway confirms access.

Scanning inside the app requires a browser with native QR detection. If the
camera is unavailable or permission is denied, use manual entry. No camera
permission is requested until you choose to scan.

The gateway keeps the device credential in a Secure, HttpOnly, SameSite=Strict
`__Host-localpilot-device` cookie. Client script never reads that credential or
stores pairing codes. A code is exchanged once, only after confirmation. If a
reply is lost, LocalLink checks access without repeating the exchange. Use
**Check connection** to verify access again; create a fresh PC code if access
was revoked or a code has expired, been used, or been closed on the PC.

## Following a session

After pairing, choose a project, then a shared terminal session. The phone
follows the session already open on your PC; it cannot start a new session.
Closing that terminal ends phone access to the session.

The conversation shows stored text and live assistant output. Expand **Tool
activity** for tools received live during the turn in progress, or **Session
plan** for the current plan. Past tool activity is unavailable. Messages typed
on the PC appear when the next snapshot arrives; messages sent from
this phone are labelled locally after the PC acknowledges them.

Control access offers **Send** when idle, **Follow up** while working, and a
separate **Stop turn** labelled with its project. Device steering is unavailable.
**Slash commands** comes from the PC's advertised catalogue. Commands use a
typed route; unknown slash text is refused and never sent as a model prompt.
While working, only `/effort` is available from the picker. Open Attention to
review requests and answer them after the PC confirms the current session state.

Controls stay locked until a compatible attachment and snapshot arrive, and
when scope or turn state is unknown. Observe access can only view. A lost
connection keeps the displayed view and unsent draft in this page, with the
last-sync time. **Reconnect** fetches a new snapshot; it never resends input.
If a mutation reply is lost, its outcome is explicitly unknown: check the PC
before sending again. Drafts are held in memory per session, and disappear on
reload or when access is revoked. There is no offline queue or automatic retry.

The app shell works offline after it has been installed successfully by the
browser. It never stores pairing, authentication or session responses. An offline
reload opens the shell; reconnect to the PC to retrieve session data. If the PC
reports unknown turn state, the phone stays attached with controls locked and the
previous view dimmed until authoritative state arrives.

Updates are announced without interrupting drafts or approvals. Finish or copy
your drafts, close every LocalLink browser tab and close LocalLink from Android
recent apps, then reopen. Drafts are not saved after closing or reloading. A
protocol mismatch explains whether to update the app or LocalPilot on the PC.

The gateway must report device scope in `GET /api/workspaces` (LocalPilot
`ea8b041` or later). Older gateways can pair, but returning phones without a
reported scope keep their controls locked.

`npm run build` writes `dist/`; `npm run verify:bundle` verifies its complete
file set and hashes. `npm run build:release` requires a clean checkout. CI tests
and compares bundles on Linux, Windows and macOS. See the
[bundle contract](docs/bundle.md) for gateway import, integrity and cache rules.

Part of the [LocalX](https://c0degeek-dev.github.io/LocalStack/) stack.

## License

PolyForm Noncommercial 1.0.0; see [LICENSE](LICENSE) and
[LICENSING.md](LICENSING.md).
