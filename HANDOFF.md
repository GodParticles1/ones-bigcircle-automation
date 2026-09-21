# Handoff

## Current accepted local evidence

Reconciliation pipeline v0.2.0 was locally accepted with synthetic/public-independent semantics matching the private runtime lineage:

- first run: `RECONCILIATION_VERIFIED`;
- exact rerun: `RECONCILIATION_NOOP_VERIFIED`;
- checkpoint/report bytes remain stable on exact rerun;
- invalid/incomplete inventory blocks without overwriting prior verified state.

Historical internal runtime lineage hashes are recorded in `docs/provenance/PRIVATE_RUNTIME_LINEAGE.md` without publishing private configuration.

## Current active lane

Public-safe browser bridge projection. Do not paste the internal v0.3.36 source directly into this public repository because it contains private origin/tenant IDs and historical bounded-acceptance target identifiers.

## Frozen boundaries

- no Remote Queue implementation;
- no automatic ONES create/import;
- no production root-cause write;
- no owner/status/project/priority/delete automation;
- no browser credential export;
- no fuzzy title matching.
