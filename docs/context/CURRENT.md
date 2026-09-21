# Current Context

Date: 2026-09-21

## Repository bootstrap

This public repository is the code/governance home for the ONES <-> Big-circle automation project. It is intentionally separate from historical chat-memory and xRocket product-knowledge repositories.

## Current public source state

- `reconciliation/`: v0.2.1 handler-first person-aware reconciliation integrated on main at merge `25c8e913a658298954e2c447c84be675e4639d99`.
- `local-relay/`: accepted v0.2.1 source lineage.
- `browser-bridge/`: public-safe v0.4.1 integrated on main at merge `89c131d56e156c2977889670ee844392d7eef3f4`. v0.4.1 preserves unsaved first-time setup draft across popup close/reopen while keeping committed token/status handling non-echoing. Private origin/tenant identifiers and historical bounded-write surfaces remain absent; environment scope is runtime configuration.

## Current operational gate

`BIGCIRCLE_TASK_PROMPT_WIRING=PASS`

`BROWSER_BRIDGE_V041_INTEGRATION=PASS`

`WINDOWS_CHROME_RUNTIME_ACCEPTANCE=PASS`

`PERSON_AWARE_RECONCILIATION_CORRECTION=PASS`

`BIGCIRCLE_RECONCILIATION_RUNTIME_ACCEPTANCE=PASS`

`BIGCIRCLE_SCHEDULED_TASK_V021_ALIGNMENT=PASS`

`DYNAMIC_RESOURCE_RECONCILIATION_CONTRACT=PASS`

`DYNAMIC_ALIGNMENT_CONTROLLER=ACTIVE`

The existing Big-circle scan checkpoint and reconciliation checkpoint remain independent. Runtime acceptance may be triggered manually; it does not need to wait for the scheduled 19:30 run.

## Population semantics

Historical local-case count and ONES inventory count are not directly comparable unless their populations are aligned.

The current known example is intentionally asymmetric:
- the historical 143 local confirmed cases represented one engineer's actual handled cases;
- the historical 128 ONES inventory rows represented a shared multi-engineer ONES scope.

Therefore reconciliation is population-aware and identity-aware, not raw-count-difference based.

Person fields are first-class alignment data, with an explicit local precedence rule:

- Big-circle `handlerPersons` is primary and represents the person who actually handled the case;
- only when `handlerPersons` is empty/unresolved, Big-circle `dutyPersons` is used as a fallback inclusion source;
- duty and handler are not blindly unioned when a valid handler exists;
- ONES `assignee.name` identifies the ONES-side owner partition for the ticket;
- configured person/alias mappings are runtime configuration and are never hardcoded into public source.

The case identity signal remains deterministic. An exact sourceTicketKey is the strongest current identity key. Person scope determines whose case it is; sourceTicketKey determines which case it is.

The actionable missing direction is:

`confirmed local case -> local person scope -> exact sourceTicketKey lookup in complete shared ONES inventory`

Outcomes:

- exact key absent from the complete shared inventory -> `ONES_MISSING_CASE`;
- exact key exists and ONES person scope aligns -> `MATCHED`;
- exact key exists but ONES person scope differs -> `PERSON_SCOPE_MISMATCH` / review, not a missing ticket;
- ambiguous person or identity evidence -> `AMBIGUOUS`.

Extra ONES rows belonging to other configured people are expected and do not count as local discrepancies.

## Dynamic resource reconciliation

The dynamic-data model is now formalized by `docs/contracts/DYNAMIC_RESOURCE_RECONCILIATION_V1.md`.

Big-circle CASE_FEED and ONES inventory are treated as changing resources with:
- opaque source-local `resourceVersion`;
- exact `contentSha256`;
- observation time;
- an atomic alignment checkpoint storing the last verified exact pair.

Initial watch semantics are synthetic rather than streaming:

`periodic authoritative LIST -> compare revision/hash -> reconcile only on change`

The default operational target is approximately every 2 hours. The existing workday 19:30 Big-circle scan remains unchanged and independent. A later event/watch path may reduce latency, but event hints never replace periodic authoritative LIST/resync.

Counts are not versions. DELETE events never authorize ONES deletion. Remote Queue remains unopened and ONES mutation remains disabled.

## Dynamic snapshot rule

ONES inventory cardinality and Big-circle confirmed-case cardinality are both expected to change over time. No historical count is a future invariant. Every reconciliation run binds to the exact current case-feed bytes and one completeness-verified ONES inventory snapshot; exact input hashes determine idempotency. A changing ONES total during pagination must block that snapshot and require a fresh read rather than producing a missing-ticket decision.

## Product intent

The automation has two primary outcomes:

1. detect confirmed local cases that have no exact ONES ticket and emit a deduplicated missing-ticket report for human supplementation;
2. for exact matched cases, prepare a bounded synchronization plan for confirmed technical fields, with root cause as the primary write target.

Root-cause synchronization is now a queued product lane, but production ONES mutation remains disabled until its separate contract and runtime acceptance are complete.

## Root-cause source semantics

Big-circle already maintains technical handling evidence in the local `remarks` field. That field is the source for future root-cause extraction; a second data-entry workflow is not required.

However `remarks` may contain mixed evidence such as:
- confirmed root cause;
- symptom/phenomenon;
- current judgment or suspected cause;
- mitigation/recovery action;
- result/verification;
- next step.

Therefore future automation must first structure remarks into evidence state before any ONES write-plan is emitted.

Minimum derived fields:
- `rootCauseText`;
- `rootCauseState = CONFIRMED | PROVISIONAL | ABSENT | CONFLICT`;
- `rootCauseEvidenceSummary`;
- `rootCauseSource = remarks`.

Only `CONFIRMED` root cause is eligible for the bounded root-cause synchronization lane. Provisional language must not be upgraded to a final root cause.

## Safety

Current integrated runtime support remains read-only with respect to ONES. Remote Queue and ONES production writes are not enabled.


## Windows runtime acceptance

`WINDOWS_CHROME_RUNTIME_ACCEPTANCE=PASS`

Accepted runtime pair:
- Browser Bridge: v0.4.1
- Local Relay: v0.2.1
- Relay heartbeat: PASS
- RELAY_PING: PASS
- executor extensionVersion: 0.4.1
- capabilities: `RELAY_PING`, `ONES_INVENTORY_READ` only
- fresh inventory state/status: `INVENTORY_VERIFIED`
- readOnly: true
- inventoryComplete: true
- reconciliationAllowed: true
- ticketCount = serverTotalCount = visiblePageTotal = len(tickets) = 131 for this snapshot
- pageCount: 3
- capturedAt: 2026-09-21T08:01:43.336Z
- saved Windows snapshot SHA256: `b78bfbd108c3a967d5d28b7a2850a9277c3b64581bbde6fac29d37c6cc131e30`

The value 131 is not a product invariant. It is only the cardinality of this accepted snapshot. ONES shared inventory and Big-circle confirmed-case feed are both expected to grow over time. Acceptance is based on per-run completeness/equality and exact snapshot hashes, never on preserving a historical count.

## Case-feed runtime gate

`BIGCIRCLE_SCAN_RUNTIME_ACCEPTANCE=PASS`

`BIGCIRCLE_WAIT_LOCAL_INVENTORY_BEHAVIOR=PASS`

`CASE_FEED_REMARKS_FIDELITY=PASS`

`CASE_FEED_CANONICAL_SEMANTIC_FIDELITY=PASS`

`CASE_FEED_ACCEPTED_SHA256=41dffdcbd731ab55307a9764f35fca6715938d1d096b21beef25156116909fb8`

`CASE_FEED_EXPORTED_CONFIRMED_CASE_COUNT=252`

`CASE_FEED_EXTERNAL_SOURCE_TICKET_KEY_COUNT=86`

`CASE_FEED_SOURCE_TICKET_KEY_NULL_COUNT=166`

Exact-artifact review against `docs/contracts/CASE_FEED_V1.md` passed: 252/252 rows are confirmed cases, control/incomplete rows are absent, deterministic external-key extraction exactly matches the frozen rule, YF display IDs are excluded, and people/nested metadata compatibility is valid. Case-feed schema work is frozen. The next gate is a fresh completeness-verified ONES inventory plus integrated v0.2.1 person-aware runtime reconciliation.


## Artifact versus transport boundary

The canonical Big-circle case feed is a durable data contract and snapshot artifact, not the intended long-term human-mediated transport mechanism.

Current runtime acceptance may use an exported JSON file to isolate and verify:
- Big-circle scan/feed semantics;
- Windows inventory capture;
- reconciliation/idempotency.

Production target:
`Big-circle -> transport adapter -> Windows Agent -> reconciliation/Relay/Browser Bridge`

The Windows Agent should receive the same logical case-feed snapshot automatically, persist an exact local copy for audit/replay/hash binding, and return bounded result/checkpoint envelopes automatically.

Therefore:
- the case-feed schema remains part of the production design;
- manual download/upload/copy of the file is temporary acceptance scaffolding;
- transport selection remains separate from business semantics;
- Local Relay stays loopback-only;
- no Remote Queue provider is opened until the transport-neutral contract is accepted.


## Reconciliation runtime acceptance

`BIGCIRCLE_RECONCILIATION_RUNTIME_ACCEPTANCE=PASS`

Accepted exact pair:
- CASE_FEED raw SHA256: `41dffdcbd731ab55307a9764f35fca6715938d1d096b21beef25156116909fb8`
- ONES inventory raw SHA256: `b78bfbd108c3a967d5d28b7a2850a9277c3b64581bbde6fac29d37c6cc131e30`
- reconcile implementation: 0.2.1
- pipeline version: 0.2.0
- first run: `RECONCILIATION_VERIFIED`
- immediate exact rerun: `RECONCILIATION_NOOP_VERIFIED`
- runKey: `8e5f22b987ec9cdeaa0bd2781f7c8486d7b3a5d3b6f042a1aa72be5eeb01520b`
- report SHA256: `79ebd440b411b6d5c0c91b22d005873f8d2ccfbae3b7318c0b9bd67a8649789a`
- inputCaseCount: 252
- includedCaseCount: 112
- excluded pre-baseline/invalid-date: 130
- excluded outside configured people: 10
- totals: MATCHED=43, ONES_MISSING_CASE=28, PERSON_SCOPE_MISMATCH=3, AMBIGUOUS=38
- unique missing sourceTicketKeys: 25

Real-data semantic audit:
- all 112 included rows were `HANDLER_PRIMARY`; no contradictory duty/handler union was observed;
- sampled MATCHED rows aligned effectiveLocalPersons with ONES assignee;
- all three exact-key wrong-assignee rows classified as `PERSON_SCOPE_MISMATCH`, not missing;
- all 38 AMBIGUOUS rows in this snapshot were fail-closed `SOURCE_TICKET_KEY_MISSING_OR_MALFORMED`;
- this exact real snapshot did not contain a `DUTY_FALLBACK` row, so that branch was not exercised by production data; the exact integrated v0.2.1 targeted test/CI already covers duty fallback and no runtime evidence contradicts it.

The accepted counts above belong only to this exact input pair. Future case-feed and inventory totals are expected to change.

## Scheduled-task v0.2.1 readback acceptance

`BIGCIRCLE_SCHEDULED_TASK_V021_ALIGNMENT=PASS`

Accepted task-definition readback:
- task definition updated: true;
- existing scan semantics unchanged: true;
- reconciliation stage remains downstream of `SCAN_COMPLETE`: true;
- scan checkpoint independent from reconciliation checkpoint: true;
- waiting for ONES does not roll back scan state: true;
- Remote Queue enabled: false;
- ONES write enabled: false;
- workday 19:30 cadence preserved;
- existing five-step scan path preserved;
- downstream reconciliation semantics use `MATCHED / ONES_MISSING_CASE / PERSON_SCOPE_MISMATCH / AMBIGUOUS`;
- unavailable Windows inventory maps to `RECONCILE_WAIT_LOCAL_INVENTORY`.

Issue #11 stop condition is satisfied by this task-definition readback. The accepted prompt was compacted only to fit the scheduler prompt-length limit; frozen scan semantics and safety boundaries were retained.

## Scheduled-task alignment

The data contracts are connected, but the automatic cross-environment transport is not yet connected end-to-end.

Current accepted split:
- Big-circle weekly tables -> CASE_FEED_V1: PASS;
- Browser/Relay -> ONES inventory: v0.4.1 + Local Relay v0.2.1 Windows runtime acceptance PASS on a fresh completeness-verified snapshot;
- case feed + inventory -> reconciliation v0.2.1: Windows exact-input runtime acceptance PASS, including immediate exact-input NOOP.
- Big-circle -> Windows automatic transport: not yet implemented/accepted.

The existing workday scheduled scan remains unchanged. Its post-SCAN_COMPLETE stage must now use v0.2.1 outcome semantics, including PERSON_SCOPE_MISMATCH, and CASE_FEED_V1. Until transport is accepted, lack of a fresh Windows inventory must result only in RECONCILE_WAIT_LOCAL_INVENTORY.


## Lead handoff checkpoint

Current accepted/retired:
- Browser Bridge public-safe v0.4.1 integrated; Issue #12 setup-draft persistence correction closed;
- Local Relay v0.2.1 accepted base;
- person-aware reconciliation v0.2.1 integrated;
- CASE_FEED_V1 exact artifact accepted at SHA256 `41dffdcbd731ab55307a9764f35fca6715938d1d096b21beef25156116909fb8`;
- CASE_FEED/schema correction lane retired.

Current unfinished:
- provider-neutral dynamic alignment controller implementation;
- automatic Big-circle <-> Windows Agent transport;
- Issue #9 remarks root-cause extraction;
- Issue #6 bounded root-cause synchronization;
- Windows Agent consolidation and Browser UI productization.

Exact continuation ordering and new-conversation bootstrap are maintained in `HANDOFF.md`.
