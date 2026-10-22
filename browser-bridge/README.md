# Browser Bridge v0.5.17

Configuration-driven ONES browser executor for a Windows-local loopback Relay.

Capabilities:
- `RELAY_PING`
- `ONES_INVENTORY_READ`
- `ONES_FIELD_READ`
- gated `ONES_ROOT_CAUSE_WRITE`

The write capability is not advertised to the Relay unless the explicit local production write gate is enabled in the popup.

The bounded root-cause writer:
- consumes only `UNIQUE_ONES_TASK_ONLY` / `SET_CANDIDATE` / `fill_empty_only` jobs;
- derives the initial job from an exact-hash planner artifact through the bundled enqueue helper;
- requires the job field UUID to equal the locally configured root-cause field UUID;
- v1 bounds desired text to one 1-300 character paragraph;
- takes display ID, task UUID, field UUID, desired text, and plan SHA only at runtime;
- performs a double authoritative pre-write read;
- aborts on drift or non-empty different content;
- requires the exact ONES detail tab; when the root-cause field is in display mode, it canonicalizes the detail-form label, identifies exactly one native `.standard-co-viewer`, scrolls that exact viewer into the viewport, proves the post-scroll hover point, hovers once, revalidates the same viewer and its unique visible action button, then opens it with one bounded browser-native debugger click at that button, then binds the configured field UUID before any input;
- uses exactly one native text insertion, waits only for bounded read-only draft convergence, and then permits at most one Save dispatch;
- verifies both authoritative onesql semantic readback and a new system field event;
- never auto-retries an uncertain write;
- does not fabricate a direct richtext `tasks/update3` payload.

The extension never exports browser Cookie/Authorization/password material to the Relay.

## Issue #110 — operator-only native editor diagnostic (source candidate, NOT runtime accepted)

This source-only tool does not enable `ONES_ROOT_CAUSE_WRITE`, does not enqueue Relay jobs and never dispatches Save.
It uses existing Chrome `debugger` permission. No new manifest permission, version change or packaging/release claim.

Windows operator (after independently reviewed extension source is installed as an unpacked extension):
1. Chrome `chrome://extensions` → Developer mode → Load unpacked → choose the reviewed `browser-bridge` directory. Use the same local ONES scope configuration; leave **Enable production root-cause write gate** unchecked.
2. Open exactly one ONES work-item detail, enter the configured **问题根因** editor, and focus its empty text block. Close DevTools/Protocol Monitor. Do not Save.
3. Open extension popup → **单次原生编辑器诊断** → read the one-run confirmation carefully. The action reads the exact task identity and authoritative root-cause field twice before trying one short synthetic text insertion. If safety proof fails it blocks with zero input.
4. Save **nothing**. The displayed JSON contains only whitelisted metadata (event timing/trust, bounded lengths and SHA-256, focus/selection, mutation counts, semantic classification). **Click Cancel inside ONES**, leaving the same work-item page open. Reopen the popup → **取消后核查服务端** to perform two independent read-only field reads.
5. `SERVER_BLANK_OBSERVED` only means those bounded readbacks were blank, **not a guarantee against delayed SharedDB/online-collaboration synchronization**. On `SERVER_CHANGED_ESCALATE`, `SERVER_UNVERIFIED`, `TRACE_UNCERTAIN`, mismatch or any BLOCKED receipt: stop, do not re-run, do not overwrite/undo server content, escalate to Leader. After a result, copy only the scrubbed receipt, never raw console/Network data.

The receipt records `ARM -> INSPECT_1 -> INSPECT_2 -> AFTER_NATIVE_CLICK -> AFTER_CTRL_A -> BEFORE_INSERT` as bounded metadata. The native-click gate runs before Ctrl+A; a failed click gate sends no key or text command. Each post-click gate preserves the exact bound block/host, focus, selection, blank-draft and geometry checks. `phase` identifies the failed gate, while `phases` records counts, connection/focus booleans, selection-proof enums and bounded event metadata. These fields survive popup reopening and independent server verification, with no raw content, URL or account identifiers. This instrumentation localizes a failure; it does not repair or prove ONES Writer semantics.

The one-input source and synthetic tests do **not** prove genuine ONES editor semantics; that requires an independently authorized real browser trial. No automatic retry, real batch, production writer acceptance, Release promotion or merge. The code is not a browser runtime validation certificate.
