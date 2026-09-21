# Handoff

## Current accepted local evidence

Reconciliation pipeline v0.2.0 was locally accepted with synthetic/public-independent semantics matching the private runtime lineage:

- first run: `RECONCILIATION_VERIFIED`;
- exact rerun: `RECONCILIATION_NOOP_VERIFIED`;
- checkpoint/report bytes remain stable on exact rerun;
- invalid/incomplete inventory blocks without overwriting prior verified state.

Historical internal runtime lineage hashes are recorded in `docs/provenance/PRIVATE_RUNTIME_LINEAGE.md` without publishing private configuration.

## Current active lane

Public-safe browser bridge projection v0.4.0 on `migration/browser-bridge-public-v040`. It externalizes origin/team/project/issue-type/department scope into local configuration and removes all historical write UI/handlers. The candidate requires independent semantic review + exact-head CI, then a local runtime acceptance before it can supersede the internal v0.3.36 executor.

## Frozen boundaries

- no Remote Queue implementation;
- no automatic ONES create/import;
- no production root-cause write;
- no owner/status/project/priority/delete automation;
- no browser credential export;
- no fuzzy title matching.
