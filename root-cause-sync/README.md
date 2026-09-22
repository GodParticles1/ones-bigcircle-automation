# Root-cause synchronization planner

This module implements the execution-free planning slice of Issue #6.

It consumes four explicit artifacts:

1. exact `CASE_FEED_V1` JSON;
2. reconciliation v0.2.1 report bound to the exact case-feed raw SHA256;
3. Gate-E root-cause extraction report;
4. a read-only current-field snapshot for the runtime-configured ONES root-cause field.

It emits only plan decisions:

- `SET_CANDIDATE`;
- `NOOP`;
- `CONFLICT_REVIEW`;
- `BLOCK`.

The planner does not call Browser Bridge or Local Relay, does not enqueue jobs, and does not mutate ONES.

## Field-read snapshot

Planner input uses the local planning schema:

`ones.root-cause-field-read/v1alpha1`

Minimum shape:

```json
{
  "schema": "ones.root-cause-field-read/v1alpha1",
  "complete": true,
  "fieldId": "runtime-configured-field-id",
  "capturedAt": "2026-09-22T00:00:00Z",
  "reads": [
    {
      "onesTaskUuid": "exact-task-uuid",
      "fieldId": "runtime-configured-field-id",
      "status": "READ_VERIFIED",
      "value": null,
      "capturedAt": "2026-09-22T00:00:00Z"
    }
  ]
}
```

An unread, missing, duplicate, mismatched or non-`READ_VERIFIED` field row never means blank.

## Comparison rule

V1 uses deterministic normalized-exact comparison only:

- CRLF/CR becomes LF;
- leading/trailing whitespace is ignored;
- internal text, punctuation and case are preserved.

No fuzzy matching, token similarity, LLM inference or domain inference is used.

## Example

```bash
python root-cause-sync/plan.py \
  --cases case-feed.json \
  --reconciliation reconciliation.json \
  --root-cause root-cause-report.json \
  --field-reads field-read-snapshot.json \
  --field-id runtime-configured-field-id \
  --output root-cause-sync-plan.json
```

A future live current-field reader and a future bounded write executor are separate gates. This module does not implement either one.
