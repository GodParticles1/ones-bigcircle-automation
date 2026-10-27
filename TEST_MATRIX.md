# Test Matrix

## Current 0.5.18 test plan — 2026-10-25

This is the test plan for the existing Gate F2 lanes, not a new governance or runtime controller. [Leader Control #1](https://github.com/GodParticles1/ones-bigcircle-automation/issues/1), [TASKS](TASKS.md) and [HANDOFF](HANDOFF.md) retain priority and ownership. Source/CI/package acceptance and real Windows/ONES acceptance are separate.

### Packages and current acceptance

| Package / source | Use and evidence | Current limit |
| --- | --- | --- |
| Diagnostic candidate `ones-native-editor-diagnostic-CANDIDATE-c1ab2c06fe01c.zip` | #113 release `1ab2c06fe01cdd02f0d13ac380a07bb1aa94f86d`, upstream #111 `511e880e68fac1e479de1ac63bb5d23fdde627c7`; [CI 40164638301](https://github.com/GodParticles1/ones-bigcircle-automation/actions/runs/40164638301) Linux/Windows PASS; [actual ZIP acceptance](https://github.com/GodParticles1/ones-bigcircle-automation/issues/112#issuecomment-6393830709) | CHECKPOINT_ACCEPTED for Stage-0 installation/read-only checks; real runtime NOT_RUN. Stage-1 native input HOLD pending the bounded source gates below. |
| Frozen #109 full installer, Bridge 0.5.17 / Relay 0.3.8 / Planner 0.2.0 | Accepted installation baseline; preserve its source and bytes. Use only if the separate base-installation prerequisite is actually missing. | Not the new identity/diagnostic extension. Existing working environments do not need reinstalling for this test. |
| Future Stage-1 diagnostic candidate | #112 synchronizes a reviewed #110 gate correction once, with its own head, exact CI and actual ZIP verification. | Not yet built or accepted. Do not relabel or overwrite the accepted Stage-0 ZIP. |
| Future 0.5.18 release candidate | Built only after the mechanism-backed #103 correction has independent acceptance. | Not implemented, packaged or released. Diagnostic success is not release acceptance. |

[Download the accepted diagnostic artifact](https://github.com/GodParticles1/ones-bigcircle-automation/actions/runs/40164638301/artifacts/12587618813). Extract the Actions wrapper to obtain the inner ZIP and sidecar. The **inner ZIP** SHA256 is:

```text
efea319c89805dc50a68b5b40769826f93677727fbbc191dc9906d91b684467e
```

The outer Actions archive digest is `f81914cddce50a54e172acf943a6994363b9d78a1382b08dbf1980b7353dd6fb`; do not compare it with the inner digest. The artifact was available on 2026-10-25; availability can change, so a missing/expired artifact is a delivery blocker, not permission to use another build.

Use the [exact packaged Windows runbook](https://github.com/GodParticles1/ones-bigcircle-automation/blob/1ab2c06fe01cdd02f0d13ac380a07bb1aa94f86d/release/root-cause-native-diagnostic/START_HERE.md). Check the downloaded inner ZIP with:

```powershell
$autoCandidateZip = Read-Host 'Full path to the inner ones-native-editor-diagnostic-CANDIDATE-c1ab2c06fe01c.zip'
$autoCandidateHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $autoCandidateZip).Hash.ToLowerInvariant()
if ($autoCandidateHash -cne 'efea319c89805dc50a68b5b40769826f93677727fbbc191dc9906d91b684467e') {
    throw 'CANDIDATE_ZIP_HASH_MISMATCH'
}
```

Extract into a new empty directory. Chrome loads its child directory `ones-native-editor-diagnostic-CANDIDATE-c1ab2c06fe01c`, which contains `manifest.json`. Verify `BUNDLE-MANIFEST.json.sourceHead` is the exact release SHA above. Chrome's displayed version remains 0.5.17 and does not identify this candidate by itself. Preserve the old extension files, Relay process/token/database and unresolved jobs; only one Bridge is active. Follow the runbook for local configuration and existing permission setup; keep WRITE_GATE OFF.

### Stage-0 — installed candidate and read-only baseline

**Owner:** original local Pro Codex runtime task, #110 / PR #111. Bounded installation/read-only authority already exists in the [local dispatch](https://github.com/GodParticles1/ones-bigcircle-automation/pull/111#issuecomment-6393845936). No further approval is needed for that same scope. Target the next available supported local execution window.

| Check | Pass evidence | Stop / next decision |
| --- | --- | --- |
| Candidate installation | Correct inner hash, release sourceHead and loaded directory; sole active Bridge; old installation and Relay state retained; WRITE_GATE OFF. | Wrong bytes, unavailable local capability or missing prerequisite: report the precise blocker. Do not rebuild the unchanged package or reset the environment. |
| Fresh identity and binding | On the exact configured active task page, click **只读核对身份与工单**. Expect `IDENTITY_BINDING_READ_VERIFIED`, `ok=true`, `validBinding=true`, `readOnly=true`, six fixed requests. Locally verify canonical account = formal assignee; exact task/project/type/root-cause field; supported fieldType=15. | Auth/HTTP/schema/identity/tab/config mismatch: retain first failed stage/code and stop. No alternate endpoints, credential discovery or fuzzy identity matching. |
| Independent field baseline | Using the existing authoritative field reader, require definite successful BLANK read #1; only then start a >=750 ms interval before dispatching independent read #2; require definite BLANK again on the exact same target/field. Record completion/dispatch times. | Nonempty, unknown, failed or drifted read: no input. Preserve an uncertain job and query that original job; do not enqueue a replacement. Identity READ is not this field baseline. |
| Read-only outcome | Candidate identity, actual binding result and two read outcomes/interval if executed; native input=0, Save=0; next concrete decision. | A partial result remains partial: identity PASS with field reader unavailable does not complete Stage-0. |

Private UUID receipts stay local. **在标签页查看私密历史收据** returns historical evidence with validBinding=false and cannot replace a fresh READ. Stage-0 does not click **单次原生编辑器诊断**, open a mutation path, clear a nonempty field or authorize production Save.

### Stage-1 — one real editor trace, currently HOLD

The [bounded #110 source continuation](https://github.com/GodParticles1/ones-bigcircle-automation/pull/111#issuecomment-6394226007) owns the prerequisite correction on the original branch at base `511e880e68fac1e479de1ac63bb5d23fdde627c7`. It can proceed while Stage-0 runs, without changing the installed Stage-0 candidate.

Current code's generic confirmation precedes random marker creation; native RUN does not consume the separate fresh identity receipt; its internal pre-read path explicitly waits 450 ms. Therefore the current package does not prove the promised per-attempt binding/confirmation or >=750 ms timing. Do not treat the native button as ready merely because Stage-0 passed.

Before this stage:
- The original source owner binds one fresh identity/target/field result, exact synthetic marker and recovery choice to one prepared/confirmed execution; rejects historical/expired/mismatched or drifted data and stale/replayed confirmation before native commands.
- The actual input path enforces two definite BLANK reads, with >=750 ms measured after the successful first completion and no second pre-read/native command after a failed, unknown or nonempty first read.
- Behavior tests, independent review and exact-head Linux/Windows CI pass; #112 produces and verifies a distinct candidate once. Production Writer, Relay, Planner, version and permission boundaries are unchanged.
- The runtime owner obtains the existing **concrete per-attempt confirmation** for that prepared marker/recovery choice. General project/test-plan approval does not supply a future attempt's exact inputs.

Then capture one exact configured ticket/field on the same real editor build: fresh geometry, active host, focus/selection, trusted event metadata and bounded asynchronous length/hash transitions. Allow at most one native insertion, **Save=0**, no hidden retry. Draft input can autosync without Save.

| Observed branch | Required decision |
| --- | --- |
| Rejected before native commands | Return exact stage/failed invariant and zero-input evidence; only a decision-changing correction permits another attempt. |
| Native click/selection occurred, even if insert count=0 | Preserve the attempt and pending barrier; complete independent server verification before another attempt. |
| EXACT_ONCE trace | Useful observation for that attempt only. It does not prove the historical duplication mechanism or authorize #103 closure. |
| DUPLICATE/PARTIAL/TRACE_UNCERTAIN | Preserve scrubbed trace and same-editor build context; do not retry to seek a nicer result. Decide whether it supports a mechanism or identifies one concrete evidence gap. |
| Post-attempt authoritative server changed/unknown | Stop further input; escalate the exact outcome. Cancel, extension rollback, disable/reload or browser restart is not server rollback. No automatic cleanup/overwrite. |
| Server state independently verified unchanged | Close only this attempt's pending state according to the existing diagnostic procedure; then assess whether the mechanism evidence is sufficient. |

The current session-stored pending barrier is not proven across browser restart/extension disable/reload. Keep an unresolved attempt in its supported session and protected local record; never use lifecycle reset to erase uncertainty. This plan does not require a new general persistence system. The current post-Cancel verifier's two direct reads also do not stand in for the separately required pre-input timing/identity gate.

### Stage-2 — faithful RED, minimal GREEN and candidate preparation

**Owner:** original #103 source Writer; Leader refreshes its accepted base/ownership after a mechanism is supported. #103 remains BLOCKED / REAL_EDITOR_SEMANTICS_NOT_PROVEN until then.

1. Reproduce the observed failure through a faithful model of the demonstrated native editor transaction. The uncorrected code must fail for that mechanism. Ordinary contenteditable success, a manufactured duplication fixture, or stubbing draft checks to PASS is insufficient.
2. Apply the smallest supported correction. Preserve exact planner/target/field/desired SHA, fill-empty-only, fail-closed draft checks, at-most-one native insertion/Save and non-retry semantics. Do not replace the contradicted wait-only fix with another unproven delay.
3. Verify exact text once before Save; duplicate/partial/extra draft prevents Save. Retain the existing identity, presentation, convergence, Relay/checkpoint and public privacy boundaries.
4. Independently review the diff and meaningful RED/GREEN evidence, run required exact-head Linux/Windows CI, then produce a distinct 0.5.18 RC with source manifest/hash and applicable installation/state-preservation checks. This is not permission to operate it in production.

If the trace cannot justify a faithful reproducer, return one precise missing observation and keep the Writer blocked; do not expand into another general platform investigation.

### Stage-3 — RC installation and bounded real acceptance

**Owners:** original runtime owner executes; Leader reviews and decides release. The [production write contract](docs/contracts/ROOT_CAUSE_WRITE_V1.md), accepted #85/#86 criteria and a concrete single-target authorization remain applicable.

- Bind actual installed RC bytes and configuration, preserve rollback material and existing state, and re-establish the fresh exact target/blank baseline.
- Use exactly one authorized real SET_CANDIDATE target with its accepted planner/desired hash. No second target or unattended write. A NOOP or CONFLICT is a valid guard result, not proof that this RC successfully performed the intended write.
- Reuse **one authorized Save attempt** to collect the separate #103, #85 and #86 observations; do not create additional production writes just to close separate issues.

| Criterion | Runtime evidence / decision |
| --- | --- |
| #103 native transaction | Exact desired draft once before Save; single native input and at most one Save; no duplication or hidden retry. |
| #85 presentation | Authoritative semantic value remains exact; normal saved/rendered view has left/start alignment and readable accepted structure. Draft alignment alone is insufficient. |
| #86 convergence | Preserve bounded read timing/source. Exact semantic value with event pending remains `WRITE_VALUE_VERIFIED_EVENT_PENDING`; semantic value and required new event verified yields `WRITE_VERIFIED`; unresolved delivery remains `WRITE_UNVERIFIED` with no repeat Save. |
| Release decision | Only the applicable package/install/runtime gates and separately recorded #85/#86 decisions permit Leader to accept 0.5.18. Pending event, unverified write or missing rendered-view evidence remains an explicit gap. |

Do not automatically erase a successfully persisted genuine root cause. Any necessary rollback follows the existing separately authorized exact-checkpoint contract, not the extension switch procedure.

### Required source tests and evidence reuse

The current diagnostic source already passed identity 12/12, popup 17/17 and native diagnostic 33/33 tests at its reviewed SHA; release CI also retained the existing Writer regressions and actual-package/negative checks. These are inherited source/package evidence, not Windows/ONES runtime evidence.

For the next bounded diagnostic delta, the tests must demonstrate missing/stale/drifted identity rejection, exact confirmed marker use, cancelled/stale/replayed confirmation rejection, first-read failure stop and real elapsed ordering from first-read completion to second dispatch. A harness that replaces all timers with immediate callbacks does not prove the interval. Pending/uncertain delivery must still prohibit another native attempt.

Use the existing diagnostic branch's test commands below after the relevant source changes; do not run absent diagnostic files against main or create a new blanket suite:

| Scope | Existing entry / applicable validation |
| --- | --- |
| Identity | `node browser-bridge/tests/identity_binding_read_test.js` |
| Popup | `node --test browser-bridge/tests/popup_save_test.js` |
| Native diagnostic | `node browser-bridge/tests/native_editor_diagnostic_test.js` |
| Production Writer regression | `node browser-bridge/tests/root_cause_writer_test.js` |
| Draft / static / syntax | Existing `draft_persistence_test.js`, `static_test.py` and `node --check` steps in the candidate workflow |
| Package | Existing #112 builder, frozen-tree guard, manifest/byte checks and `release/root-cause-native-diagnostic/tests/test_bundle.py` against the actual new candidate |
| Cross-platform gate | Exact candidate SHA in required Linux and Windows CI; no skipped failing gate or substituted earlier SHA |

Reuse accepted unchanged package and source evidence. Rebuild only when accepted source/package inputs change. A documentation-only test-plan commit does not supersede the approved Stage-0 ZIP.

### Return evidence through the existing lane

Use the existing #111/#112 receipt chain, not another task database. Return the candidate head/hash, actual executed stage and terminal status, first failed stage/HTTP code where applicable, input/Save counts, authoritative outcomes/timing, pending status, and one next action. Mark unexecuted checks NOT_RUN.

Publish only scrubbed enums, counters, timing and public source/package identities. Keep private account/task/team/project/field identifiers, origins, raw content, credentials and screenshots in protected local evidence. A dispatch is not an execution witness or a claim that Windows is currently running.

## Existing baseline automation entries

| Lane | Test | Expected |
| --- | --- | --- |
| reconciliation | `python reconciliation/tests/test_reconciliation.py` | `RECONCILIATION_V011_TEST_PASS` |
| reconciliation pipeline | `python reconciliation/tests/test_pipeline.py` | `RECONCILIATION_PIPELINE_V020_TEST_PASS` |
| local relay | `python local-relay/tests/test_relay.py` | relay integration PASS |
| browser bridge | `node --check browser-bridge/service-worker.js && node --check browser-bridge/popup.js && python browser-bridge/tests/static_test.py` | PASS |
| public safety | `python scripts/repo_guard.py .` | PASS |
| Python syntax | `python -m compileall reconciliation local-relay` | PASS |
