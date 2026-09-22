# Durable transport spool v1

This module is the second Gate D2 slice after the provider-neutral envelope.

It provides only local durable filesystem state:

- `inbox/`
- `claimed/`
- `processed/`
- `rejected/`
- `outbox/`

It validates every envelope through the accepted P4a contract, enforces role/direction boundaries, persists files atomically, and treats repeated envelope IDs as deterministic NOOP when the payload hash matches.

Roles:

- `windows-agent`: inbound `BIGCIRCLE_TO_WINDOWS`, outbound `WINDOWS_TO_BIGCIRCLE`
- `bigcircle-control`: inbound `WINDOWS_TO_BIGCIRCLE`, outbound `BIGCIRCLE_TO_WINDOWS`

There is no network client, cloud queue, provider choice, background service, browser change, or ONES mutation in this slice.
