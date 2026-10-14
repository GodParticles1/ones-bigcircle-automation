# Issue #112: Native editor diagnostic candidate (review-only)

This archive is a **separate unpacked Chrome extension candidate**, not a replacement Windows Relay installation, not frozen Bridge b0.5.17, and not an accepted v0.5.18 writer. Manifest still declares 0.5.17 for source compatibility: **no version promotion**. Do not install or operate until Leader independently approves the exact archive and its source.

## Review and installation sequence (Windows)

1. Obtain the exact candidate ZIP and `.sha256` sidecar from its own approved CI run. Confirm the ZIP SHA256 with PowerShell: `(Get-FileHash -Algorithm SHA256 -LiteralPath <candidate.zip>).Hash.ToLowerInvariant()`. Match `BUNDLE-MANIFEST.json.sourceHead` against the reviewed GitHub commit and verify *every* entry hash/length using the provided CI test.
2. Extract to a **new empty directory** outside any existing installation. Do **not** overwrite `D:\tools\ones-root-cause-runtime-v0.1.0`, `relay.db`, old extension files or existing Relay token. No automatic migration, import, background installer, network download or backend change.
3. Only after Leader approves operator trial: open `chrome://extensions`; temporarily **disable** the old unpacked Bridge (keep its files intact). Load the extracted directory containing `manifest.json` as the sole active Bridge. Explicitly reconfigure local ONES scope and loopback Relay token as needed; the candidate does not copy Chrome storage, credentials, origin grants, sessions or existing Relay state. Keep production **WRITE_GATE=OFF**.
4. Diagnostic is a **synthetic draft mutation** with possible SharedDB auto-sync, *not* a read-only action. For separately approved runtime validation only: exactly one ticket, one verified empty field, at most one native insert, never Save. Cancel does not prove server rollback: independently read the authoritative server field afterward; if uncertain or changed, stop and escalate. Runtime acceptance is **NOT_RUN**.
5. Roll back by disabling/removing only the candidate extension in Chrome, re-enabling the previously installed accepted read-only Bridge, and checking its existing read-only handshake. Keep Relay process, token, DB and user data untouched. Never delete the old extension or claim that enabling an old extension undoes synchronized drafts.

## Immutable identity and checks

Package label: `ones-native-editor-diagnostic-CANDIDATE-c<source-HEAD-prefix>`. The source-bound inventory lists exact SHA256 and size of all eight Browser Bridge startup/popup/docs files plus this document. `BUNDLE-MANIFEST.json` is a self-contained metadata record inside the ZIP, not a Chromium manifest replacement. No additional Chrome permissions or URLs are added. Distribution, integration, production-write and actual ONES acceptance remain subject to independent Leader review.

**Never install the PR #111 CI artifact labelled as the frozen v0.5.17 full installer**: that older builder omits `native-editor-diagnostic.js`.
