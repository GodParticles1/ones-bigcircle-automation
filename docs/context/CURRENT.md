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

## Dynamic snapshot rule

ONES inventory cardinality and Big-circle confirmed-case cardinality are both expected to change over time. No historical count is a future invariant. Every reconciliation run binds to the exact current case-feed bytes and one completeness-verified ONES inventory snapshot; exact input hashes determine idempotency. A changing ONES total during pagination must block that snapshot and require a fresh read rather than producing a missing-ticket decision.

## Safety

Current support remains read-only with respect to ONES. Remote Queue and ONES writes are not enabled.
