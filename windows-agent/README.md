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
