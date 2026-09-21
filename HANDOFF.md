# Handoff

## Integrated bases

- Browser Bridge v0.4.0: integrated on main by merge `4cb9d265ad566e4d30ef00141df82f4ec1ce7694`.
- Local Relay v0.2.1: current loopback runtime base.
- Reconciliation pipeline v0.2.1: handler-first, assignee-aware, checkpointed/idempotent reconciliation integrated at `25c8e913a658298954e2c447c84be675e4639d99`.

## CASE_FEED correction contract

Use `docs/contracts/CASE_FEED_V1.md`.

Current exact artifact proved remarks fidelity but is not yet a confirmed-case feed because it contains control/incomplete rows, every caseStatus is null, and every sourceTicketKey is null.

Observed deterministic extraction against the exact 321-row artifact:
- 102 rows have exactly one valid one-hyphen external-ticket candidate;
- 219 rows have none;
- 0 rows have multiple candidates under the frozen grammar.
After excluding 10 EMPTY_PLACEHOLDER, 4 CHECKPOINT_MARKER and 4 INCOMPLETE rows, 303 confirmed-like rows remain. Under configured-person handler-first filtering, 267 remain in-scope; 93 of those have one deterministic sourceTicketKey candidate and 174 have none.

A previous verified ONES inventory is useful only as regression evidence: 58 current rows / 42 unique extracted keys intersected that stale snapshot. It must not be used to classify current missing tickets.

## Immediate continuation

Do not wait for the scheduled 19:30 Big-circle run.

1. Run Windows Chrome runtime acceptance for Browser Bridge v0.4.0 against Local Relay v0.2.1.
2. Manually trigger the existing Big-circle task using the already accepted downstream reconciliation semantics.
3. Pair the resulting current case feed with a fresh completeness-verified ONES inventory snapshot.
4. Run the integrated v0.2.1 person-aware reconciliation and exact-input NOOP behavior.
5. Validate handler-primary / duty-fallback / ONES-assignee outcomes against current data.
6. Structure the existing Big-circle remarks into CONFIRMED / PROVISIONAL / ABSENT / CONFLICT root-cause evidence.
7. Only after the read-only runtime gate closes, freeze the bounded root-cause write-plan/runtime acceptance before enabling any ONES mutation.
8. Then advance the transport-neutral Big-circle <-> Relay lane.

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
