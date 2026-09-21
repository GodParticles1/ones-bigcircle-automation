# Periodic read-only alignment

This is a deliberately small Windows-local run-once wrapper for Issue #14.

It does not introduce a controller framework, LIST/WATCH protocol, Remote Queue, or any ONES write capability.

Each invocation:

1. recursively selects the newest valid CASE_FEED_V1 JSON from a configured directory, so month subdirectories and numbered duplicate filenames do not need special handling;
2. verifies a live Local Relay and a fresh read-only Browser Bridge executor;
3. enqueues one ONES_INVENTORY_READ job;
4. waits for INVENTORY_VERIFIED and checks completeness counts;
5. persists that exact inventory snapshot locally;
6. invokes the existing reconciliation/run-stage.ps1;
7. returns the existing RECONCILIATION_VERIFIED or, when the exact input bytes repeat, RECONCILIATION_NOOP_VERIFIED status.

WAIT paths do not invoke reconciliation and therefore do not advance its checkpoint.

Example:

```powershell
.\run-once.ps1 `
  -CaseFeedDir "C:\path\to\case-feeds" `
  -RelayDir "C:\path\to\ones-local-relay-v0.2.1" `
  -ReconciliationDir "C:\path\to\reconciliation"
```

The approximately-2-hour cadence is an operational policy to be installed only after run-once runtime acceptance. The existing workday 19:30 Big-circle scan remains unchanged.

Runtime paths and private environment identifiers are parameters and must never be committed to the public repository.

A fresh ONES inventory normally contains a new capture timestamp/job provenance, so a later 2-hour capture is expected to produce a new exact input hash and may legitimately return RECONCILIATION_VERIFIED even when the business ticket set is unchanged. This wrapper does not add a semantic-diff layer.
