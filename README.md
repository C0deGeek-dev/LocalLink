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

Part of the [LocalX](https://c0degeek-dev.github.io/LocalStack/) stack.

## License

PolyForm Noncommercial 1.0.0; see [LICENSE](LICENSE) and
[LICENSING.md](LICENSING.md).
