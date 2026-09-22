# Windows Agent CASE_FEED materializer v1

This Gate D2 slice consumes one validated inbound CASE_FEED envelope from the durable spool and materializes the exact original CASE_FEED bytes into the local directory already consumed by periodic alignment.

Behavior:

- claim one inbound envelope from the Windows Agent spool;
- require `kind=CASE_FEED`;
- validate the accepted CASE_FEED schema/completeness/count boundary;
- preserve exact payload bytes and SHA256;
- materialize as `case-feed-<sha256>.json` atomically;
- existing identical artifact is a deterministic NOOP;
- emit a `CHECKPOINT` envelope to the outbox;
- mark the source envelope processed only after materialization/checkpoint success;
- failures move the claim to rejected.

This remains provider-neutral and does not enable Remote Queue, browser mutation, or ONES writes.
\n\n# Windows Agent run-once v1

This slice connects the accepted inbound CASE_FEED materializer to the existing periodic read-only alignment path.

One run:

1. materialize one inbound CASE_FEED envelope when present;
2. invoke the accepted `periodic-alignment/run-once.ps1`;
3. accept only `RECONCILIATION_VERIFIED` or `RECONCILIATION_NOOP_VERIFIED`;
4. emit a RESULT envelope to the Windows Agent outbox;
5. emit a CHECKPOINT envelope binding the reconciliation result and the source CASE_FEED envelope when one was consumed.

WAIT/BLOCK/malformed downstream outcomes do not emit success envelopes.

This remains provider-neutral and read-only with respect to ONES.
