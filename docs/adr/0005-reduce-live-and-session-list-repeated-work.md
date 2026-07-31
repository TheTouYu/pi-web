# ADR 0005: Reduce Live and Session-List Repeated Work

## Status

Accepted

## Context

Pi Web must remain responsive while multiple terminal Pi processes are active. Two independent hot paths were doing repeated work:

- Live Hub presence snapshots were broadcast for every incremental event, even when online/busy state had not changed. This caused the browser-facing running-session SSE stream to resend identical state during normal model-output updates.
- Session-list refreshes could reparse every historical JSONL file after the metadata cache expired. The list endpoint also transferred the complete first user message even though the sidebar only displays a short preview.

Live events are best-effort transient activity and must continue to be forwarded at Pi's native incremental cadence. JSONL files remain the authority for persisted session history.

## Decision

1. Deduplicate only complete Live Hub presence snapshots. Forward every ordinary Live event unchanged.
2. Send the Hub's presence snapshot included in a successful subscribe response before waiting for a later push, closing the subscription race.
3. Deduplicate running-session SSE updates by the sorted set of running session IDs while retaining the initial frame and heartbeat.
4. Cache session-file metadata by JSONL path, modification time, and size. Reuse unchanged entries, reread changed files, remove deleted files from the next cache, and prevent an older concurrent scan from replacing a newer cache generation.
5. Limit the session-list `firstMessage` preview to 50 characters at the server boundary.
6. Keep the changes in the existing Hub/session-reader paths and cover the behavior with focused regression tests.

## Consequences

- Stable presence no longer creates repeated browser updates during ordinary message streaming.
- Incremental Live activity remains lossless at the Hub forwarding boundary.
- Session-list refreshes avoid reparsing unchanged conversation history and send substantially less JSON.
- A changed or deleted JSONL file is still reread or removed; the cache is an optimization, not a source of truth.
- The list API intentionally exposes only a preview, not the complete first message.

## Verification

The implementation was checked against real session data and the local browser:

- Running SSE changed from roughly 27.7 frames/second with only two payloads to one initial frame over ten seconds when state did not change.
- Session-list cache expiry dropped from roughly 4.94 seconds to roughly 0.156 seconds in the measured workload.
- The session ID set stayed identical across old and new implementations; key metadata had zero differences.
- Session-list JSON dropped from roughly 784 KiB to roughly 190 KiB.
- TypeScript, lint, focused and full enumerated regression tests, and `git diff --check` passed.
- The production global `pi-web` instance was rebuilt from the current source in a temporary directory, restarted, returned `200`/`{"ok":true}` from `/api/health`, returned one running-SSE frame in five seconds, and loaded in the browser without horizontal overflow.

## Operational Note

The user-facing process is launched from the global package, not the checkout. Applying this change there requires a production build outside the checkout, replacing the global package's `.next` and `bin/live/hub.js`, then restarting with:

```bash
/home/h/.npm-dlabal/bin/pi-web --no-open
```

Do not run `next build` in the development checkout during normal development; use an isolated temporary build directory for this deployment path.
