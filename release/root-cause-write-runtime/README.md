# Root-cause production write runtime

Package pair:
- Browser Bridge v0.5.0
- Local Relay v0.3.0

The Relay remains bound to 127.0.0.1 only.

Upgrade from v0.2.2 preserves:
- relay.db
- relay token

The Browser Bridge write capability stays disabled until the local popup checkbox
`Enable production root-cause write gate` is explicitly enabled.

Initial production acceptance is exactly one task-level SET_CANDIDATE.
Do not enqueue the remaining candidates until that one write is WRITE_VERIFIED.
