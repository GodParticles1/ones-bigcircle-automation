# Filesystem exchange adapter v1

Provider-neutral one-shot adapter between the accepted durable spools.

Exchange layout:

- `BIGCIRCLE_TO_WINDOWS/`
- `WINDOWS_TO_BIGCIRCLE/`

The adapter:

- exports one validated outbox envelope to the configured exchange directory;
- imports one validated exchange envelope into the receiving role inbox;
- preserves exact envelope file bytes on first transfer;
- uses atomic writes;
- treats exact duplicates as NOOP;
- optionally removes the source only after the destination has been verified.

This is intentionally **not** a network or cloud provider implementation. It can be exercised locally now and later placed behind a separately accepted transport mechanism without changing envelope/business semantics.
