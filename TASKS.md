# Tasks

## Current priority — 0.5.18 Gate F2 closure (2026-10-25)

Current facts and source identities: `docs/context/CURRENT.md`. Existing control: [Issue #1](https://github.com/GodParticles1/ones-bigcircle-automation/issues/1#issuecomment-6393734524).

| Priority / owner | Existing lane | Next result / dependency |
| --- | --- | --- |
| P0 / one package Writer, independent Leader review | #112 / PR #113 | Source synchronization is complete on the original release branch. Use its exact-release-head CI and actual-archive review receipt to hand over the candidate; do not resynchronize or rebuild unchanged accepted bytes. Preserve the frozen #109 full installer. |
| P0 / existing local Pro Codex runtime owner | #110 / PR #111, #112 candidate | After exact candidate review, complete the bounded read-only identity/task/type/field check and two fresh authoritative BLANK reads; return exact failed stage/code if unavailable. No generic browser/platform investigation. |
| P0 / original native-editor source owner | #103 | Supported same-editor trace -> faithful RED reproducer -> smallest GREEN correction -> independent semantic/CI review. Formal Writer remains BLOCKED until the accepted mechanism gate is met. |
| Dependent / Leader and local runtime owner | #103, #85, #86, #108 | Rebuild final 0.5.18 installation package only from the accepted correction; perform separately authorized single-target runtime acceptance and decide presentation/convergence criteria independently. |
| Independent closure / existing Big-circle task owner | PR #114 | Source is integrated. Retain a bounded actual task/prompt/document-body/CASE_FEED acceptance follow-up; no duplicate task or source-repository prerequisite. |
| QUEUED | #97; #115/P7; #21 | #97 follows F2 acceptance. P7 and tooling debt must not delay F2; no new Writer is activated by this priority snapshot. |

The old #109 installer work is completed at source level. Do not restart it from a pre-merge handoff. Do not reopen #84, the accepted historical no-input/pending-barrier closure or the completed visible-contract ACK lane without contradictory applicable evidence.

The following historical and future lanes keep their accepted scopes; their older version snapshots do not supersede the current priority above.

## P0 — Windows Chrome runtime acceptance for Browser Bridge v0.4.1

`LANE_STATE=RETIRED_PASS`

Use the integrated public-safe Browser Bridge v0.4.1 with Local Relay v0.2.1 on the user's Windows/Chrome environment. v0.4.1 includes the accepted transient setup-draft persistence correction from Issue #12.

Required evidence:

- configure current ONES origin/team/project/issue-type/department at runtime;
- grant only the configured ONES origin permission;
- bind the current external-ticket inventory page;
- Relay heartbeat succeeds on `127.0.0.1:18731`;
- `RELAY_PING` succeeds;
- `ONES_INVENTORY_READ` returns a current completeness-verified snapshot;
- exact current `ticketCount == serverTotalCount == visiblePageTotal`;
- no ONES write path exists or executes.

Runtime acceptance passed on 2026-09-21 with a fresh completeness-verified inventory snapshot: 131 rows for that capture only, SHA256 `b78bfbd108c3a967d5d28b7a2850a9277c3b64581bbde6fac29d37c6cc131e30`. The cardinality is dynamic and is not a future invariant.

## P1 — Person-aware reconciliation correction

`LANE_STATE=RETIRED`

Correct reconciliation before declaring production runtime acceptance.

Local attribution rule:

- use `handlerPersons` when a valid handler is present;
- only if handler is empty/unresolved, fall back to `dutyPersons`;
- do not union duty into the effective owner set when handler exists.

ONES-side person scope comes from assignee.

Exact sourceTicketKey remains the primary case identity key.

Required outcomes:

- exact key + compatible person -> `MATCHED`;
- exact key absent globally -> `ONES_MISSING_CASE`;
- exact key present under another person -> `PERSON_SCOPE_MISMATCH`;
- unresolved/ambiguous person or identity -> `AMBIGUOUS`.

Add targeted tests for handler precedence, duty fallback, wrong-assignee mismatch and existing exact-key behavior.

## P1a — CASE_FEED_BUILD semantic correction

`LANE_STATE=RETIRED`

Accepted exact artifact: `41dffdcbd731ab55307a9764f35fca6715938d1d096b21beef25156116909fb8`.

Acceptance summary: 252 confirmed cases, 39 source tables, 86 deterministic external sourceTicketKeys, 166 null external keys, zero ambiguous keys, and compatible people/metadata envelope. Do not reopen schema/extractor work without contradictory exact evidence.

Contract: `docs/contracts/CASE_FEED_V1.md`

Do not rescan enterprise chat and do not move the scan checkpoint.

Rebuild only from maintained weekly tables:
- exclude EMPTY_PLACEHOLDER / CHECKPOINT_MARKER / INCOMPLETE rows;
- emit only CONFIRMED_REAL_CASE rows;
- preserve remarks exactly;
- derive sourceTicketKey independently and deterministically from explicit trusted key or one unique valid external-ticket token in groupChatName;
- never infer a key from current ONES inventory;
- emit people + nested metadata compatibility fields for v0.2.1.

## P1b — Big-circle reconciliation runtime acceptance

`LANE_STATE=RETIRED_PASS`

The canonical case feed is now accepted. Use its exact bytes/hash as the local input snapshot for the next runtime gate.

Execute:

`SCAN_COMPLETE -> CASE_FEED_BUILD -> INVENTORY_GATE -> PERSON_AWARE_RECONCILIATION -> MISSING_REPORT -> RECONCILIATION_CHECKPOINT`

Validate that reconciliation WAIT/BLOCK never rolls back `last_successful_scan_time`, weekly-table writes, or prior verified reconciliation state.

Runtime acceptance passed on the exact pair:
- CASE_FEED SHA256 `41dffdcbd731ab55307a9764f35fca6715938d1d096b21beef25156116909fb8`;
- inventory SHA256 `b78bfbd108c3a967d5d28b7a2850a9277c3b64581bbde6fac29d37c6cc131e30`;
- first run `RECONCILIATION_VERIFIED`;
- immediate exact rerun `RECONCILIATION_NOOP_VERIFIED`;
- runtime outcomes MATCHED=43 / ONES_MISSING_CASE=28 / PERSON_SCOPE_MISMATCH=3 / AMBIGUOUS=38.
The exact production snapshot had only HANDLER_PRIMARY included rows; DUTY_FALLBACK remains covered by the integrated targeted test/CI and is not inferred from absent real data.

## P1c — Big-circle scheduled-task v0.2.1 alignment

Canonical multi-person template: `docs/templates/BIGCIRCLE_PERSON_SCHEDULED_TASK_TEMPLATE_V1.md`.

`LANE_STATE=RETIRED_PASS`

Keep the existing scan/schedule unchanged. Align only the downstream post-SCAN_COMPLETE stage:

- CASE_FEED_BUILD uses accepted `CASE_FEED_V1`;
- fresh completeness-verified ONES inventory only;
- reconciliation implementation v0.2.1;
- outcomes include `PERSON_SCOPE_MISMATCH`;
- WAIT/BLOCK remains independent of the scan checkpoint;
- no direct Big-circle -> Windows localhost call;
- no Remote Queue;
- no ONES write.

Tracked by Issue #11.

Task-definition readback accepted:
- definition updated;
- existing scan semantics unchanged;
- reconciliation downstream of SCAN_COMPLETE;
- independent scan/reconciliation checkpoints;
- WAIT for ONES does not roll back scan;
- Remote Queue disabled;
- ONES write disabled.
Issue #11 may be closed.

## P2 — Remarks -> structured root-cause extraction

`LANE_STATE=RETIRED_PASS`

Goal: derive confirmed root-cause evidence from the existing Big-circle `remarks` field without changing the current daily data-entry workflow.

Required semantics:
- preserve the original remarks text unchanged;
- derive `rootCauseText`, `rootCauseState`, `rootCauseEvidenceSummary`;
- distinguish confirmed root cause from symptom, current judgment/suspicion, recovery action and next step;
- do not promote provisional language to CONFIRMED;
- conflicting root-cause statements -> CONFLICT;
- no root-cause evidence -> ABSENT;
- only CONFIRMED may feed the write-plan lane;
- public tests use synthetic remarks only.

Implementation integrated by PR #16 / merge `ae4becddc8c11d265b331ca62db1e573dc04ee6a`.

Exact accepted-feed runtime audit PASS: 252 rows -> CONFIRMED 70 / PROVISIONAL 17 / ABSENT 165 / CONFLICT 0; remarks preservation mismatches 0; accepted report SHA256 `602eddfe58805d1cc524b5c973db12ec32cc8a46664b09c91c2edd833889a594`. This lane is retired PASS. No ONES mutation is enabled by this acceptance.

## P3 — Population-aware root-cause synchronization contract

`LANE_STATE=PLANNER_INTEGRATED_RUNTIME_READ_PENDING`

Goal: extend exact-match reconciliation into a bounded write-plan lane for confirmed technical fields, with root cause as P0.

Required semantics:

- Big-circle handler is the primary local owner; duty is fallback only when handler is empty/unresolved;
- ONES assignee is the ONES-side owner scope;
- public code never hardcodes real names; person/alias mappings are runtime configuration;
- person name alone is not sufficient case identity;
- exact single identity match plus compatible effective-person scope is required for automatic synchronization;
- local root cause must be confirmed and non-empty;
- current ONES root-cause field is read before any write;
- ONES blank + confirmed local value -> SET_CANDIDATE;
- semantically identical -> NOOP;
- ONES non-empty and different -> CONFLICT_REVIEW;
- person-scope mismatch, ambiguous identity, or missing match -> BLOCK;
- missing ONES tickets remain human-supplemented; no automatic create/import;
- public source uses configuration for field identifiers and never hardcodes private tenant/field IDs;
- write execution requires a separately accepted bounded runtime gate and post-write readback.

Contract: `docs/contracts/ROOT_CAUSE_SYNC_V1.md`.

Execution-free planner integrated by PR #17 / merge `baabd600ea65e3bffbb3f7b60931acf0a78e8094`. Exact-head CI `35682582985` PASS. The planner remains non-mutating and requires explicit `READ_VERIFIED` current-field evidence.

### P3a — read-only current-field snapshot

`LANE_STATE=INTEGRATED_RUNTIME_PENDING`

Issue #18 / PR #19 integrated at merge `c5f6c0f01336b2d9179fb34b0ef3306189fa9368`. Browser Bridge v0.4.2 + Local Relay v0.2.2 now provide read-only `ONES_FIELD_READ`. Runtime acceptance is tracked by Issue #20 and requires Relay-token rotation first. CI/executor workflow cleanup is deferred to non-blocking Issue #21.

## P1d — 2-hour periodic read-only alignment

`LANE_STATE=RETIRED_PASS`

Goal: keep the two changing datasets approximately aligned without adding a new architecture layer.

Reuse only:
- CASE_FEED_V1 from maintained weekly tables;
- fresh completeness-verified ONES inventory;
- reconciliation v0.2.1;
- existing exact hashes/runKey/checkpoints.

Initial operational target: approximately every 2 hours.

Per cycle:
- rebuild/read latest valid CASE_FEED_V1 without rescanning enterprise chat;
- obtain fresh verified ONES inventory;
- run existing reconciliation v0.2.1;
- exact unchanged pair naturally resolves through existing idempotency/NOOP;
- WAIT/BLOCK never rolls back the scan checkpoint or previous verified reconciliation.

Do not add apiVersion/kind/resourceVersion, LIST/WATCH protocol, generic controller subsystem, Remote Queue, provider selection or ONES mutation.

Implementation integrated by PR #15 / merge `2eb36fd44ee24971eca8f85562e7828637e45514`.

Windows runtime acceptance passed on 2026-09-21. Windows Task Scheduler registration also passed: task `ONES-BigCircle-Periodic-Alignment`, every 2 hours, interactive-only, enabled/ready, manual trigger `Last Result=0`, and scheduled wrapper execution returned `RECONCILIATION_VERIFIED`. This lane is retired PASS.

Tracked by Issue #14 (closed after code integration).

## P4 — Big-circle <-> Windows Agent transport abstraction

`LANE_STATE=PROVIDER_CODE_PASS_STAGING_RUNTIME_BLOCKED`

P4a-P4f local spine and Windows runtime acceptance are PASS. The user then authorized the production provider/security/trust boundary. P4g-P4i are integrated: signed remote client/contract merge `c24f46c87dcd6cd9636c8cb4a225be54a455d84c`; Cloudflare Worker + Durable Object + private R2 gateway merge `a69b9ee1492422daddb03e72d234cc3530a89929`; staging preflight/synthetic-smoke bundle merge `33d1d5679ad975f8c3bd201932d5dd14a3c9056f`.

Goal: replace the current manual case-feed file handoff with automatic transport while preserving the exact same canonical snapshot contract.

The JSON case feed remains the logical payload/audit snapshot, but the user must not need to download/copy/upload it during normal operation.

Define a transport-neutral job/result envelope so the cloud Big-circle control plane can exchange bounded work with the Windows agent without coupling business semantics to one provider.

Current provider is frozen as `CLOUDFLARE_WORKER_DO_R2_V1`. Source/client/gateway/staging bundle are accepted, but no live Cloudflare staging deployment has been performed. Exact next gate is authenticated staging resource creation + secret injection + deploy/readback + synthetic-only smoke from the integrated P4i runbook. Production payload transport remains disabled until that gate passes.

The transport contract must be able to carry both read-only inventory jobs and future accepted write-plan jobs without granting new capabilities by default.

## P5 — Windows agent consolidation

`LANE_STATE=QUEUED`

Future packaging target: one Windows-side ONES Big-circle Agent that owns Local Relay, reconciliation runner, state/checkpoints, config/status UI and Browser Bridge setup guidance. Chrome extension remains a browser component.

## P6 — Browser UI productization

`LANE_STATE=QUEUED`

Replace the developer-console layout with a compact product UI: connection/config card, status summary, manual actions, inventory/reconciliation summary, diagnostics drawer and settings. Visual direction may borrow the compact card/grid hierarchy shown by AI Exporter without copying its branding or assets.

## P7 — Model-neutral Agent interoperability (future planning only)

`LANE_STATE=QUEUED` / `IMPLEMENTATION=NOT_STARTED` / `PRODUCTION_WRITE=OFF`

**Near-term Pro pilot (separate nonproduction slice):** [Issue #115](https://github.com/GodParticles1/ones-bigcircle-automation/issues/115) owns a bounded manifest-based plugin registry with reversible enable/disable/reload for new calls and a stable MCP/CLI facade. Its external-memory capability delegates to the **existing** chat-memory Memory Control Layer; [chat-memory #43](https://github.com/GodParticles1/chat-memory/issues/43) owns cross-Codex/Claude shared context and sourced-learning validation. These issues do not activate production writers, require a new backend, or make hot tool-list refresh in active Agent sessions a guaranteed feature.

**Product intent:** evolve the accepted ONES-specific deterministic execution spine into optional Agent-assisted planning, browser diagnosis and eventually broader business UI workflows, without making a particular LLM, Agent harness, browser automation framework or cloud service mandatory. The first user experience is a natural-language request that leads to transparent **read -> plan -> approved bounded action -> independently verified result**. Never replace trusted exact task/field binding, evidence classification or fail-closed receipts with model guesses.

**Three independent compatibility surfaces (not interchangeable):**

- **Model provider:** configurable DeepSeek, OpenAI or other model adapters for planning/reasoning. Do not assume identical APIs, tool-calling guarantees, data-handling terms or performance; prove each supported integration in its actual configuration. Do not send ONES login material, private ticket text or raw browser DOM to a remote model by default.
- **Agent runtime:** optional adapters for DeepSeek Harness (DSH's plugin runtime), local Codex CLI and other supported MCP/tool-capable runtimes. Codex cloud/Web access is separate and cannot be presumed to control the user's signed-in local Chrome or loopback Relay. No vendor-specific instructions should become ONES core business authority.
- **Execution tools:** preserve the existing local Windows Agent, Browser Bridge, Local Relay, read-only field/inventory, reconciliation, planner and exact-receipt capabilities. Publish a **small, typed, versioned capability contract** for Agent callers, with MCP as the first interoperability candidate where both sides actually support it; allow a thin local CLI/adapter where needed. A DSH-specific plugin or Codex-specific connector is optional, not a required rewrite or dependency.

**Candidate capability boundary:** start with read/status/plan/diagnostic and synthetic browser tasks. Treat page content, model responses and remote tool output as untrusted; authorize capabilities per task (read-only default), bind exact identity/field/origin, cap actions and budget, expose deterministic `NOOP/BLOCK/WAIT/verified` outcomes and provenance. A model may recommend actions, but only accepted deterministic executors may mutate state. Draft edits can autosync even without Save; require explicit scoped authorization, the existing one-attempt/no-hidden-retry rules and independent server readback. Create/import, destructive actions, bulk write, unsolicited Bilibili-style comments or other public posting are **not** activated by this roadmap.

**Future bounded validation sequence:**

1. Inventory already accepted ONES read-only tool primitives and define one versioned, privacy-safe `AgentToolRequest/Result` schema; no new mandatory daemon/OAuth/payment or separate control plane.
2. Run the *same synthetic read-only ONES task* through at least two independently configured clients (candidate: DSH adapter and local Codex CLI adapter), comparing input identity, receipts, failure handling, tool permissions and no side effects. Do not claim compatibility from a README or protocol name alone.
3. Pilot one operator-confirmed, locally authenticated Chrome/Bridge interaction only when actual browser access is demonstrated and with safe rollback/independent readback; a cloud CI success is not a live-browser pass.
4. Consider single-field approved mutation/orchestrated multi-target automation only **after** Gate F2/#103 native-editor semantics and applicable #85/#86 runtime gates pass; retain the queued #97 task-level execution constraints and explicit separate write acceptance. Broader cross-site Agent workflows require their own evidence and owner.

**Reference candidates, not frozen dependencies:** [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (plugin-based developer preview; potentially breaking changes), [dsh-bili-scroll](https://github.com/c1overzz/dsh-bili-scroll) (example of task-scoped read/write tools, not ONES runtime proof), [Codex CLI](https://github.com/openai/codex) (local coding-Agent candidate). Evaluate real API/adapter/version support before adopting any implementation.

**Priority and stop:** research backlog only; no Writer assignment, new infrastructure, CI work or production permissions now. P5/P6 productization and existing Gate F2 stabilization must not wait on P7. Revisit when an accepted ONES tool boundary and a real testable Agent client are available; stop if proposed abstraction adds cost or risk without reducing operator effort.

## Deferred

- automatic ONES create/import;
- owner/status/project/priority/delete automation;
- any production write beyond separately accepted bounded field-sync contracts.
