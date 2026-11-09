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
system light/dark themes. Pairing requires the app to be served by your
LocalPilot gateway at its trusted HTTPS address; the HTTP preview cannot pair
and does not proxy the gateway. Session attachment, answering requests,
notifications and offline support are still being built.

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

`npm run build` writes `dist/`; `npm run verify:bundle` verifies its complete
file set and hashes. `npm run build:release` requires a clean checkout. CI tests
and compares bundles on Linux, Windows and macOS. See the
[bundle contract](docs/bundle.md) for gateway import, integrity and cache rules.

Part of the [LocalX](https://c0degeek-dev.github.io/LocalStack/) stack.

## License

PolyForm Noncommercial 1.0.0; see [LICENSE](LICENSE) and
[LICENSING.md](LICENSING.md).
