# Current Context

Date: 2026-09-21

## Repository bootstrap

This public repository is the code/governance home for the ONES <-> Big-circle automation project. It is intentionally separate from historical chat-memory and xRocket product-knowledge repositories.

## Current public source state

- `reconciliation/`: v0.2.1 handler-first person-aware reconciliation integrated on main at merge `25c8e913a658298954e2c447c84be675e4639d99`.
- `local-relay/`: read-only v0.2.2 integrated by PR #19 / merge `c5f6c0f01336b2d9179fb34b0ef3306189fa9368`.
- `browser-bridge/`: public-safe read-only v0.4.2 integrated by PR #19 / merge `c5f6c0f01336b2d9179fb34b0ef3306189fa9368`; adds bounded `ONES_FIELD_READ` while keeping private origin/tenant identifiers and write surfaces absent.
- `periodic-alignment/`: minimal Windows read-only run-once wrapper integrated at `2eb36fd44ee24971eca8f85562e7828637e45514`; Windows run-once and approximately-2-hour Task Scheduler registration/runtime acceptance are PASS.
- `root-cause/`: deterministic fail-closed remarks extraction integrated at `ae4becddc8c11d265b331ca62db1e573dc04ee6a`; exact accepted CASE_FEED runtime acceptance PASS.

## Root-cause synchronization planner integration

`ROOT_CAUSE_SYNC_PLANNER_INTEGRATION=PASS`

Accepted integration:
- Issue #6 / PR #17;
- merge `baabd600ea65e3bffbb3f7b60931acf0a78e8094`;
- exact candidate `4822464de733fee6251d2a310d70e4e8f0af66cf`;
- CI run `35682582985` PASS;
- execution-free planner only;
- explicit `READ_VERIFIED` current-field snapshot required;
- no Browser/Relay write capability and no ONES mutation.

Exact next lane:
- Issue #18 / PR #19 integrated at `c5f6c0f01336b2d9179fb34b0ef3306189fa9368`;
- Browser Bridge v0.4.2 + Local Relay v0.2.2;
- bounded read-only `ONES_FIELD_READ` only;
- exact next lane is Issue #20 Windows runtime acceptance;
- runtime acceptance first rotates the exposed Relay token, preserves `relay.db`, updates Browser Bridge token config, and re-verifies `RELAY_PING`.
- CI/executor orchestration cleanup is deferred to Issue #21 and is explicitly non-blocking.

## Current operational gate

`BIGCIRCLE_TASK_PROMPT_WIRING=PASS`

`BROWSER_BRIDGE_V041_INTEGRATION=PASS`

`WINDOWS_CHROME_RUNTIME_ACCEPTANCE=PASS`

`PERSON_AWARE_RECONCILIATION_CORRECTION=PASS`

`BIGCIRCLE_RECONCILIATION_RUNTIME_ACCEPTANCE=PASS`

`BIGCIRCLE_SCHEDULED_TASK_V021_ALIGNMENT=PASS`

`PERIODIC_ALIGNMENT_WINDOWS_RUNTIME_ACCEPTANCE=PASS`

`PERIODIC_ALIGNMENT_SCHEDULER_ACCEPTANCE=PASS`

`ROOT_CAUSE_EXTRACTION_INTEGRATION=PASS`

`ROOT_CAUSE_EXTRACTION_RUNTIME_ACCEPTANCE=PASS`


The existing Big-circle scan checkpoint and reconciliation checkpoint remain independent. Runtime acceptance may be triggered manually; it does not need to wait for the scheduled 19:30 run.

## Population semantics

Historical local-case count and ONES inventory count are not directly comparable unless their populations are aligned.

The current known example is intentionally asymmetric:
- the historical 143 local confirmed cases represented one engineer's actual handled cases;
- the historical 128 ONES inventory rows represented a shared multi-engineer ONES scope.

Therefore reconciliation is population-aware and identity-aware, not raw-count-difference based.

Person fields are first-class alignment data, with an explicit local precedence rule:

- Big-circle `handlerPersons` is primary and represents the person who actually handled the case;
- only when `handlerPersons` is empty/unresolved, Big-circle `dutyPersons` is used as a fallback inclusion source;
- duty and handler are not blindly unioned when a valid handler exists;
- ONES `assignee.name` identifies the ONES-side owner partition for the ticket;
- configured person/alias mappings are runtime configuration and are never hardcoded into public source.

The case identity signal remains deterministic. An exact sourceTicketKey is the strongest current identity key. Person scope determines whose case it is; sourceTicketKey determines which case it is.

The actionable missing direction is:

`confirmed local case -> local person scope -> exact sourceTicketKey lookup in complete shared ONES inventory`

Outcomes:

- exact key absent from the complete shared inventory -> `ONES_MISSING_CASE`;
- exact key exists and ONES person scope aligns -> `MATCHED`;
- exact key exists but ONES person scope differs -> `PERSON_SCOPE_MISMATCH` / review, not a missing ticket;
- ambiguous person or identity evidence -> `AMBIGUOUS`.

Extra ONES rows belonging to other configured people are expected and do not count as local discrepancies.

## Dynamic snapshot rule

ONES inventory cardinality and Big-circle confirmed-case cardinality are both expected to change over time. No historical count is a future invariant. Every reconciliation run binds to the exact current case-feed bytes and one completeness-verified ONES inventory snapshot; exact input hashes determine idempotency. A changing ONES total during pagination must block that snapshot and require a fresh read rather than producing a missing-ticket decision.

## Product intent

The automation has two primary outcomes:

1. detect confirmed local cases that have no exact ONES ticket and emit a deduplicated missing-ticket report for human supplementation;
2. for exact matched cases, prepare a bounded synchronization plan for confirmed technical fields, with root cause as the primary write target.

Root-cause synchronization is now a queued product lane, but production ONES mutation remains disabled until its separate contract and runtime acceptance are complete.

## Root-cause source semantics

Big-circle already maintains technical handling evidence in the local `remarks` field. That field is the source for future root-cause extraction; a second data-entry workflow is not required.

However `remarks` may contain mixed evidence such as:
- confirmed root cause;
- symptom/phenomenon;
- current judgment or suspected cause;
- mitigation/recovery action;
- result/verification;
- next step.

Therefore future automation must first structure remarks into evidence state before any ONES write-plan is emitted.

Minimum derived fields:
- `rootCauseText`;
- `rootCauseState = CONFIRMED | PROVISIONAL | ABSENT | CONFLICT`;
- `rootCauseEvidenceSummary`;
- `rootCauseSource = remarks`.

Only `CONFIRMED` root cause is eligible for the bounded root-cause synchronization lane. Provisional language must not be upgraded to a final root cause.

## Safety

Current integrated runtime support remains read-only with respect to ONES. Remote Queue and ONES production writes are not enabled.


## Windows runtime acceptance

`WINDOWS_CHROME_RUNTIME_ACCEPTANCE=PASS`

Accepted runtime pair:
- Browser Bridge: v0.4.1
- Local Relay: v0.2.1
- Relay heartbeat: PASS
- RELAY_PING: PASS
- executor extensionVersion: 0.4.1
- capabilities: `RELAY_PING`, `ONES_INVENTORY_READ` only
- fresh inventory state/status: `INVENTORY_VERIFIED`
- readOnly: true
- inventoryComplete: true
- reconciliationAllowed: true
- ticketCount = serverTotalCount = visiblePageTotal = len(tickets) = 131 for this snapshot
- pageCount: 3
- capturedAt: 2026-09-21T08:01:43.336Z
- saved Windows snapshot SHA256: `b78bfbd108c3a967d5d28b7a2850a9277c3b64581bbde6fac29d37c6cc131e30`

The value 131 is not a product invariant. It is only the cardinality of this accepted snapshot. ONES shared inventory and Big-circle confirmed-case feed are both expected to grow over time. Acceptance is based on per-run completeness/equality and exact snapshot hashes, never on preserving a historical count.

## Case-feed runtime gate

`BIGCIRCLE_SCAN_RUNTIME_ACCEPTANCE=PASS`

`BIGCIRCLE_WAIT_LOCAL_INVENTORY_BEHAVIOR=PASS`

`CASE_FEED_REMARKS_FIDELITY=PASS`

`CASE_FEED_CANONICAL_SEMANTIC_FIDELITY=PASS`

`CASE_FEED_ACCEPTED_SHA256=41dffdcbd731ab55307a9764f35fca6715938d1d096b21beef25156116909fb8`

`CASE_FEED_EXPORTED_CONFIRMED_CASE_COUNT=252`

`CASE_FEED_EXTERNAL_SOURCE_TICKET_KEY_COUNT=86`

`CASE_FEED_SOURCE_TICKET_KEY_NULL_COUNT=166`

Exact-artifact review against `docs/contracts/CASE_FEED_V1.md` passed: 252/252 rows are confirmed cases, control/incomplete rows are absent, deterministic external-key extraction exactly matches the frozen rule, YF display IDs are excluded, and people/nested metadata compatibility is valid. Case-feed schema work is frozen. The next gate is a fresh completeness-verified ONES inventory plus integrated v0.2.1 person-aware runtime reconciliation.


## Artifact versus transport boundary

The canonical Big-circle case feed is a durable data contract and snapshot artifact, not the intended long-term human-mediated transport mechanism.

Current runtime acceptance may use an exported JSON file to isolate and verify:
- Big-circle scan/feed semantics;
- Windows inventory capture;
- reconciliation/idempotency.

Production target:
`Big-circle -> transport adapter -> Windows Agent -> reconciliation/Relay/Browser Bridge`

The Windows Agent should receive the same logical case-feed snapshot automatically, persist an exact local copy for audit/replay/hash binding, and return bounded result/checkpoint envelopes automatically.

Therefore:
- the case-feed schema remains part of the production design;
- manual download/upload/copy of the file is temporary acceptance scaffolding;
- transport selection remains separate from business semantics;
- Local Relay stays loopback-only;
- no Remote Queue provider is opened until the transport-neutral contract is accepted.


## Reconciliation runtime acceptance

`BIGCIRCLE_RECONCILIATION_RUNTIME_ACCEPTANCE=PASS`

Accepted exact pair:
- CASE_FEED raw SHA256: `41dffdcbd731ab55307a9764f35fca6715938d1d096b21beef25156116909fb8`
- ONES inventory raw SHA256: `b78bfbd108c3a967d5d28b7a2850a9277c3b64581bbde6fac29d37c6cc131e30`
- reconcile implementation: 0.2.1
- pipeline version: 0.2.0
- first run: `RECONCILIATION_VERIFIED`
- immediate exact rerun: `RECONCILIATION_NOOP_VERIFIED`
- runKey: `8e5f22b987ec9cdeaa0bd2781f7c8486d7b3a5d3b6f042a1aa72be5eeb01520b`
- report SHA256: `79ebd440b411b6d5c0c91b22d005873f8d2ccfbae3b7318c0b9bd67a8649789a`
- inputCaseCount: 252
- includedCaseCount: 112
- excluded pre-baseline/invalid-date: 130
- excluded outside configured people: 10
- totals: MATCHED=43, ONES_MISSING_CASE=28, PERSON_SCOPE_MISMATCH=3, AMBIGUOUS=38
- unique missing sourceTicketKeys: 25

Real-data semantic audit:
- all 112 included rows were `HANDLER_PRIMARY`; no contradictory duty/handler union was observed;
- sampled MATCHED rows aligned effectiveLocalPersons with ONES assignee;
- all three exact-key wrong-assignee rows classified as `PERSON_SCOPE_MISMATCH`, not missing;
- all 38 AMBIGUOUS rows in this snapshot were fail-closed `SOURCE_TICKET_KEY_MISSING_OR_MALFORMED`;
- this exact real snapshot did not contain a `DUTY_FALLBACK` row, so that branch was not exercised by production data; the exact integrated v0.2.1 targeted test/CI already covers duty fallback and no runtime evidence contradicts it.

The accepted counts above belong only to this exact input pair. Future case-feed and inventory totals are expected to change.

## Scheduled-task v0.2.1 readback acceptance

`BIGCIRCLE_SCHEDULED_TASK_V021_ALIGNMENT=PASS`

Accepted task-definition readback:
- task definition updated: true;
- existing scan semantics unchanged: true;
- reconciliation stage remains downstream of `SCAN_COMPLETE`: true;
- scan checkpoint independent from reconciliation checkpoint: true;
- waiting for ONES does not roll back scan state: true;
- Remote Queue enabled: false;
- ONES write enabled: false;
- workday 19:30 cadence preserved;
- existing five-step scan path preserved;
- downstream reconciliation semantics use `MATCHED / ONES_MISSING_CASE / PERSON_SCOPE_MISMATCH / AMBIGUOUS`;
- unavailable Windows inventory maps to `RECONCILE_WAIT_LOCAL_INVENTORY`.

Issue #11 stop condition is satisfied by this task-definition readback. The accepted prompt was compacted only to fit the scheduler prompt-length limit; frozen scan semantics and safety boundaries were retained.

## Scheduled-task alignment

The data contracts are connected, but the automatic cross-environment transport is not yet connected end-to-end.

Current accepted split:
- Big-circle weekly tables -> CASE_FEED_V1: PASS;
- Browser/Relay -> ONES inventory: v0.4.1 + Local Relay v0.2.1 Windows runtime acceptance PASS on a fresh completeness-verified snapshot;
- case feed + inventory -> reconciliation v0.2.1: Windows exact-input runtime acceptance PASS, including immediate exact-input NOOP.
- Big-circle -> Windows automatic transport: not yet implemented/accepted.

The existing workday scheduled scan remains unchanged. Its post-SCAN_COMPLETE stage must now use v0.2.1 outcome semantics, including PERSON_SCOPE_MISMATCH, and CASE_FEED_V1. Until transport is accepted, lack of a fresh Windows inventory must result only in RECONCILE_WAIT_LOCAL_INVENTORY.


## Lead handoff checkpoint

Current accepted/retired:
- Browser Bridge public-safe v0.4.1 integrated; Issue #12 setup-draft persistence correction closed;
- Local Relay v0.2.1 accepted base;
- person-aware reconciliation v0.2.1 integrated;
- CASE_FEED_V1 exact artifact accepted at SHA256 `41dffdcbd731ab55307a9764f35fca6715938d1d096b21beef25156116909fb8`;
- CASE_FEED/schema correction lane retired.

Current unfinished:
- automatic Big-circle <-> Windows Agent transport;
- Issue #6 bounded root-cause synchronization;
- Windows Agent consolidation and Browser UI productization.

Exact continuation ordering and new-conversation bootstrap are maintained in `HANDOFF.md`.


## Periodic alignment Windows runtime acceptance

`PERIODIC_ALIGNMENT_WINDOWS_RUNTIME_ACCEPTANCE=PASS`

Integrated source:
- merge: `2eb36fd44ee24971eca8f85562e7828637e45514`
- Local Relay: v0.2.1
- Browser Bridge: v0.4.1
- reconciliation: v0.2.1

Accepted Windows run-once evidence:
- relay health: PASS;
- result: `RECONCILIATION_VERIFIED`;
- case-feed SHA256: `41dffdcbd731ab55307a9764f35fca6715938d1d096b21beef25156116909fb8`;
- fresh inventory SHA256: `58b8afdf0bdfc9eada3c7a88d1b6b6da8ecc9d3c244872a2d2ae3de019bf86c6`;
- inventory capturedAt: `2026-09-21T09:57:35.164Z`;
- inventory ticketCount: 131 for this snapshot only;
- reconciliation runKey: `70a933395263bea722e8b1cbadcf91f14a63de4cb52e8513042f78ff48dac10b`;
- wrapper observedAt: `2026-09-21T09:57:36.2154709Z`.

The successful run proves the integrated Windows read-only path:
latest local CASE_FEED -> fresh Relay/Browser inventory -> verified inventory snapshot -> reconciliation/checkpoint.

The wrapper does not solve Big-circle-to-Windows transport; case-feed freshness remains limited to the newest valid local CASE_FEED until the separate transport lane is implemented.


## Periodic alignment scheduler acceptance

`PERIODIC_ALIGNMENT_SCHEDULER_ACCEPTANCE=PASS`

Accepted Windows Task Scheduler evidence:
- task: `ONES-BigCircle-Periodic-Alignment`;
- cadence: every 2 hours;
- logon mode: interactive only;
- run-as user: current interactive Windows user;
- task state: enabled/ready;
- first accepted manual trigger: PASS;
- Last Result after trigger: `0`;
- next scheduled run observed: 2026-09-21 20:00 local time;
- wrapper result from scheduled-task execution: `RECONCILIATION_VERIFIED`;
- scheduled-run case-feed SHA256: `41dffdcbd731ab55307a9764f35fca6715938d1d096b21beef25156116909fb8`;
- fresh scheduled-run inventory SHA256: `53fefb229784b1dba48df66296f0cf2e053a6b0d3e9c97134a2fed2e1ce5aff9`;
- inventory capturedAt: `2026-09-21T10:07:34.926Z`;
- inventory ticketCount: 131 for this snapshot only;
- reconciliation runKey: `8167b1bb86d62db0bf70da3821f93a077a0304ae71825307ae6afb6605e05479`.

The task is intentionally interactive because Browser Bridge depends on the logged-in Chrome user session. The Windows task policy currently does not start on battery power; this is an operating-system scheduling policy, not a reconciliation semantic rule.


## Root-cause extraction runtime acceptance

`ROOT_CAUSE_EXTRACTION_RUNTIME_ACCEPTANCE=PASS`

Accepted exact input:
- CASE_FEED SHA256: `41dffdcbd731ab55307a9764f35fca6715938d1d096b21beef25156116909fb8`
- inputCaseCount: 252 confirmed cases

Merged extractor:
- PR #16
- merge: `ae4becddc8c11d265b331ca62db1e573dc04ee6a`
- CI run: `35588154792` PASS

Exact-feed audit:
- CONFIRMED=70
- PROVISIONAL=17
- ABSENT=165
- CONFLICT=0
- remarks preservation mismatches=0
- CONFIRMED rows retaining known uncertainty cues=0
- extracted report SHA256: `602eddfe58805d1cc524b5c973db12ec32cc8a46664b09c91c2edd833889a594`

The zero CONFLICT count is only for this accepted snapshot; the CONFLICT branch is covered by synthetic tests and is not assumed impossible in future feeds.

Gate E is closed. Gate F may proceed only as bounded planning/read-before-write logic. Production ONES mutation remains disabled.


## Gate D2 transport development — 2026-09-22

`P4A_TRANSPORT_ENVELOPE_INTEGRATION=PASS`
`P4B_DURABLE_SPOOL_INTEGRATION=PASS`
`P4C_WINDOWS_CASEFEED_MATERIALIZER_INTEGRATION=PASS`
`P4D_WINDOWS_RUN_ONCE_PIPELINE_INTEGRATION=PASS`
`P4E_BIGCIRCLE_RESULT_CONSUMER_INTEGRATION=PASS`
`P4F_FILESYSTEM_EXCHANGE_INTEGRATION=PASS`

Integrated sequence:
- P4a PR #23 / merge `4b2a871ea9ff5d0cdfe493522e303780b5a9d9dd`;
- P4b PR #25 / merge `9076cde28a4a3a6649680f340c592b251f0d4895`;
- P4c PR #27 / merge `8830f5ffaf2cd8320283296ea94d451e7fd49e9b`;
- P4d PR #29 / merge `6ebc1e1f59d85ee1aa2335e5858289e67117d602`;
- P4e PR #31 / merge `451f2d3f6092e345a54e77ba1dfe55326d93a0d8`;
- P4f PR #33 / merge `d1b07b12bfdaf0fd2a684774afc96b09bf6d7c9a`.

Current mainline now has a complete provider-neutral local transport loop:
Big-circle outbox -> exchange/BIGCIRCLE_TO_WINDOWS -> Windows inbox -> exact CASE_FEED materialization -> existing periodic reconciliation -> RESULT/CHECKPOINT outbox -> exchange/WINDOWS_TO_BIGCIRCLE -> Big-circle receipt consumer.

This does **not** mean production cross-environment transport is complete. P4f is a filesystem exchange adapter and acceptance scaffold. No network provider / Remote Queue has been selected or opened, and ONES production mutation remains disabled.


## Gate D2 Windows local runtime acceptance — 2026-09-22

`GATE_D2_WINDOWS_LOCAL_RUNTIME_ACCEPTANCE=PASS`

Accepted integration:
- Issue #34 / PR #35;
- exact accepted candidate `dcc8c8ee301adf785911b8607b45a3bde224b6bb`;
- exact CI run `35696120564`: Linux/python PASS + Windows/windows-relay PASS;
- merge `bd62db2bcf6dedc58e9e0cb3f02b693238895fcf`;
- synthetic/non-production acceptance only.

Accepted runtime evidence:
- CASE_FEED SHA256 `59453ae43048ae15fced5f12ec8e0042fb70388a32fe081b94e8adcd022e88ba`;
- exact payload bytes preserved end-to-end;
- filesystem export duplicate NOOP and import duplicate NOOP verified;
- Windows spool processed and rejected transitions verified;
- exact CASE_FEED materialization verified;
- actual Windows Agent run-once process boundary exercised;
- real reconciliation pipeline returned `RECONCILIATION_VERIFIED`;
- immediate exact-input rerun returned `RECONCILIATION_NOOP_VERIFIED`;
- first reverse path produced 3 RESULT/CHECKPOINT receipts;
- NOOP reverse path produced 2 receipts;
- incomplete CASE_FEED failed closed and was rejected.

Boundary:
- Browser/Relay was not used by this Gate D2 acceptance;
- Issue #20 remains independent;
- this proves the provider-neutral local runtime spine, not production cross-environment transport;
- no production provider / Remote Queue is selected or opened;
- production ONES root-cause write and all other frozen mutations remain disabled.

Next decision boundary:
the local runtime proof is complete. Any real cross-environment transport provider/security/trust contract is a separate human-authorized boundary. Do not select or open a provider implicitly.
