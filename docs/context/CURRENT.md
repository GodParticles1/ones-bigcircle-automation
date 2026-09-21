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

Therefore reconciliation is key-based, not raw-count-difference based.

Authoritative local attribution remains the Big-circle case feed's duty/handler fields. ONES assignee is useful metadata but is not the local attribution truth.

The actionable missing direction is:

`confirmed local case sourceTicketKey -> completeness-verified shared ONES inventory -> exact key absent => ONES_MISSING_CASE`

Extra ONES rows outside the selected local population do not by themselves imply a local missing case.

## Dynamic snapshot rule

ONES inventory cardinality and Big-circle confirmed-case cardinality are both expected to change over time. No historical count is a future invariant. Every reconciliation run binds to the exact current case-feed bytes and one completeness-verified ONES inventory snapshot; exact input hashes determine idempotency. A changing ONES total during pagination must block that snapshot and require a fresh read rather than producing a missing-ticket decision.

## Product intent

The automation has two primary outcomes:

1. detect confirmed local cases that have no exact ONES ticket and emit a deduplicated missing-ticket report for human supplementation;
2. for exact matched cases, prepare a bounded synchronization plan for confirmed technical fields, with root cause as the primary write target.

Root-cause synchronization is now a queued product lane, but production ONES mutation remains disabled until its separate contract and runtime acceptance are complete.

## Safety

Current integrated runtime support remains read-only with respect to ONES. Remote Queue and ONES production writes are not enabled.
