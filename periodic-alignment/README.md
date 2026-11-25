# Periodic read-only alignment

This is a deliberately small Windows-local run-once wrapper for Issue #14.

It does not introduce a controller framework, LIST/WATCH protocol, Remote Queue, or any ONES write capability.

Each invocation:

1. recursively selects the newest valid CASE_FEED_V1 JSON from a configured directory, so month subdirectories and numbered duplicate filenames do not need special handling;
2. verifies a live Local Relay and a fresh read-only Browser Bridge executor;
3. enqueues one ONES_INVENTORY_READ job;
4. waits for INVENTORY_VERIFIED, then validates the candidate file with the reconciliation inventory gate before archiving it;
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

A fresh ONES inventory normally contains a new capture timestamp/job provenance, so a later 2-hour capture is expected to produce a new exact input hash and may legitimately return RECONCILIATION_VERIFIED even when the business ticket set is unchanged. The default alignment path compares exact inputs.

## Scoped UUID observation

Add `-ObserveAssignee <assignee-uuid>` to the same run-once command to collect an observation. Use `Get-Help .\run-once.ps1 -Parameter ObserveAssignee` for the parameter description. The Windows local agent launcher also accepts this opt-in; see its [candidate startup instructions](../release/windows-agent-v0.1.1/README.md). Both paths require the matching candidate reconciliation directory.

Reuse the same runtime directory for consecutive scans of this ONES installation. The first complete scan of a scope establishes its baseline. Later scans return `newTaskUuids` and store the cumulative history and latest successful report together in `uuid-observation.json`. An incomplete read leaves that file and the full reconciliation outputs intact. The observation lock serializes scans before the read job is enqueued. A `RECONCILIATION_COMPONENT_MISMATCH` block reports the missing CLI file and option; correct the candidate directory and retry with the same runtime. Keep the lock file and history in place.

### Repeat the synthetic Windows acceptance

From the topic checkout, use the same fixture directory on subsequent runs. The check also accepts an empty directory on first use.

```powershell
$env:QT_ONES_SYNTHETIC_DIR = Join-Path (Resolve-Path ..) 'qt-synthetic-runtime'
python -B periodic-alignment/tests/test_archive.py -v
```

The check runs the periodic PowerShell entry, the Browser Bridge's pagination function and the Python observer. An in-process mock supplies the relay responses, and the JavaScript fixture supplies the ONES pages. It checks a three-page scan, an HTTP 503 on the next scan's second page, byte-identical runtime files after failure, recovery and exact replay. The short JSON receipt printed at the end contains the observed UUID deltas. The fixture retains its synthetic feed, observation and full reconciliation files for inspection.

Run only the startup and component-pairing comparison, using the same fixture:

```powershell
python -B periodic-alignment/tests/test_launch.py -v
```

This check exercises the package launcher with a missing manifest and the explicit source periodic entry, dispatched in-process to the existing synthetic relay. It verifies default and opt-in isolation and the pre-read block for mismatched components. The actual candidate bundle test verifies both package modes with and without the manifest.
