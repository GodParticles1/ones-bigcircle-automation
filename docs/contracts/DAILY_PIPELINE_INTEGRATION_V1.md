# Daily Pipeline Integration Contract v1

Existing Big-circle case-maintenance workflow remains authoritative. Reconciliation runs only after the local scan reaches `SCAN_COMPLETE`.

`SCAN_COMPLETE -> CASE_FEED_BUILD -> INVENTORY_GATE -> RECONCILIATION -> MISSING_REPORT -> RECONCILIATION_CHECKPOINT`

The local scan checkpoint and reconciliation checkpoint are independent.

If inventory is unavailable/incomplete, reconciliation waits/blocks without rolling back the already-successful local scan, weekly-table writes or prior verified reconciliation state.

This contract does not add transport or ONES write authority.
