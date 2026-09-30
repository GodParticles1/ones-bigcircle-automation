# Multi-Agent / Writer Governance

Every writer lane must define:

- repository and issue;
- accepted base SHA;
- writer branch;
- bounded goal;
- owned files/subsystem;
- shared hot spots;
- allowed/forbidden changes;
- required tests/evidence;
- stop conditions.

Writers do not self-merge, force-push, expand product scope, weaken privacy/safety gates or claim PASS from stale SHA evidence.

Recommended PR signals: `WRITER_PROGRESS:`, `WRITER_FINAL:`, `WRITER_BLOCKED:`.

## Execution truth

A Leader Dispatch, its issue comment or branch creation proves only `DISPATCHED`, not Writer execution. Report `EXECUTION_OBSERVED` only from a lane-attributable `WRITER_PROGRESS:` report, a Writer-produced branch HEAD different from the accepted base SHA, or an existing Writer checkpoint containing an actual executed action/test and its result. Bind the witness to this repository, issue, accepted base and Writer branch; quoted markers, administrative branch activity and another lane's evidence do not qualify. A pre-launch `WRITER_BLOCKED:` is not an execution witness by itself.

This is evidence about execution, not another `LANE_STATE`, acceptance decision or claim that the Writer is still running. No visible witness means not observed by this read, not proof that execution never occurred. Report/CI/runtime acceptance retain their existing owners.

## Runtime parity

Carry acceptance-relevant runtime facts into the existing lane Dispatch and tests, with a concrete assertion/evidence boundary for each selected fact. For Windows/Relay lanes this may mean the exact PowerShell invocation, preserved database/WAL/SHM state, historical parent payloads, null versus absent, property-order versus value equality, UTF-8, upgrade preservation, isolated test services and the enqueue/restart/deduplication chain. Select only boundaries that can change this lane's acceptance; do not require a fixed all-platform table.

Reuse existing contracts and tests. Unknown or unexecuted runtime boundaries remain explicit and do not become PASS from synthetic tests or CI; existing browser/production gates are unchanged. An implementation or harness miss is repaired in its owning code/tests, not by adding repeated reminders.
