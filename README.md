# ones-bigcircle-automation

Public, governance-first source repository for the read-only automation path between a maintained local case feed and an authenticated ONES browser session.

Current integrated capabilities:

- `reconciliation/`: exact-key case/inventory reconciliation with checkpointed, idempotent pipeline execution.
- `local-relay/`: Windows-local loopback queue used by a browser executor; current public source supports `RELAY_PING` and `ONES_INVENTORY_READ` only.
- `browser-bridge/`: public-safe migration lane. The previously accepted internal runtime contained environment/tenant and bounded-acceptance identifiers, so its raw source is intentionally **not** published. A configuration-driven public projection must be accepted before browser source is integrated here.

The repository does **not** contain real engineer names, production case exports, browser credentials, cookies, authorization headers, relay tokens, or private ONES tenant identifiers.

## Safety boundary

Current production-write authorization: **none**.

The repository does not authorize automatic ONES create/import, owner/status/project/priority mutation, deletion, or root-cause writing. Missing-ticket output is for manual handling unless a future contract explicitly changes that boundary.

## Bootstrap

Every new Lead/Agent session reads:

1. `AGENTS.md`
2. `docs/context/CURRENT.md`
3. live branch / HEAD / open PRs / priority issues
4. `TASKS.md`
5. `HANDOFF.md`
6. only the contracts relevant to the active lane

Governance is adapted from the reusable Setpoint governance bootstrap pattern; Setpoint product semantics are not copied.
