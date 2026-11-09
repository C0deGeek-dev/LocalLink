# Client bundle contract

LocalPilot serves this build at the gateway origin root. The browser makes no
third-party runtime loads. This version is a **scaffold**, with local navigation
only: pairing, RPC attachment, session controls, push and offline support are
not implemented. The manifest's protocol range records the intended connection
contract, not a claim that this build can attach.

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
| `client_status` | `scaffold`; no live session support yet |
| `protocol.min`, `protocol.max` | Intended inclusive RPC version range, currently `1` |
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
