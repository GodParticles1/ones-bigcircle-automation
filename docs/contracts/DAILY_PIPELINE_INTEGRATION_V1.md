# Daily Pipeline Integration Contract v1

Existing Big-circle case-maintenance workflow remains authoritative. Reconciliation runs only after the local scan reaches `SCAN_COMPLETE`.

`SCAN_COMPLETE -> CASE_FEED_BUILD -> INVENTORY_GATE -> RECONCILIATION -> MISSING_REPORT -> RECONCILIATION_CHECKPOINT`

The local scan checkpoint and reconciliation checkpoint are independent.

If inventory is unavailable/incomplete, reconciliation waits/blocks without rolling back the already-successful local scan, weekly-table writes or prior verified reconciliation state.

This contract does not add transport or ONES write authority.

## Native task and engineering-source boundary

- The Big-circle scheduled task runs inside Big-circle, using only platform-native abilities and the currently authorized case/chat context. Access to an external engineering source repository is **not verified** and must never be assumed or used as a task prerequisite.
- Operator-facing task instructions must be **self-contained**. Do not include GitHub, pull-request references, code-hosting links, source checkout instructions or other development-context identifiers in text intended to be pasted into Big-circle. A user reported that an earlier instruction carrying such a reference was blocked; the precise content-filter trigger is not independently verified.
- Keep two acceptance gates separate: updating an engineering template/PR is **not** editing the live scheduled task; task completion requires native task-definition update, actual readback and bounded representative-case verification.
- A chat-file card/link/title is not verified attachment body access. File-body extraction must be checked inside the Big-circle runtime before its contents can be promoted to a case conclusion.
- Future ONES extensions preserve the accepted CASE_FEED_V1 and downstream transport/read-before-write contracts. Do not infer source-repository ingestion, browser credential sharing or ONES mutation permission from a task instruction.
