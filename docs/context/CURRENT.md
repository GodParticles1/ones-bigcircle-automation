# Current Context

Date: 2026-09-21

## Repository bootstrap

This public repository is the code/governance home for the ONES <-> Big-circle automation project. It is intentionally separate from historical chat-memory and xRocket product-knowledge repositories.

## Current public source state

- `reconciliation/`: accepted v0.2.0 semantic lineage with anonymized public fixtures.
- `local-relay/`: accepted v0.2.1 source lineage.
- `browser-bridge/`: public-safe v0.4.0 integrated on main at merge `4cb9d265ad566e4d30ef00141df82f4ec1ce7694`. Private origin/tenant identifiers and historical bounded-write surfaces are removed; environment scope is runtime configuration.

## Current operational gate

`BIGCIRCLE_TASK_PROMPT_WIRING=PASS`

`BROWSER_BRIDGE_V040_INTEGRATION=PASS`

`WINDOWS_CHROME_RUNTIME_ACCEPTANCE=PENDING`

`BIGCIRCLE_RECONCILIATION_RUNTIME_ACCEPTANCE=PENDING`

The existing Big-circle scan checkpoint and reconciliation checkpoint remain independent. Runtime acceptance may be triggered manually; it does not need to wait for the scheduled 19:30 run.

## Population semantics

Historical local-case count and ONES inventory count are not directly comparable unless their populations are aligned.

The current known example is intentionally asymmetric:
- the historical 143 local confirmed cases represented one engineer's actual handled cases;
- the historical 128 ONES inventory rows represented a shared multi-engineer ONES scope.

Therefore reconciliation is population-aware and identity-aware, not raw-count-difference based.

Person fields are first-class alignment data:

- Big-circle `dutyPersons` / `handlerPersons` identify the local people involved in the case;
- ONES `assignee.name` identifies the ONES-side person partition for the ticket;
- configured person/alias mappings are runtime configuration and are never hardcoded into public source.

The case identity signal remains deterministic. An exact sourceTicketKey is the strongest current identity key. Person name alone does not prove that two rows are the same case, but it determines which person's population a row belongs to and is required before automatic field synchronization.

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

## Safety

Current integrated runtime support remains read-only with respect to ONES. Remote Queue and ONES production writes are not enabled.
