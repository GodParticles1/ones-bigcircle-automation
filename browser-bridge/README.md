# Browser Bridge v0.5.0

Configuration-driven ONES browser executor for a Windows-local loopback Relay.

Capabilities:
- `RELAY_PING`
- `ONES_INVENTORY_READ`
- `ONES_FIELD_READ`
- gated `ONES_ROOT_CAUSE_WRITE`

The write capability is not advertised to the Relay unless the explicit local production write gate is enabled in the popup.

The bounded root-cause writer:
- consumes only `UNIQUE_ONES_TASK_ONLY` / `SET_CANDIDATE` / `fill_empty_only` jobs;
- derives the initial job from an exact-hash planner artifact through the bundled enqueue helper;
- requires the job field UUID to equal the locally configured root-cause field UUID;
- v1 bounds desired text to one 1-300 character paragraph;
- takes display ID, task UUID, field UUID, desired text, and plan SHA only at runtime;
- performs a double authoritative pre-write read;
- aborts on drift or non-empty different content;
- requires the exact ONES detail tab and native richtext editor to be open;
- uses native browser input and one Save dispatch;
- verifies both authoritative onesql semantic readback and a new system field event;
- never auto-retries an uncertain write;
- does not fabricate a direct richtext `tasks/update3` payload.

The extension never exports browser Cookie/Authorization/password material to the Relay.
