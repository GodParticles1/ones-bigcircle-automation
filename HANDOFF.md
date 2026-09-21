# Handoff

## Integrated bases

- Browser Bridge v0.4.0: integrated on main by merge `4cb9d265ad566e4d30ef00141df82f4ec1ce7694`.
- Local Relay v0.2.1: current loopback runtime base.
- Reconciliation pipeline v0.2.0: current checkpointed/idempotent reconciliation base.

## Immediate continuation

Do not wait for the scheduled 19:30 Big-circle run.

1. Run Windows Chrome runtime acceptance for Browser Bridge v0.4.0 against Local Relay v0.2.1.
2. Manually trigger the existing Big-circle task using the already accepted downstream reconciliation semantics.
3. Pair the resulting current case feed with a fresh completeness-verified ONES inventory snapshot.
4. Verify first-run reconciliation and exact-input NOOP behavior.
5. Confirm population-aware results: local duty/handler names and ONES assignee names align the per-person populations; exact-key membership identifies the case; raw count equality is never required.
6. After the read-only gates close, freeze the bounded root-cause synchronization runtime contract before enabling any ONES mutation.
7. Then advance the transport-neutral Big-circle <-> Relay lane.

## Product outcome model

`confirmed local cases -> exact shared inventory reconciliation`

Branches:

- exact key absent from complete inventory -> `ONES_MISSING_CASE` -> human supplementation;
- exact key exists + compatible person scope -> `MATCHED` -> candidate for confirmed-field synchronization;
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
