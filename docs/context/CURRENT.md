# Current Context

Date: 2026-09-21

## Repository bootstrap

This public repository is the code/governance home for the ONES <-> Big-circle automation project. It is intentionally separate from historical chat-memory and xRocket product-knowledge repositories.

## Current public source state

- `reconciliation/`: migrated from accepted v0.2.0 semantic lineage; fixtures and documentation anonymized.
- `local-relay/`: migrated from accepted v0.2.1 source lineage.
- `browser-bridge/`: not yet source-integrated. The accepted internal v0.3.36 implementation contains private environment identifiers, so raw publication is blocked until configuration is externalized.

## Current operational gate

`BIGCIRCLE_TASK_PROMPT_WIRING=PASS`

`BIGCIRCLE_RECONCILIATION_RUNTIME_ACCEPTANCE=PENDING`

The existing Big-circle scan checkpoint and reconciliation checkpoint remain independent. A downstream reconciliation WAIT/BLOCK must not roll back a successful case-maintenance scan.

## Safety

Current public support is read-only with respect to ONES. Remote transport and ONES writes are not enabled.
