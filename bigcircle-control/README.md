# Big-circle RESULT/CHECKPOINT consumer v1

Consumes one inbound Windows Agent envelope from the durable spool and persists a bounded local receipt.

Accepted:
- RESULT: RECONCILIATION_VERIFIED / RECONCILIATION_NOOP_VERIFIED
- CHECKPOINT: RECONCILIATION_ACCEPTED / CASE_FEED_MATERIALIZED

The consumer reuses the accepted transport-envelope validator, rejects unsupported kinds/statuses/schemas, atomically persists receipts, and cross-checks reconciliation checkpoints against an already received RESULT when available.

No provider/network/Remote Queue or ONES mutation is implemented here.
