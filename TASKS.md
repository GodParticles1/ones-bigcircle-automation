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

## P1 — Person-aware reconciliation correction

`LANE_STATE=RETIRED`

Correct reconciliation before declaring production runtime acceptance.

Local attribution rule:

- use `handlerPersons` when a valid handler is present;
- only if handler is empty/unresolved, fall back to `dutyPersons`;
- do not union duty into the effective owner set when handler exists.

ONES-side person scope comes from assignee.

Exact sourceTicketKey remains the primary case identity key.

Required outcomes:

- exact key + compatible person -> `MATCHED`;
- exact key absent globally -> `ONES_MISSING_CASE`;
- exact key present under another person -> `PERSON_SCOPE_MISMATCH`;
- unresolved/ambiguous person or identity -> `AMBIGUOUS`.

Add targeted tests for handler precedence, duty fallback, wrong-assignee mismatch and existing exact-key behavior.

## P1a — CASE_FEED_BUILD semantic correction

`LANE_STATE=RETIRED`

Accepted exact artifact: `41dffdcbd731ab55307a9764f35fca6715938d1d096b21beef25156116909fb8`.

Acceptance summary: 252 confirmed cases, 39 source tables, 86 deterministic external sourceTicketKeys, 166 null external keys, zero ambiguous keys, and compatible people/metadata envelope. Do not reopen schema/extractor work without contradictory exact evidence.

Contract: `docs/contracts/CASE_FEED_V1.md`

Do not rescan enterprise chat and do not move the scan checkpoint.

Rebuild only from maintained weekly tables:
- exclude EMPTY_PLACEHOLDER / CHECKPOINT_MARKER / INCOMPLETE rows;
- emit only CONFIRMED_REAL_CASE rows;
- preserve remarks exactly;
- derive sourceTicketKey independently and deterministically from explicit trusted key or one unique valid external-ticket token in groupChatName;
- never infer a key from current ONES inventory;
- emit people + nested metadata compatibility fields for v0.2.1.

## P1b — Big-circle reconciliation runtime acceptance

`LANE_STATE=ACTIVE`

The canonical case feed is now accepted. Use its exact bytes/hash as the local input snapshot for the next runtime gate.

Execute:

`SCAN_COMPLETE -> CASE_FEED_BUILD -> INVENTORY_GATE -> PERSON_AWARE_RECONCILIATION -> MISSING_REPORT -> RECONCILIATION_CHECKPOINT`

Validate that reconciliation WAIT/BLOCK never rolls back `last_successful_scan_time`, weekly-table writes, or prior verified reconciliation state.

## P2 — Remarks -> structured root-cause extraction

`LANE_STATE=QUEUED`

Goal: derive confirmed root-cause evidence from the existing Big-circle `remarks` field without changing the current daily data-entry workflow.

Required semantics:
- preserve the original remarks text unchanged;
- derive `rootCauseText`, `rootCauseState`, `rootCauseEvidenceSummary`;
- distinguish confirmed root cause from symptom, current judgment/suspicion, recovery action and next step;
- do not promote provisional language to CONFIRMED;
- conflicting root-cause statements -> CONFLICT;
- no root-cause evidence -> ABSENT;
- only CONFIRMED may feed the write-plan lane;
- public tests use synthetic remarks only.

## P3 — Population-aware root-cause synchronization contract

`LANE_STATE=QUEUED`

Goal: extend exact-match reconciliation into a bounded write-plan lane for confirmed technical fields, with root cause as P0.

Required semantics:

- Big-circle handler is the primary local owner; duty is fallback only when handler is empty/unresolved;
- ONES assignee is the ONES-side owner scope;
- public code never hardcodes real names; person/alias mappings are runtime configuration;
- person name alone is not sufficient case identity;
- exact single identity match plus compatible effective-person scope is required for automatic synchronization;
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

## P4 — Big-circle <-> Windows Agent transport abstraction

`LANE_STATE=QUEUED`

Goal: replace the current manual case-feed file handoff with automatic transport while preserving the exact same canonical snapshot contract.

The JSON case feed remains the logical payload/audit snapshot, but the user must not need to download/copy/upload it during normal operation.

Define a transport-neutral job/result envelope so the cloud Big-circle control plane can exchange bounded work with the Windows agent without coupling business semantics to one provider.

Current restriction: do not select or open a Remote Queue implementation yet.

The transport contract must be able to carry both read-only inventory jobs and future accepted write-plan jobs without granting new capabilities by default.

## P5 — Windows agent consolidation

`LANE_STATE=QUEUED`

Future packaging target: one Windows-side ONES Big-circle Agent that owns Local Relay, reconciliation runner, state/checkpoints, config/status UI and Browser Bridge setup guidance. Chrome extension remains a browser component.

## P6 — Browser UI productization

`LANE_STATE=QUEUED`

Replace the developer-console layout with a compact product UI: connection/config card, status summary, manual actions, inventory/reconciliation summary, diagnostics drawer and settings. Visual direction may borrow the compact card/grid hierarchy shown by AI Exporter without copying its branding or assets.

## Deferred

- automatic ONES create/import;
- owner/status/project/priority/delete automation;
- any production write beyond separately accepted bounded field-sync contracts.
