# Gate D2 Windows local runtime acceptance

This directory contains the synthetic, non-production runtime acceptance harness for the integrated P4a-P4f transport spine.

It proves on a Windows runner:

- exact CASE_FEED payload-byte and SHA256 preservation;
- Big-circle outbox -> filesystem exchange -> Windows inbox;
- duplicate export/import NOOP behavior;
- spool claim -> processed and rejected transitions;
- CASE_FEED exact-byte materialization;
- the actual Windows Agent run-once subprocess boundary;
- the real reconciliation pipeline using a synthetic completeness-verified inventory;
- first-run `RECONCILIATION_VERIFIED` and exact-input `RECONCILIATION_NOOP_VERIFIED`;
- RESULT/CHECKPOINT reverse exchange and Big-circle receipt persistence;
- fail-closed rejection of an incomplete CASE_FEED.

The synthetic periodic-alignment script replaces only the live Browser/Relay inventory acquisition step so Gate D2 transport/runtime acceptance stays isolated from Issue #20.

This does **not** prove a production cross-environment provider. It does not select/open Remote Queue, does not use browser credentials, and does not enable any ONES mutation.
