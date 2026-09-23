# Root Cause Production Write Contract v1

Status: IMPLEMENTATION_ACTIVE / LIVE_RUNTIME_PENDING

This contract is the bounded production executor continuation of `ROOT_CAUSE_SYNC_V1`.

## Authorized target population

The executor may consume only `taskTargets[]` emitted under:

`taskTargetPolicy = UNIQUE_ONES_TASK_ONLY`

and only rows with:

- `decision = SET_CANDIDATE`;
- one exact ONES task UUID;
- one runtime-configured root-cause field UUID;
- a non-empty confirmed desired root-cause value (v1 bounded to one 1-300 character single paragraph);
- `writeMode = fill_empty_only`;
- an exact accepted planner SHA256;
- the runtime field UUID must equal the locally configured root-cause field UUID.

Case-level `cases[]` is diagnostic only and is not a write-authority surface.

## Write algorithm

For one target:

1. resolve runtime display ID and require exact task UUID identity;
2. authoritative read #1;
3. snapshot current system field events;
4. authoritative read #2 immediately before edit;
5. if reads drift, BLOCK;
6. if current equals desired, NOOP_VERIFIED;
7. if current is non-empty and different, CONFLICT_REVIEW;
8. if current is blank, require the native richtext editor for the exact field;
9. require one unique active text block and one unique Save control;
10. native browser input only;
11. verify the DOM draft equals desired;
12. dispatch Save exactly once;
13. read back authoritative semantic field value and require a new system field event;
14. only then return WRITE_VERIFIED.

If Save may have been dispatched but verification is uncertain, return WRITE_UNVERIFIED and never auto-retry.

## Rollback

A genuine desired production root cause is not automatically rolled back after successful acceptance.

Rollback is a separate explicit operation requiring:
- the exact write checkpoint;
- proof that the current value still equals the value written by that checkpoint;
- an authorized rollback action through the same native richtext editor path;
- authoritative empty-value readback and a new field event.

## Initial rollout

The first live acceptance is exactly one real SET_CANDIDATE target. Do not fan out to the remaining candidates in that same run.

## Explicitly excluded

- bulk writes before single-target runtime acceptance;
- direct fabricated richtext `tasks/update3`;
- arbitrary-field mutation;
- create/import;
- owner/status/project/priority/delete;
- blind retry after uncertain delivery.
