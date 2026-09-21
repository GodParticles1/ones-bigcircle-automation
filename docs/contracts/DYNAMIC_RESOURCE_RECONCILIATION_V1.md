# Dynamic Resource Reconciliation Contract v1

Status: ACTIVE

Schema: `xrocket.dynamic-resource-reconciliation/v1alpha1`

## Purpose

Model Big-circle confirmed-case state and ONES external-ticket state as changing resources instead of fixed-count datasets.

The controller periodically performs authoritative full reads, compares opaque resource revisions and exact content hashes, and runs reconciliation only when the accepted input pair changes.

This contract borrows Kubernetes-style LIST / WATCH / reconcile / observed-version semantics without requiring Kubernetes, etcd, a remote queue, or a long-lived watch stream.

## Core rule

Historical row counts are never versions.

A resource is identified by:
- logical kind;
- opaque `resourceVersion`;
- exact `contentSha256`;
- observation time.

A reconciliation checkpoint records the exact pair that was observed and accepted.

## Resource envelope

Every resource presented to the alignment controller uses:

```json
{
  "apiVersion": "xrocket.dynamic-resource-reconciliation/v1alpha1",
  "kind": "BigCircleConfirmedCaseFeed",
  "metadata": {
    "resourceVersion": "opaque-source-local-revision",
    "observedAt": "RFC3339 timestamp",
    "contentSha256": "lowercase sha256"
  },
  "spec": {}
}
```

Supported v1 kinds:
- `BigCircleConfirmedCaseFeed`;
- `OnesExternalTicketInventory`.

`resourceVersion` is opaque. Consumers must compare it for equality only and must not parse it as a timestamp, integer or global sequence.

If a source has no native revision token, an adapter may use a deterministic synthetic revision derived from the exact accepted semantic content. The adapter must not generate a new revision merely because the same unchanged resource was observed again.

`contentSha256` binds to the exact accepted snapshot bytes or the contract-defined canonical bytes when raw transport bytes are not stable.

## Version and generation semantics

For v1:
- snapshot-level `resourceVersion` answers "did this logical resource change?";
- `contentSha256` answers "what exact content was reconciled?";
- the reconciliation checkpoint stores the last observed versions and hashes.

Optional future item-level `generation` / `observedGeneration` may be added for per-case synchronization. They are not required for v1 snapshot reconciliation and must not be invented from row counts.

## Authoritative LIST

A full LIST is the source of truth.

Every alignment cycle obtains:
1. one current Big-circle CASE_FEED_V1 resource;
2. one fresh completeness-verified ONES inventory resource.

The ONES LIST remains subject to the existing inventory gate:
- `status=INVENTORY_VERIFIED`;
- `inventoryComplete=true`;
- `reconciliationAllowed=true`;
- `ticketCount == serverTotalCount == visiblePageTotal == len(tickets)`.

The Big-circle LIST remains subject to CASE_FEED_V1 fidelity gates.

If either LIST is unavailable, incomplete, ambiguous or fails its contract, the controller must not declare missing tickets and must not advance the last verified reconciliation checkpoint.

## Synthetic WATCH

v1 does not require a native streaming watch.

The accepted initial implementation is:

`periodic LIST -> compare versions/hashes -> reconcile only on change`

Default operational target: approximately every 2 hours.

The cadence is policy, not data semantics. A later implementation may use event hints to trigger an earlier cycle, but the full LIST remains authoritative.

## Optional watch events

A future adapter may emit hints:
- `ADDED`;
- `MODIFIED`;
- `DELETED`;
- `BOOKMARK`;
- `RESYNC_REQUIRED`.

Watch events are triggers only. They do not replace the next authoritative LIST.

A `DELETED` event means only that a source resource/item disappeared. It never authorizes deletion in ONES.

A lost cursor, browser sleep, process restart, gap, or uncertain ordering must produce `RESYNC_REQUIRED` and force a new full LIST.

## Alignment cycle

For each cycle:

1. LIST Big-circle.
2. LIST ONES.
3. Validate both resources.
4. Read the last alignment checkpoint.
5. Compare the current exact pair with the last observed pair.
6. If both accepted versions/hashes are unchanged:
   - emit `ALIGNMENT_NOOP`;
   - do not rerun reconciliation.
7. If either resource changed:
   - run the integrated person-aware reconciliation against the exact current pair;
   - require `RECONCILIATION_VERIFIED`;
   - atomically advance the alignment checkpoint.
8. If validation or reconciliation is blocked:
   - preserve the previous verified checkpoint;
   - emit a WAIT/BLOCK state;
   - never roll back Big-circle scan state.

## Alignment checkpoint

Minimum fields:

```json
{
  "apiVersion": "xrocket.dynamic-resource-reconciliation/v1alpha1",
  "kind": "AlignmentCheckpoint",
  "state": "ALIGNMENT_VERIFIED",
  "observed": {
    "bigCircle": {
      "resourceVersion": "...",
      "contentSha256": "..."
    },
    "ones": {
      "resourceVersion": "...",
      "contentSha256": "..."
    }
  },
  "reconciliation": {
    "runKey": "...",
    "reportSha256": "...",
    "implementationVersion": "0.2.1"
  },
  "verifiedAt": "..."
}
```

Checkpoint writes must be atomic.

## Controller outcomes

Required v1 outcomes:
- `ALIGNMENT_VERIFIED`: changed exact pair reconciled and checkpointed;
- `ALIGNMENT_NOOP`: exact pair unchanged from the last verified checkpoint;
- `ALIGNMENT_WAIT_BIGCIRCLE`: no accepted current Big-circle resource;
- `ALIGNMENT_WAIT_ONES`: no fresh completeness-verified ONES resource;
- `ALIGNMENT_BLOCKED`: contract or reconciliation failure;
- `ALIGNMENT_RESYNC_REQUIRED`: event/watch continuity is uncertain and a full LIST is required.

WAIT/BLOCK/RESYNC states never overwrite the previous verified checkpoint.

## Scheduling relationship

The existing Big-circle workday 19:30 scan remains independent and unchanged.

The alignment controller is a separate reconciliation cadence. Its default target may be every 2 hours and may run even when Big-circle did not change, because ONES can change independently.

A cycle is cheap when neither resource changed because it terminates at `ALIGNMENT_NOOP`.

## Transport boundary

This contract is transport-neutral.

It does not select:
- webhook;
- WebSocket;
- polling provider;
- cloud queue;
- remote queue vendor.

Adapters may later transport LIST resources or watch hints, but they must preserve this exact resource/checkpoint contract.

Local Relay remains loopback-only. Browser credentials are never exported.

## Safety boundary

This contract grants no new mutation capability.

Still disabled:
- production ONES field writes;
- automatic ONES create/import;
- automatic ONES delete;
- owner/status/project/priority mutation;
- Remote Queue implementation.

All currently accepted reconciliation identity/person-scope rules remain unchanged.
