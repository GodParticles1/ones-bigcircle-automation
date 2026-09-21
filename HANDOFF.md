# Handoff

## Integrated bases

- Browser Bridge v0.4.1: integrated on main by merge `89c131d56e156c2977889670ee844392d7eef3f4`; Issue #12 setup-draft persistence correction is closed.
- Local Relay v0.2.1: current loopback runtime base.
- Reconciliation pipeline v0.2.1: handler-first, assignee-aware, checkpointed/idempotent reconciliation integrated at `25c8e913a658298954e2c447c84be675e4639d99`.

## CASE_FEED accepted runtime input

Contract: `docs/contracts/CASE_FEED_V1.md`.

Accepted exact artifact:

```text
SHA256=41dffdcbd731ab55307a9764f35fca6715938d1d096b21beef25156116909fb8
EXPORTED_CONFIRMED_CASE_COUNT=252
SOURCE_TABLE_COUNT=39
EXTERNAL_SOURCE_TICKET_KEY_COUNT=86
SOURCE_TICKET_KEY_NULL_COUNT=166
AMBIGUOUS_KEY_COUNT=0
PEOPLE_COMPAT=PASS
METADATA_COMPAT=PASS
CANONICAL_SEMANTIC_FIDELITY=PASS
```

The exact-artifact audit found no control/incomplete rows in `cases[]`, no YF display-ID leakage, and no deterministic extractor mismatch under the frozen ASCII-boundary rule. Case-feed schema/extractor work is closed unless contradictory exact evidence appears.

Historical ONES inventory snapshots remain regression evidence only. Missing-ticket decisions require a fresh completeness-verified inventory.

## Transport clarification

The manually exported case-feed JSON used during acceptance is not the final transport architecture.

It is retained as:
- canonical snapshot contract;
- exact input/hash boundary;
- audit/replay artifact.

The production interaction target is:
`Big-circle -> transport adapter -> Windows Agent -> Local Relay/Browser Bridge/reconciliation`

The Windows Agent receives/persists the snapshot automatically and returns bounded results/checkpoints automatically. Manual file movement is temporary test scaffolding only. Local Relay remains loopback-only, and no Remote Queue provider is selected yet.

## Scheduled-task delta

Do not change the existing workday scan cadence or stages.

Only align the post-SCAN_COMPLETE lane to the integrated state:
- accepted CASE_FEED_V1;
- fresh verified inventory gate;
- reconciliation v0.2.1;
- MATCHED / ONES_MISSING_CASE / PERSON_SCOPE_MISMATCH / AMBIGUOUS;
- exact-input idempotency;
- WAIT/BLOCK does not affect the scan checkpoint.

Until automatic transport is accepted, a scheduled run with no fresh Windows inventory must stop at RECONCILE_WAIT_LOCAL_INVENTORY. Manual file movement is acceptance scaffolding, not the production transport.

## Open work DAG — exact continuation order

Current unfinished work is intentionally split so a new Lead does not mix runtime acceptance, transport, and write enablement.

### Gate A — Windows read-only runtime acceptance

Status: `PASS`

Use:
- Browser Bridge v0.4.1
- Local Relay v0.2.1
- current logged-in Windows Chrome

Required:
- runtime config succeeds;
- loopback Relay heartbeat / `RELAY_PING` succeeds;
- fresh `ONES_INVENTORY_READ` returns `INVENTORY_VERIFIED`;
- `ticketCount == serverTotalCount == visiblePageTotal == len(tickets)`;
- no ONES mutation path executes.

Accepted evidence:
- Browser Bridge v0.4.1 + Local Relay v0.2.1;
- heartbeat / RELAY_PING PASS;
- fresh inventory `INVENTORY_VERIFIED`;
- readOnly=true, inventoryComplete=true, reconciliationAllowed=true;
- ticketCount=serverTotalCount=visiblePageTotal=len(tickets)=131 for this snapshot only;
- pageCount=3;
- capturedAt=2026-09-21T08:01:43.336Z;
- saved snapshot SHA256=`b78bfbd108c3a967d5d28b7a2850a9277c3b64581bbde6fac29d37c6cc131e30`.

131 is not a fixed expected total. Future inventory and case-feed cardinalities may increase; every run is judged by its own completeness/equality and exact input hashes.

### Gate B — person-aware reconciliation runtime acceptance

Status: `PASS`

Use the accepted case-feed exact input:

```text
SHA256=41dffdcbd731ab55307a9764f35fca6715938d1d096b21beef25156116909fb8
```

Pair it only with the fresh Gate-A inventory and run integrated reconciliation v0.2.1.

Required:
- first exact pair -> `RECONCILIATION_VERIFIED`;
- immediate exact rerun -> `RECONCILIATION_NOOP_VERIFIED`;
- inspect `MATCHED / ONES_MISSING_CASE / PERSON_SCOPE_MISMATCH / AMBIGUOUS`;
- verify handler-primary / duty-fallback / ONES-assignee behavior on real data.

Accepted Gate-B evidence:
- runKey `8e5f22b987ec9cdeaa0bd2781f7c8486d7b3a5d3b6f042a1aa72be5eeb01520b`;
- report SHA256 `79ebd440b411b6d5c0c91b22d005873f8d2ccfbae3b7318c0b9bd67a8649789a`;
- RECONCILIATION_VERIFIED then exact-input RECONCILIATION_NOOP_VERIFIED;
- input 252 / included 112 / pre-baseline-or-invalid 130 / outside-configured-people 10;
- MATCHED 43 / ONES_MISSING_CASE 28 / PERSON_SCOPE_MISMATCH 3 / AMBIGUOUS 38;
- all 3 mismatch rows had an exact key and a different ONES assignee, so they were not misclassified as missing;
- sampled matches aligned effective local handler with ONES assignee;
- all included real rows in this snapshot were HANDLER_PRIMARY. No DUTY_FALLBACK production row existed to exercise; targeted v0.2.1 CI covers that branch and runtime evidence is non-contradictory.

### Gate C — scheduled-task alignment

Status: `PASS`
Control: Issue #11

The existing workday 19:30 scan remains unchanged.

Only align the post-`SCAN_COMPLETE` lane to:
- accepted CASE_FEED_V1;
- fresh verified inventory gate;
- reconciliation v0.2.1;
- `PERSON_SCOPE_MISMATCH`;
- independent reconciliation checkpoint.

Canonical per-person template:
`docs/templates/BIGCIRCLE_PERSON_SCHEDULED_TASK_TEMPLATE_V1.md`

Issue #11 closes only after task-definition readback confirms this alignment. Do not close it merely because the template exists.

Accepted Gate-C readback:
- TASK_DEFINITION_UPDATED=true;
- EXISTING_SCAN_SEMANTICS_UNCHANGED=true;
- RECONCILIATION_STAGE_DOWNSTREAM_OF_SCAN_COMPLETE=true;
- SCAN_CHECKPOINT_INDEPENDENT=true;
- WAITING_FOR_ONES_DOES_NOT_ROLLBACK_SCAN=true;
- REMOTE_QUEUE_ENABLED=false;
- ONES_WRITE_ENABLED=false;
- existing workday 19:30 cadence and scan stages preserved.


### Gate D1 — small periodic read-only alignment

Status: `PASS`
Control: Issue #14

Keep this deliberately small.

Approximately every 2 hours:
- rebuild/read latest valid CASE_FEED_V1 from maintained weekly tables;
- obtain a fresh completeness-verified ONES inventory;
- run the existing reconciliation v0.2.1;
- rely on the existing exact hash/runKey/checkpoint idempotency;
- WAIT/BLOCK preserves prior scan and reconciliation checkpoints.

Do not add a generic dynamic-resource API, resourceVersion/generation, LIST/WATCH event protocol, controller subsystem, Remote Queue or ONES mutation.

The existing workday 19:30 Big-circle scan remains unchanged.

Integrated source: PR #15 / merge `2eb36fd44ee24971eca8f85562e7828637e45514`.

Windows run-once acceptance PASS. Windows Task Scheduler acceptance PASS: `ONES-BigCircle-Periodic-Alignment`, every 2 hours, interactive-only, manual trigger `Last Result=0`, scheduled wrapper result `RECONCILIATION_VERIFIED`. The wrapper only refreshes ONES automatically; Big-circle freshness still depends on the newest CASE_FEED already present locally until Gate D2 transport exists.

### Gate D2 — Big-circle <-> Windows Agent automatic transport

Status: `QUEUED`

Replace manual artifact movement with automatic transport while preserving the exact case-feed/inventory/result contracts.

Do not select/open a Remote Queue provider until a transport-neutral contract is accepted.

Target:
`Big-circle -> transport adapter -> Windows Agent -> Local Relay/Browser Bridge/reconciliation -> result/checkpoint -> Big-circle`

Manual JSON transfer is acceptance scaffolding only.

### Gate E — root-cause evidence extraction

Status: `ACTIVE`
Control: Issue #9

Use existing Big-circle `remarks` as the source. Derive:
- `rootCauseText`;
- `rootCauseState = CONFIRMED | PROVISIONAL | ABSENT | CONFLICT`;
- `rootCauseEvidenceSummary`.

No new manual root-cause field and no ONES mutation.

### Gate F — bounded root-cause synchronization

Status: `QUEUED_AFTER_GATE_E_AND_READ_ONLY_RUNTIME`
Control: Issue #6

Only exact `MATCHED` + compatible person scope + confirmed local root cause may enter the write-plan lane.

Still frozen:
- production ONES root-cause write;
- automatic ONES create/import;
- owner/status/project/priority/delete mutation.

### Productization tail

Queued after the control/runtime lanes above:
- Windows Agent consolidation;
- Browser UI productization using compact product-card hierarchy;
- Chrome extension remains the logged-in same-origin browser executor.

## New-conversation takeover instructions

A new conversation taking Lead / Integration responsibility must:

1. bootstrap live `GodParticles1/chat-memory` and `GodParticles1/xrocket-product-knowledge` per project rules;
2. refresh live main of this repository;
3. read:
   - `AGENTS.md`
   - `docs/context/CURRENT.md`
   - `TASKS.md`
   - `HANDOFF.md`
   - `docs/governance/LEAD_RESPONSIBILITY.md`
   - `docs/governance/MULTI_AGENT.md`
   - `docs/governance/DELIVERY_GATES.md`
   - `docs/contracts/CASE_FEED_V1.md`
   - `docs/contracts/RECONCILIATION_V1.md`
   - `docs/contracts/ROOT_CAUSE_SYNC_V1.md`
   - `docs/templates/BIGCIRCLE_PERSON_SCHEDULED_TASK_TEMPLATE_V1.md`
4. read current Issue #1, Issue #11, Issue #9 and Issue #6;
5. do not reopen retired CASE_FEED/schema work without contradictory exact evidence;
6. continue from Gate A above rather than redesigning architecture.

Frozen support boundary remains read-only until a later explicit write gate.

## Immediate continuation

Do not wait for the scheduled 19:30 Big-circle run.

1. Gates A, B and C are PASS; do not rerun frozen acceptance evidence without decision-changing evidence.
2. Gate D1 periodic alignment is PASS and retired; do not reopen without contradictory runtime evidence.
3. Exact next active lane: Issue #9 root-cause extraction from existing remarks.
4. Keep transport-provider selection, Remote Queue and ONES mutation closed.

## Product outcome model

`confirmed local cases -> exact shared inventory reconciliation`

Branches:

- exact key absent from complete inventory -> `ONES_MISSING_CASE` -> human supplementation;
- exact key exists + ONES assignee matches effective local person (handler primary; duty fallback only if needed) -> `MATCHED` -> candidate for confirmed-field synchronization;
- exact key exists under a different person scope -> `PERSON_SCOPE_MISMATCH` -> review/block;
- ambiguous/non-unique identity or person evidence -> review/block.

Root cause is the primary future synchronization field. No blind overwrite: blank may be filled from confirmed local evidence; equal is NOOP; differing non-empty content is CONFLICT_REVIEW.

## Dynamic-data boundary

Historical counts are regression references only. ONES tickets and Big-circle cases are expected to grow/change, and their populations may differ. Reconciliation binds to exact input snapshots and hashes, never to a fixed expected total.

## Frozen boundaries

- no Remote Queue implementation yet;
- no automatic ONES create/import;
- no production root-cause write until the separate bounded contract/runtime gate is accepted;
- no owner/status/project/priority/delete automation;
- no browser credential export;
- no fuzzy title matching.
