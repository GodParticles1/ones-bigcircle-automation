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
- [Fields and field configurations](https://docs.ones.cn/project/open-api-doc/project/field.html) bind the configured field UUID to the unique root-cause name and the exact project/type/field configuration triple. The documented legacy definition uses integer type 15 (`multi_line_text`). A bounded 2026-10-28 read of the same existing endpoint proved the exact deployed target instead has an object type: a valid `uuid`, `name:"富文本"`, `value_type:"richtext"` and Boolean `can_be_custom_field` / `can_be_frozen`. Only these two explicit metadata contracts are recognized; strings such as `"15"`, incomplete objects and other families fail closed. The object contract remains `fieldType:"richtext"` with its own private `fieldTypeUuid`; it is never coerced to numeric 15. These lists are filtered locally to the configured target; unrelated definitions and defaults are not exported.

The official legacy authentication contract describes explicit authentication headers. The permitted deployment trial completed the existing starting-user, task resolver, task-info and fields requests through the signed-in browser session, then stopped at the metadata type mismatch. Field configuration, ending-user stability and complete binding remain unverified until the corrected candidate's bounded trial. Requests use only the browser's same-origin session, fixed routes, no-store caching, bounded timeouts and no redirects or retries. Missing authentication, unknown schemas, identity mismatch or drift stop the operation; there is no credential/header lookup, alternate endpoint, SDK injection or permission fallback.

Successful binding also requires canonical user UUID = formal assignee UUID, unchanged current-user reads at the beginning/end, strict task/project/type equality, the unique visible detail-form root-cause container, and unchanged tab/configuration. A successful receipt is not a field baseline or write authorization. Only afterward may the Leader use the existing independent field reader twice: the first must finish with a definite successful result, followed by at least 750 ms, before the second is dispatched. Preserve an uncertain job and inspect only that job's status; do not enqueue a replacement. Nonempty values remain untouched. Actual input still requires its separate concrete marker/recovery confirmation and runtime gates; #103 Writer remains OFF/BLOCKED.

## Issue #110 — operator-only native editor diagnostic (source candidate, NOT runtime accepted)

This source-only tool does not enable `ONES_ROOT_CAUSE_WRITE`, does not enqueue Relay jobs and never dispatches Save.
It uses existing Chrome `debugger` permission. No new manifest permission, version change or packaging/release claim.

The Stage-1 correction prepares one session-bound nonce, exact synthetic marker and fixed recovery intent before confirmation. Only a fresh successful identity READ can bind that preparation; historical LAST cannot. RUN consumes the exact confirmation once, reuses the existing six-request reader for a fresh execution-time check, and requires the same private target tuple. Missing, cancelled, expired, changed or replayed confirmation never authorizes native commands. The NATIVE core receives the worker-owned marker and guard closure; it does not generate another marker after confirmation.

The first definite authoritative BLANK must complete before the minimum 750 ms interval begins. The second read is dispatched only after that interval and another execution/target guard; a failed, unknown or nonempty first result stops without a second read or native commands. Locator/focus/selection/draft guards remain applicable. Session pending is recorded before native commands and retained after an uncertain click/selection even when insertion is zero. Browser/extension lifecycle reset is not server verification; retain unresolved attempts and protected local records rather than using reload/disable to clear uncertainty.

The identity failure receipt reports only a whitelisted FIELD_SCHEMA invariant and, when applicable, an integer type code. New unsupported metadata uses `TARGET_TYPE_UNSUPPORTED`; old `TARGET_TYPE_NOT_15` receipts remain display-compatible. No rejected object, arbitrary string, field-name list or raw response escapes. The prepared/execution tuple retains the richtext type UUID as well as the explicit family, so changing the definition between the fresh reads rejects execution. Metadata compatibility does not replace FIELD_CONFIG, ending-user, DOM-stability or authoritative field-value checks.

These source gates are not a native-input fix or runtime approval. The accepted `1ab2c06` archive is Stage-0 only; a distinct exact-source #112 candidate and concrete single-attempt consent are required before Stage-1. The [accepted test plan](https://github.com/GodParticles1/ones-bigcircle-automation/blob/b857d2d3a84d99117db14722b65b26c2f887d68a/TEST_MATRIX.md) owns those stage boundaries. Input may autosync; recovery intent is Cancel plus independent authoritative verification and escalation, without automatic overwriting or cleanup.

Windows operator (after independently reviewed extension source is installed as an unpacked extension):
1. Chrome `chrome://extensions` → Developer mode → Load unpacked → choose the reviewed `browser-bridge` directory. Use the same local ONES scope configuration; leave **Enable production root-cause write gate** unchecked.
2. Open exactly one ONES work-item detail, enter the configured **问题根因** editor, and focus its empty text block. Close DevTools/Protocol Monitor. Do not Save.
3. On the new independently accepted Stage-1 candidate, prepare the attempt, obtain its fresh identity binding and read the exact marker/target/recovery confirmation before confirming this attempt. RUN rechecks execution identity and reads the root-cause field twice with the required successful-completion interval before any possible synthetic input. If a safety proof fails, stop; do not automatically repeat or substitute historical receipts.
4. Save **nothing**. The displayed JSON contains only whitelisted metadata (event timing/trust, bounded lengths and SHA-256, focus/selection, mutation counts, semantic classification). **Click Cancel inside ONES**, leaving the same work-item page open. Reopen the popup → **取消后核查服务端** to perform two independent read-only field reads.
5. `SERVER_BLANK_OBSERVED` only means those bounded readbacks were blank, **not a guarantee against delayed SharedDB/online-collaboration synchronization**. On `SERVER_CHANGED_ESCALATE`, `SERVER_UNVERIFIED`, `TRACE_UNCERTAIN`, mismatch or any BLOCKED receipt: stop, do not re-run, do not overwrite/undo server content, escalate to Leader. After a result, copy only the scrubbed receipt, never raw console/Network data.

The receipt records `ARM -> INSPECT_1 -> INSPECT_2 -> AFTER_NATIVE_CLICK -> AFTER_CTRL_A -> BEFORE_INSERT` as bounded metadata. The native-click gate runs before Ctrl+A; a failed click gate sends no key or text command. Each post-click gate preserves the exact bound block/host, focus, selection, blank-draft and geometry checks. `phase` identifies the failed gate, while `phases` records counts, connection/focus booleans, selection-proof enums and bounded event metadata. These fields survive popup reopening and independent server verification, with no raw content, URL or account identifiers. This instrumentation localizes a failure; it does not repair or prove ONES Writer semantics.

The one-input source and synthetic tests do **not** prove genuine ONES editor semantics; that requires an independently authorized real browser trial. No automatic retry, real batch, production writer acceptance, Release promotion or merge. The code is not a browser runtime validation certificate.
