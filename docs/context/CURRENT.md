# Current Context

Date: 2026-09-21

## Repository bootstrap

This public repository is the code/governance home for the ONES <-> Big-circle automation project. It is intentionally separate from historical chat-memory and xRocket product-knowledge repositories.

## Current public source state

- `reconciliation/`: migrated from accepted v0.2.0 semantic lineage; fixtures and documentation anonymized.
- `local-relay/`: migrated from accepted v0.2.1 source lineage.
- `browser-bridge/`: v0.4.0 public projection candidate prepared from the accepted internal v0.3.36 inventory/relay lineage. Private origin/tenant IDs and historical bounded-acceptance IDs are removed; environment scope is runtime configuration. Candidate is not yet runtime-accepted and does not supersede the internal executor.

## Current operational gate

`BIGCIRCLE_TASK_PROMPT_WIRING=PASS`

`BIGCIRCLE_RECONCILIATION_RUNTIME_ACCEPTANCE=PENDING`

The existing Big-circle scan checkpoint and reconciliation checkpoint remain independent. A downstream reconciliation WAIT/BLOCK must not roll back a successful case-maintenance scan.

## Safety

Current public support is read-only with respect to ONES. Remote transport and ONES writes are not enabled.

## Active code lane

`migration/browser-bridge-public-v040-clean` — configuration-driven read-only Browser Bridge candidate. Static syntax/redaction tests pass locally; independent semantic/CI review is required before integration.
