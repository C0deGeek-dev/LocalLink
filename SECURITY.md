# Security Policy

## Supported Versions

LocalLink has no release yet. Once it does, security fixes land on the latest
release; earlier releases are not maintained.

## Reporting Security Issues

Until a public security contact exists, report issues privately to the repository
owner. Do not open public issues for vulnerabilities involving device
credentials, pairing, session content exposure or the gateway connection.

## Security Scope

Security-sensitive areas:

- pairing and the device credential (kept only in a `__Host-` cookie)
- what the app stores on the phone, and clearing it when access is revoked
- rendering session content (text from the session is untrusted and is never
  treated as markup or instructions)
- permission answers and turn cancels sent from the phone
- push notifications (content-free and opt-in)

## Security Defaults

- No telemetry, no analytics and no third-party scripts.
- The app talks only to the gateway address it was paired with.
- A revoked device loses access at once; the app clears session data it holds.
