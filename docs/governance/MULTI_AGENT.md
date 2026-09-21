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
