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

## Read-only account and single-task binding preflight (candidate)

The popup's identity/binding action is an extension-local side channel, not a Relay job and not a Writer operation. It requires the production write gate OFF, an already granted origin permission and one active ONES detail tab. It never requests permissions, opens an editor, reads root-cause content, starts the diagnostic, enqueues a field read or clears a pending transaction. Its private receipt contains UUIDs; retain it only in the protected local evidence list, never public issues or CI logs.

A separate extension-session key holds only the whitelisted private receipt and its non-secret configuration snapshot. Starting another read invalidates that key's previous success. The same-extension receipt-tab link displays historical observations only; it does not select a background ONES tab or perform new network reads. A changed configuration or an observation older than five minutes invalidates the cached proof. This cache is separate from the diagnostic's pending transaction and never contains field values, response bodies or authentication material.

Fixed contracts, checked against the official documentation:

- [API overview](https://docs.ones.cn/project/open-api-doc/) identifies `GET /project/api/project/users/me`; the [user response](https://docs.ones.cn/project/open-api-doc/user/user.html) has a top-level `uuid`. The user page's URL heading conflicts with its example, so the route is taken from the overview's two consistent examples. `token_info` is excluded because it returns authentication material.
- The existing repository identifier resolver supplies the exact task UUID from the current display ID. [Single-task info](https://docs.ones.cn/project/open-api-doc/project/task.html) then binds that UUID to `assign` (responsible user), `project_uuid` and `issue_type_uuid`. `owner` is the creator and is never used as the responsible user. Task description and `field_values` are not consumed or exported as evidence.
- [Fields and field configurations](https://docs.ones.cn/project/open-api-doc/project/field.html) bind the configured field UUID to the unique root-cause name and the exact project/type/field configuration triple. This candidate supports only documented type 15 (`multi_line_text`); the deployment's actual root-cause type remains unverified until a trial, and other types stop the preflight. These metadata lists are filtered locally to the configured target; unrelated definitions and defaults are not exported.

The official legacy authentication contract describes explicit authentication headers. Compatibility with this deployment's existing browser session remains NOT_VERIFIED until an actual bounded trial. Requests use only the browser's same-origin session, fixed routes, no-store caching, bounded timeouts and no redirects or retries. Missing authentication, unknown schemas, identity mismatch or drift stop the operation; there is no credential/header lookup, alternate endpoint, SDK injection or permission fallback.

Successful binding also requires canonical user UUID = formal assignee UUID, unchanged current-user reads at the beginning/end, strict task/project/type equality, the unique visible detail-form root-cause container, and unchanged tab/configuration. A successful receipt is not a field baseline or write authorization. Only afterward may the Leader use the existing independent field reader twice: the first must finish with a definite successful result, followed by at least 750 ms, before the second is dispatched. Preserve an uncertain job and inspect only that job's status; do not enqueue a replacement. Nonempty values remain untouched. Actual input still requires its separate concrete marker/recovery confirmation and runtime gates; #103 Writer remains OFF/BLOCKED.

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
