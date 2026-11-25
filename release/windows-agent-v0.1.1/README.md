# ONES Big-circle Windows Local Agent candidate (base v0.1.1)

This is the corrected provider-neutral Windows package.

It intentionally does NOT require:
- Cloudflare API key;
- remote BaseUrl;
- remote HMAC secret;
- HTTPS transport;
- any ONES write capability.

It consolidates the already-accepted local periodic alignment code so the old code directory `ones-periodic-alignment-v1` can be retired after Task Scheduler is repointed.

Default local paths:
- Case feed search root: D:\tools
- Relay: D:\tools\ones-local-relay-v0.2.1
- Reconciliation: D:\tools\ones-bigcircle-reconciliation-v0.2.1
- Runtime state: D:\tools\periodic-alignment-runtime

Historical v0.1.1 installation sequence (applies to the accepted base release):
1. Extract the approved base release to D:\tools\ones-bigcircle-windows-agent-v0.1.1
2. Run setup.ps1
3. Run show-status.ps1
4. Run run-once.ps1

The existing Local Relay token/relay.db and Browser Bridge configuration are not moved or changed by this package.

## Local candidate: optional read-only UUID observation

This is a source-candidate instruction. The existing released v0.1.1 package is subject to its own accepted version and pairing. The builder names the candidate `ones-bigcircle-windows-agent-CANDIDATE-c<source-head-prefix>.zip` and refuses to overwrite an existing candidate output. `BUILD.json` records `releaseStatus=CANDIDATE`, the full `packageCandidateSha`, and the exact external reconciliation file hashes. `VERSION.json` preserves the historical base version and source baseline; it is not the candidate identity. Inspect the candidate's `show-status.ps1` output for the full source head. Keep the base installation and its configuration untouched until a separate release decision.

The candidate launcher and periodic script must be paired with `reconciliation/run-stage.ps1`, `reconciliation/pipeline.py`, `reconciliation/reconcile.py`, and `reconciliation/observe_inventory.py` from the same candidate checkout with the exact Windows file bytes listed in `BUILD.json`. The Windows-local-agent package builder includes the launcher and periodic script; its reconciliation directory remains an external configured dependency. In an approved candidate deployment, set `ReconciliationDir` in the candidate's isolated `config.ps1` to that candidate directory, or supply it per run. Keep the configured case-feed, relay and runtime directories. Examples using placeholders:

```powershell
Get-Help .\run-once.ps1 -Examples
.\run-once.ps1 -ReconciliationDir 'C:\candidate\reconciliation'
.\run-once.ps1 -ReconciliationDir 'C:\candidate\reconciliation' -ObserveAssignee '<assignee-uuid>'
```

The default command retains the full-alignment success states `RECONCILIATION_VERIFIED` and `RECONCILIATION_NOOP_VERIFIED`. The explicit opt-in returns `READONLY_UUID_OBSERVATION`, `baseline` and `newTaskUuids`, with local history in `uuid-observation.json` under the configured runtime directory. First use or a scope change establishes a baseline; reuse the directory for subsequent scans of the same installation. The observation is local and has no ONES mutation or notification capability. The scheduler and provider-neutral agent retain their existing full-alignment workflow.

The packaged launcher requires `BUILD.json` for both modes. A `PACKAGE_MANIFEST_MISSING` block requires restoring the verified candidate archive into an isolated directory. For an explicit source-checkout run, invoke `periodic-alignment/run-once.ps1` directly using its documented parameters.

For `PERIODIC_ALIGNMENT_WAIT_ONES`, restore the supported read-only Relay/Bridge session and rerun the same command when the inventory is complete. For `PERIODIC_ALIGNMENT_BLOCKED` with `RECONCILIATION_PAIR_MISMATCH`, inspect `requiredFile` and `packageCandidateSha`; use the byte-matching external component set from that head. For source launches with `RECONCILIATION_COMPONENT_MISMATCH`, inspect `requiredFile` and `requiredOption` and point `ReconciliationDir` at the matching candidate source directory before retrying. For a busy observation, wait for the other local scan to finish; keep the history and lock file. Failed reads do not advance the observation or reconciliation history. Do not delete the history to clear an error.

The source-level synthetic launch comparison is documented in `periodic-alignment/README.md`. Distribution requires an independently reviewed candidate, exact-head CI and a separately accepted package; these instructions do not promote the existing release.
