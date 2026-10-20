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
- Distinguish **group-chat text**, **Big-circle native online documents**, and **uploaded binary/file attachments** as different sources. The user intends to put symptoms/errors, root causes, recovery methods and final acceptance in chat messages plus native online documents. Do not misclassify shared native document cards as ZIP/PDF uploads or infer their readability from upload-file media-extract failures.
- The platform has user-observed native online-document creation/view capabilities, but the scheduled group-chat scan's automatic handoff from a shared document card/link to the **full document body** is not yet independently acceptance-tested. Do not claim either universal support or impossibility. For relevant same-case documents, test native document read/access through the platform's permitted interface, preserve document identification/version/time and source-bound facts in existing `remarks`; a card/link/title alone is not verified body content.
- Uploaded file formats remain a separate media-extraction capability gate (actual type, size, permissions and body-read success). A failed ZIP/PATCH extraction must not be generalized to native online documents. Unreadable or unvisited content is `BODY_NOT_VERIFIED`, not negative evidence for case resolution.
- Future ONES extensions preserve the accepted CASE_FEED_V1 and downstream transport/read-before-write contracts. Do not infer source-repository ingestion, browser credential sharing or ONES mutation permission from a task instruction.
