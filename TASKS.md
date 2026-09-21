# Tasks

## P0 — Browser bridge public projection

`LANE_STATE=ACTIVE`

Goal: review and accept the v0.4.0 public projection that replaces internal origin/tenant IDs and historical bounded-acceptance target constants with explicit configuration while preserving the accepted read-only inventory behavior and loopback relay contract.

Writer branch: `migration/browser-bridge-public-v040-clean`

Required before integration:

- no private origin/tenant identifiers in source;
- no real engineer/case identifiers in fixtures/docs;
- manifest permission model reviewed;
- JS syntax/static checks;
- read-only inventory contract tests/fixtures;
- exact provenance recorded;
- no unattended ONES write capability enabled.

## P1 — Big-circle runtime reconciliation acceptance

`LANE_STATE=HOLD`

Waiting for the first scheduled runtime evidence after downstream wiring. Prompt-definition wiring is already accepted; runtime checkpoint semantics still require evidence.

## Deferred

- cross-environment Remote Queue / transport;
- production root-cause write lane;
- ONES create/import.
