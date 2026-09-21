# Browser Bridge — public migration lane

The accepted internal v0.3.36 runtime is **not copied verbatim** into this public repository because the source contains private origin/tenant identifiers and historical bounded-acceptance target identifiers.

The public migration must first make environment identity explicit configuration while preserving:

- same-origin execution in an already authenticated browser session;
- loopback-only Relay polling;
- `RELAY_PING` and completeness-verified `ONES_INVENTORY_READ`;
- no browser credential export;
- no unattended ONES write capability.

Track this as the current P0 writer lane. Do not paste private constants into public source as a shortcut.
