# Client bundle contract

LocalPilot serves this build at the gateway origin root. The browser makes no
third-party runtime loads. This version supports pairing by camera QR scan or
manual entry and snapshot-first shared-session attachment with acknowledged
input, Stop, typed slash commands and acknowledged phone approvals. Attention
covers requests in the attached shared session. Devices shows this phone and
can revoke its access. Push has explicit opt-in, test and off controls. Offline
caching holds the static app shell only; session data stays in the live window.

## Build and identity

Use Node from `.node-version`, then `npm ci --ignore-scripts` and
`npm run build:release` in a clean checkout. Development builds (`npm run build`)
allow changes and mark `source_dirty: true`; they must not be pinned for shipping.
The output is the complete `dist/` tree. No network access or third-party package
is needed by the build itself. ESLint is development-only.

ESLint and `@eslint/js` are held at exact version 9.39.5 while the 10.x
dependency tree has the minimatch advisory GHSA-g3hv-75wg-m249. This older
line is deprecated upstream; its locked tree currently audits clean. Revisit
the pin at the next dependency pass rather than overriding upstream glob
dependencies. Neither tool enters the browser bundle.

`bundle.json` is UTF-8 JSON with a final LF. Its schema is:

| Field | Meaning |
| --- | --- |
| `schema_version` | `1` |
| `version` | Client version from `VERSION`, checked against `package.json` |
| `source_revision` | Full 40-character Git HEAD revision |
| `source_dirty` | Whether tracked or untracked source changes existed |
| `client_status` | `sessions`; shared-session viewing and acknowledged controls |
| `protocol.min`, `protocol.max` | Inclusive RPC version range, currently `1` |
| `protocol.required_capabilities` | `acks`, `resume`; `commands` is optional, mutation retry is unused |
| `files` | Sorted array of `{path, sha256, bytes, content_type}` for every served file |

Paths are relative, use `/`, and contain no traversal or leading slash. SHA-256
is lowercase hex over exact file bytes. The manifest does not list itself:
the consumer separately pins **SHA-256 of `bundle.json`**, together with the
source revision. MIME types are restricted to `text/html; charset=utf-8`,
`application/javascript; charset=utf-8`, `text/css; charset=utf-8`,
`application/manifest+json`, `image/png`, and `image/svg+xml`.

The consumer must verify the pinned manifest digest, clean provenance, revision,
every file's size/digest/type/path, and the exact file set before embedding or
serving anything. A digest from the same untrusted download is not a trusted pin.
Serve only listed paths; do not treat unknown API or asset paths as SPA routes.
`bundle.json` is import metadata, not required as a browser route.

Text inputs normalize CRLF to LF; binary PNG files are copied unchanged.
Content-addressed asset directories derive from the sorted source bytes.
There are no timestamps, machine paths, random values or archive metadata in
the bundle. CI verifies Windows/Linux/macOS output equality. CI download ZIP
wrappers are transport only: their bytes are not the bundle identity.

## Serving and updates

Map `/` to `index.html`. Revalidate `/`, `/index.html` and
`/manifest.webmanifest` (`Cache-Control: no-cache`); content-addressed
`/assets/<digest>/...` may use `public, max-age=31536000, immutable`.
Use the manifest MIME types and `X-Content-Type-Options: nosniff`.
The shell works with external same-origin scripts/styles and a restrictive
CSP; no inline script or style, remote font, CDN or telemetry is needed.

Replace the complete pinned tree atomically when upgrading or rolling back.
`/push-worker.js` is a stable root URL, listed and verified in the bundle, served
with `Cache-Control: no-cache`. It registers with scope `/` for the offline shell,
independently of notification permission. A build-injected, integrity-checked list
contains only the complete generation's HTML, manifest and content-addressed assets.
Failed install leaves the old worker intact. The fetch handler serves the pinned
shell for same-origin root document navigation and exact listed assets only;
API/auth/pairing/session responses, worker downloads, non-document HTML fetches,
query URLs and mutations pass through without interception. No dynamic cache writes.

The waiting update is announced without reload, `skipWaiting` or `clients.claim`.
Finish or copy drafts, close every LocalLink browser tab and close the installed
app from Android recent apps, then reopen. Background clients can delay activation;
an incompatible old shell may need these steps before it can control the PC again.
Drafts remain safe in the existing window but are not persisted across closing or
reload. Natural activation deletes only old `locallink-shell-` caches after old
controlled windows close. Other applications' caches are untouched. A missing cached
asset fails closed rather than loading bytes from a different generation.

## Browser/server boundary

The gateway issues a Secure, HttpOnly, SameSite=Strict `__Host-` credential.
Script must never read or store that credential. Pairing tokens belong only in
the QR URL fragment and exchange POST body. Workspace discovery is the
gateway's responsibility; all authorization remains on the PC.

Pairing links use `https://<gateway>/#pair=<code>&w=<workspace-id>`. LocalLink
removes the fragment immediately, validates the exact current HTTPS origin,
and requires explicit confirmation before `POST /api/pair` with JSON
`{code, workspace}`. The response supplies `{device_id, scope}`; the credential
is only in the gateway's `Set-Cookie`. A subsequent `GET /api/workspaces`
confirms the browser retained an accepted credential. All requests use
same-origin credentials, bypass caches and refuse redirects. No code, cookie,
or API result is persisted by the client.

The gateway must accept browser same-origin reads without an `Origin` header;
JavaScript cannot supply that header itself. A gateway requiring `Origin` on
GET will show the address-refused state rather than confirming pairing.
POST and WebSocket origin validation remains the gateway's responsibility.

Code rejection groups expired, used, invalid and PC-cancelled codes because
the gateway deliberately returns the same refusal for them. The UI distinguishes
that refusal from an origin mismatch, throttling, missing/offline workspace,
cookie refusal, inaccessible PC and unknown exchange outcome. Within the same
page lifetime, a previously confirmed phone losing access is labelled as such;
after reload, a missing or revoked credential opens the ordinary pairing flow.
If a new pairing exchange fails on an already paired page, a read-only check
confirms whether the existing cookie still works. Confirmed access stays paired,
with the new code's failure shown separately.
Throttling honours
`Retry-After`; there are no automatic POST retries. Revocation is detected on
the next explicit access check or authenticated session-list refusal; a socket
close locks controls, without guessing whether it was a revocation or a network
failure.

`GET /api/workspaces` supplies `{scope, workspaces}`; each workspace has an
`id`, `label`, and `online`. Scope is `control`, `observe`, or null. A returning
phone with missing/null scope cannot mutate. A same-page pairing may retain
the scope from its successful exchange when an older gateway omits the field;
an explicit null always removes control. LocalPilot `ea8b041` supplies scope.
Session metadata comes from `GET /api/sessions?workspace=<id>`; only a user-picked
live session opens `wss://<same-origin>/api/socket?workspace=<id>&session=<id>`.
The gateway sends `attached` and `snapshot`; the client sends no `attach`,
`hello`, `status`, or new-session command on this already-bound relay.

RPC records use `{v: 1, id, command: {type, ...}}`; replies are
`{v: 1, id?, seq?, event: {type, ...}}`. Matching session identity, epoch,
`acks` and `resume` capabilities plus a snapshot are required before controls.
Product `server_version` is diagnostic: RPC version and advertised capabilities
decide compatibility. A newer wire version asks the user to reopen/update the app;
an older wire version or missing required capability asks them to update LocalPilot
on the PC. Compatible product releases and unknown additive capabilities work.
The verified snapshot owns its epoch: a newer mirror install can overtake the
resync notice that prompted it. Temporary unknown/empty boundary snapshots
leave the previous transcript visible as stale, with controls locked, until
a usable snapshot or authoritative turn boundary arrives. A healthy unknown mirror
stays attached beyond the initial 15-second transport deadline, with manual
Reconnect available. The PC's own lost turn state can stay unknown until its next
turn. Server-to-source snapshot recovery is a separately owned server change.
Idle snapshot `turn_text` is omitted from the view
because it repeats the completed assistant message in stored history.
The `commands` capability enables a catalogue request and typed
`run_command {name, args}`. Device input supports `immediate` and `follow_up`;
the shared relay refuses `steer`. Accepted/queued/rejected and command-result
replies correlate by ID. Only snapshot/live feed events change turn status;
reply delivery can race the feed. Sequence gaps alone are legal due to filtering.
Resync locks controls until a new snapshot; disconnects require manual fresh
attachment. No mutation is retried, including after a timeout or lost reply.
Reconnect deliberately sends no cursor: a same-epoch cursor gets replay without
a completion marker from the current gateway. A complete snapshot reconciles
history, epoch, cursor, asks and admission before controls unlock. Reconnecting
to the same session retains the previous transcript and last-sync time as stale.
Closed shared terminals offer Back to sessions; resume the same history or start
a new session on the PC, then share it. The phone cannot create or resume a closed
terminal on its own.

The snapshot contains transcript text, not historical tool groups. Local tool
activity is explicitly for the turn in progress. Phone input is echoed
after acknowledgement; input typed on the PC is available after another
snapshot. Drafts are in-memory and per-session; API responses are never cached.

Camera access is user-initiated, QR support is feature-detected with
`BarcodeDetector.getSupportedFormats()`, and unsupported browsers retain manual
entry. Tracks stop on a decoded result, cancellation, navigation, page hide or
camera failure. A permission or decoder reply arriving after cancellation
cannot revive the scan. No third-party runtime decoder is loaded.

The push contract is:

- `GET /api/push?workspace=<encoded-id>` → `{public_key, key_id}`.
- `POST /api/push?workspace=<encoded-id>` with JSON
  `{op: "subscribe", endpoint, p256dh, auth, key_id}` or `{op: "unsubscribe"}`
  → `{subscribed: true|false}`.
- After a key rotation, subscribe again with the new key and `key_id`.
- Test: POST the same route with `{op: "test"}` → `{sent: true}` after
  the real push service accepts the send. This does not prove phone display.
  409/410 asks the user to enable again; 503 means PC push is disabled;
  429 means wait (server limits tests to once per 30 seconds); 502 means
  the service refused or could not be reached.

`GET /api/device` lists only this verified device:
`{id, name, scope, this_workspace_only, paired_unix}`. Managing other devices
remains on the PC. POST `/api/device/revoke` with an empty body returns
`{revoked: true}` and clears the credential cookie. A lost revoke response
triggers one read-only device probe; 401 confirms access ended. No POST retry.
These endpoints, test push and typed relay expiry refusals require LocalPilot
`8a32160` or newer. LocalPilot embedding/repinning is a separate server task.

Approvals send `{type: "permission_reply", ask_id, allow}` over the bound relay.
The sheet retains submitting until correlated `accepted` or `rejected`; feed
resolution alone does not acknowledge this phone's submission. `already_resolved`,
`expired` and `unknown_ask` produce distinct terminal states. Deadline display
locks late taps; the PC decides the actual outcome. Resync, unknown scope and
disconnect lock answers; no approval is replayed. Each sheet names project and
session, shows exact detail/risk/expiry, and offers only Deny and Allow once.

Ask for notification permission only after pairing and a separate user action.
Browser permission alone does not prove a registered or working subscription.
Notifications carry generic text; opening one refetches state and never approves.
Enable/re-enable explicitly registers against the selected project's current
key; reloads do not silently register. The UI reports unconfirmed until that
registration is acknowledged. Off unregisters on the server for the selected
project, retaining the browser subscription because other projects may use it.
No subscription endpoint, keys or API results are persisted by page scripts.

## Tooling references

- [Node test runner](https://nodejs.org/docs/latest-v24.x/api/test.html)
- [ESLint flat configuration](https://eslint.org/docs/latest/use/configure/configuration-files)
- [Web app manifest](https://www.w3.org/TR/appmanifest/)

Source, tests, copy and icon geometry are original. The PNG icons are raster
versions of the two overlapping rounded squares in `src/icon.svg`.
