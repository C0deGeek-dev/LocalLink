# Client bundle contract

LocalPilot serves this build at the gateway origin root. The browser makes no
third-party runtime loads. This version supports pairing by camera QR scan or
manual entry and snapshot-first shared-session attachment with acknowledged
input, Stop and typed slash commands. Push, phone approval and offline caching
are not implemented.

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
| `protocol.required_capabilities` | `acks`, `resume`, `retry`, `commands` |
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
No service worker is registered yet. Offline caching and safe update prompts
must arrive with reconciliation and draft protection; do not add unconditional
`skipWaiting`, cached API responses or an offline mutation queue.

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
The verified snapshot owns its epoch: a newer mirror install can overtake the
resync notice that prompted it. Temporary unknown/empty boundary snapshots
leave the previous transcript visible as stale, with controls locked, until
a usable snapshot arrives. Idle snapshot `turn_text` is omitted from the view
because it repeats the completed assistant message in stored history.
The `commands` capability enables a catalogue request and typed
`run_command {name, args}`. Device input supports `immediate` and `follow_up`;
the shared relay refuses `steer`. Accepted/queued/rejected and command-result
replies correlate by ID. Only snapshot/live feed events change turn status;
reply delivery can race the feed. Sequence gaps alone are legal due to filtering.
Resync locks controls until a new snapshot; disconnects require manual fresh
attachment. No mutation is retried, including after a timeout or lost reply.

The snapshot contains transcript text, not historical tool groups. Local tool
activity is explicitly for the turn in progress. Phone input is echoed
after acknowledgement; input typed on the PC is available after another
snapshot. Drafts are in-memory and per-session; API responses are never cached.

Camera access is user-initiated, QR support is feature-detected with
`BarcodeDetector.getSupportedFormats()`, and unsupported browsers retain manual
entry. Tracks stop on a decoded result, cancellation, navigation, page hide or
camera failure. A permission or decoder reply arriving after cancellation
cannot revive the scan. No third-party runtime decoder is loaded.

The push contract reserved for the notification implementation is:

- `GET /api/push?workspace=<encoded-id>` → `{public_key, key_id}`.
- `POST /api/push?workspace=<encoded-id>` with JSON
  `{op: "subscribe", endpoint, p256dh, auth, key_id}` or `{op: "unsubscribe"}`
  → `{subscribed: true|false}`.
- After a key rotation, subscribe again with the new key and `key_id`.

Ask for notification permission only after pairing and a separate user action.
Browser permission alone does not prove a registered or working subscription.
Notifications carry generic text; opening one refetches state and never approves.

## Tooling references

- [Node test runner](https://nodejs.org/docs/latest-v24.x/api/test.html)
- [ESLint flat configuration](https://eslint.org/docs/latest/use/configure/configuration-files)
- [Web app manifest](https://www.w3.org/TR/appmanifest/)

Source, tests, copy and icon geometry are original. The PNG icons are raster
versions of the two overlapping rounded squares in `src/icon.svg`.
