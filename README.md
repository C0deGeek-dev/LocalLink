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
system light/dark themes. It cannot pair, attach to a session, answer requests,
send notifications or work offline yet. Preview serving binds only loopback
and does not proxy the gateway.

`npm run build` writes `dist/`; `npm run verify:bundle` verifies its complete
file set and hashes. `npm run build:release` requires a clean checkout. CI tests
and compares bundles on Linux, Windows and macOS. See the
[bundle contract](docs/bundle.md) for gateway import, integrity and cache rules.

Part of the [LocalX](https://c0degeek-dev.github.io/LocalStack/) stack.

## License

PolyForm Noncommercial 1.0.0; see [LICENSE](LICENSE) and
[LICENSING.md](LICENSING.md).
