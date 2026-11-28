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

## QT local publication evidence

Each row pins the local QT candidate actually executed. The listed modes belong to those candidates. This record preserves the verification results for review. The raw JSON files remain in the operator-owned QT evidence directory. The table records their filenames and SHA-256 digests.

| Tested source and mode | Verified scope | Local evidence and SHA-256 |
| --- | --- | --- |
| `71089849ca8b3d1f9f7d11f44c7fce13f9373c14` with `--unified-entry` | The `advance` CLI recovered the target after the materializer exited at code 81, after its materialization CHECKPOINT was persisted and before settling the source claim. The unrelated inbox envelope stayed byte-identical. A 216,678-byte synthetic CASE_FEED made one materialized file. The packaged Bridge in Chromium and a temporary Relay completed one four-page synthetic inventory. The CLI reached `WAIT_INVENTORY`, `WAIT_DESTINATION` and then `DESTINATION_RECEIPTS_VERIFIED` after independent local receipt readback. Repeat used the persisted reconciliation and preserved its bytes. | `publication-unified-71089849ca.json` · `cf864199abe51d852333cc9da77b8d0bcb755e74d6ade7c373c5c3ac5dec439b` |
| `7bbfb5c8443255cd1ecc494387aa8da48f8562c7` with `--result-claim-cut-only` | With a seeded inventory, the receiver exited at code 79 after storing the RESULT receipt and before settling that claim. Missing CHECKPOINT and a mismatched claimed envelope held confirmation. The intact pair settled only the named RESULT, and replay reported `ALREADY_PROCESSED`. Receipt and sender bytes were preserved. A separate `--return-only` check retained CHECKPOINT recovery on this candidate. | `publication-result-cut-green-7bbfb5c844.json` · `8bec46651902b407c1f53c57a06065ce94b603eb707fd1ad36274507514d84ac` |
| `bff8ee558e823a1a72fedfd0b461f8af74beac74` with `--checkpoint-first` | With fresh four-page synthetic browser inventory, CHECKPOINT arrived first. Confirmation held until the original RESULT arrived. Recovery preserved CHECKPOINT bytes and added zero imports or inventory jobs. | `publication-checkpoint-first-bff8ee558e.json` · `55d56ee0ca60c4f3d6a3dfadd177f05926636f936db1bf8356cd06369cd8d9c5` |
| `f6d6cbadf86bcad7bd74297a5aa6c794a4a56fba` with `--cross-run-only` | Two synthetic publication revisions shared the attachment digest and source envelope. Confirming against the local publication checkpoint accepted the same-run pair and held both a crossed CHECKPOINT and a swapped pair. The feed was materialized once and the prior receipts stayed intact. | `publication-cross-run-green-f6d6cbadf8.json` · `219cccd6225e78f940f1577a6837381c4510f9da9ee1afe336be4c2dcc614ce2` |

The RESULT crash before the fix reproduced a false paired acknowledgement with its claim still open in `publication-result-cut-red-bff8ee558e.json` · `f0a867d7069363201b911036b5a70c217db51a99cfe70b9975a655387d8906f8`. The CHECKPOINT recovery regression is `publication-return-7bbfb5c844.json` · `e4d052d4bf261b6e41a84d2e8512ebac0d727b9931875810f5cc76ab31f50e5f`.

These are local synthetic results. Unattended retrieval of a native Big-circle scheduled CASE_FEED and independent same-run return remain unverified. Live ONES batch writes and restoration remain unverified. The recorded tests made zero ONES writes.

A transport ACK records durable attachment intake. Advance the producer's verified reconciliation checkpoint only after destination readback proves the paired RESULT and CHECKPOINT for the same publication. After interruption, resume the original identifiers and claims before considering fresh work.
