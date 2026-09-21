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

## P2 — Big-circle <-> Relay transport abstraction

`LANE_STATE=QUEUED`

Goal: define a transport-neutral job/result envelope so the cloud Big-circle control plane can eventually exchange bounded read-only work with the Windows agent without coupling business semantics to one provider.

Current restriction: do not select or open a Remote Queue implementation yet.

## P3 — Windows agent consolidation

`LANE_STATE=QUEUED`

Future packaging target: one Windows-side ONES Big-circle Agent that owns Local Relay, reconciliation runner, state/checkpoints, config/status UI and Browser Bridge setup guidance. Chrome extension remains a browser component.

## P4 — Browser UI productization

`LANE_STATE=QUEUED`

Replace the developer-console layout with a compact product UI: connection/config card, status summary, manual actions, inventory/reconciliation summary, diagnostics drawer and settings. Visual direction may borrow the compact card/grid hierarchy shown by AI Exporter without copying its branding or assets.

## Deferred

- production root-cause write lane;
- ONES create/import;
- owner/status/project/priority/delete automation.
