# Handoff

## Integrated bases

- Browser Bridge v0.4.0: integrated on main by merge `4cb9d265ad566e4d30ef00141df82f4ec1ce7694`.
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

## Immediate continuation

Do not wait for the scheduled 19:30 Big-circle run.

1. Run Windows Chrome runtime acceptance for Browser Bridge v0.4.0 against Local Relay v0.2.1.
2. Use the accepted case-feed snapshot SHA256 `41dffdcbd731ab55307a9764f35fca6715938d1d096b21beef25156116909fb8`; do not rebuild it for this acceptance run.
3. Capture a fresh completeness-verified ONES inventory snapshot through Browser Bridge v0.4.0 + Local Relay v0.2.1.
4. Run the integrated v0.2.1 person-aware reconciliation against those exact two inputs and verify exact-input NOOP behavior.
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
