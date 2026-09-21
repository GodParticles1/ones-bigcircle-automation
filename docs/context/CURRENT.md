# Current Context

Date: 2026-09-21

## Repository bootstrap

This public repository is the code/governance home for the ONES <-> Big-circle automation project. It is intentionally separate from historical chat-memory and xRocket product-knowledge repositories.

## Current public source state

- `reconciliation/`: v0.2.1 handler-first person-aware reconciliation integrated on main at merge `25c8e913a658298954e2c447c84be675e4639d99`.
- `local-relay/`: accepted v0.2.1 source lineage.
- `browser-bridge/`: public-safe v0.4.0 integrated on main at merge `4cb9d265ad566e4d30ef00141df82f4ec1ce7694`. Private origin/tenant identifiers and historical bounded-write surfaces are removed; environment scope is runtime configuration.

## Current operational gate

`BIGCIRCLE_TASK_PROMPT_WIRING=PASS`

`BROWSER_BRIDGE_V040_INTEGRATION=PASS`

`WINDOWS_CHROME_RUNTIME_ACCEPTANCE=PENDING`

`PERSON_AWARE_RECONCILIATION_CORRECTION=PASS`

`BIGCIRCLE_RECONCILIATION_RUNTIME_ACCEPTANCE=ACTIVE`

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


## Case-feed runtime gate

`BIGCIRCLE_SCAN_RUNTIME_ACCEPTANCE=PASS`

`BIGCIRCLE_WAIT_LOCAL_INVENTORY_BEHAVIOR=PASS`

`CASE_FEED_REMARKS_FIDELITY=PASS`

`CASE_FEED_CANONICAL_SEMANTIC_FIDELITY=BLOCKED`

The current correction is bounded by `docs/contracts/CASE_FEED_V1.md`. Runtime reconciliation remains blocked until the feed excludes control/incomplete rows, carries deterministic local sourceTicketKey values where available, marks emitted cases as confirmed, and provides the compatibility metadata envelope expected by the integrated v0.2.1 reconciler.


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
