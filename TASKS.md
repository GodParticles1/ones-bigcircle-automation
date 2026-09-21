# Tasks

## P0 — Windows Chrome runtime acceptance for Browser Bridge v0.4.0

`LANE_STATE=ACTIVE`

Use the integrated public-safe Browser Bridge v0.4.0 with Local Relay v0.2.1 on the user's Windows/Chrome environment.

Required evidence:

- configure current ONES origin/team/project/issue-type/department at runtime;
- grant only the configured ONES origin permission;
- bind the current external-ticket inventory page;
- Relay heartbeat succeeds on `127.0.0.1:18731`;
- `RELAY_PING` succeeds;
- `ONES_INVENTORY_READ` returns a current completeness-verified snapshot;
- exact current `ticketCount == serverTotalCount == visiblePageTotal`;
- no ONES write path exists or executes.

This gate may be run manually now; do not wait for the scheduled Big-circle task.

## P1 — Big-circle reconciliation runtime acceptance

`LANE_STATE=ACTIVE`

Trigger the existing Big-circle task manually with the same production-safe prompt semantics already accepted:

`SCAN_COMPLETE -> CASE_FEED_BUILD -> INVENTORY_GATE -> RECONCILIATION -> MISSING_REPORT -> RECONCILIATION_CHECKPOINT`

Validate that reconciliation WAIT/BLOCK never rolls back `last_successful_scan_time`, weekly-table writes, or prior verified reconciliation state.

Population rule: local selected-case count and shared ONES inventory count are not expected to match. Person fields are used to align populations: Big-circle duty/handler people on the local side and ONES assignee name on the ONES side. Exact sourceTicketKey remains the primary identity key. An exact key found under a different ONES person is a person-scope mismatch/review case, not a missing ticket.

## P2 — Population-aware root-cause synchronization contract

`LANE_STATE=QUEUED`

Goal: extend exact-match reconciliation into a bounded write-plan lane for confirmed technical fields, with root cause as P0.

Required semantics:

- Big-circle duty/handler names and ONES assignee name are first-class population-alignment fields;
- public code never hardcodes real names; person/alias mappings are runtime configuration;
- person name alone is not sufficient case identity;
- exact single identity match plus compatible person scope is required for automatic synchronization;
- local root cause must be confirmed and non-empty;
- current ONES root-cause field is read before any write;
- ONES blank + confirmed local value -> SET_CANDIDATE;
- semantically identical -> NOOP;
- ONES non-empty and different -> CONFLICT_REVIEW;
- person-scope mismatch, ambiguous identity, or missing match -> BLOCK;
- missing ONES tickets remain human-supplemented; no automatic create/import;
- public source uses configuration for field identifiers and never hardcodes private tenant/field IDs;
- write execution requires a separately accepted bounded runtime gate and post-write readback.

Contract: `docs/contracts/ROOT_CAUSE_SYNC_V1.md`.

## P3 — Big-circle <-> Relay transport abstraction

`LANE_STATE=QUEUED`

Goal: define a transport-neutral job/result envelope so the cloud Big-circle control plane can eventually exchange bounded work with the Windows agent without coupling business semantics to one provider.

Current restriction: do not select or open a Remote Queue implementation yet.

The transport contract must be able to carry both read-only inventory jobs and future accepted write-plan jobs without granting new capabilities by default.

## P4 — Windows agent consolidation

`LANE_STATE=QUEUED`

Future packaging target: one Windows-side ONES Big-circle Agent that owns Local Relay, reconciliation runner, state/checkpoints, config/status UI and Browser Bridge setup guidance. Chrome extension remains a browser component.

## P5 — Browser UI productization

`LANE_STATE=QUEUED`

Replace the developer-console layout with a compact product UI: connection/config card, status summary, manual actions, inventory/reconciliation summary, diagnostics drawer and settings. Visual direction may borrow the compact card/grid hierarchy shown by AI Exporter without copying its branding or assets.

## Deferred

- automatic ONES create/import;
- owner/status/project/priority/delete automation;
- any production write beyond separately accepted bounded field-sync contracts.
