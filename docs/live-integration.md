# Terminal Pi Live Integration

Pi Web can observe ordinary interactive Pi 0.82.1 TUI processes in the existing session view. Persisted JSONL remains authoritative; transient events are held only in the Live Hub and browser memory.

## Install and lifecycle

```bash
pi-web integration status
pi-web integration install       # interactive TTY confirmation
pi-web integration install --yes # explicit automation
pi-web integration repair
pi-web integration uninstall
```

The artifact is copied atomically to `~/.pi/agent/extensions/pi-web-companion/`; it is not linked to a checkout. Its manifest records the exact Pi, Pi Web, Companion and Hub protocol versions plus a SHA-256 artifact hash. Restart already-running Pi processes after install, repair, uninstall, or Pi upgrade.

The Companion is active only in Pi's `tui` mode. RPC, print and JSON processes—including Pi Web's embedded runtime—are no-ops. If Pi Web or its Live Hub is absent, terminal Pi continues normally.

Linux and macOS use a user-private Unix socket. Windows keeps all historical and Web-managed functionality but does not support Live Integration in this release.

## Shared Control

A Live Session opens as Observer. Enable **Shared Control** explicitly in that page. Permission is bound to the page client, observed instance and Session Record, is held only in browser memory, and is lost on refresh or attachment changes. Unsupported operations remain disabled rather than creating another runtime.

## Network authentication

Loopback startup remains login-free unless a password was deliberately configured. A non-loopback bind refuses to start without an administrator password:

```bash
pi-web auth set-password
# or for first setup only
PI_WEB_PASSWORD='a-long-secret' pi-web -H 0.0.0.0
```

An existing stored hash takes precedence over `PI_WEB_PASSWORD`; the environment cannot overwrite it. Password changes invalidate existing login cookies. Authentication protects pages, APIs, SSE, files and configuration through the central request boundary.

## Troubleshooting

- `pi-web integration status` reports missing, modified, or version-mismatched artifacts.
- Restart the terminal Pi after installing the Companion.
- A second terminal attached to the same Session Record is rejected from integration, but Pi Web cannot prevent that terminal from independently writing the file.
- A disconnected observed runtime reserves its claim for about two minutes. Pi Web does not silently create a fallback runtime during that period.
- Live Integration failures never make persisted session browsing unavailable.
