from pathlib import Path
import json, re

ROOT = Path(__file__).resolve().parents[1]
manifest = json.loads((ROOT / "manifest.json").read_text(encoding="utf-8"))
worker = (ROOT / "service-worker.js").read_text(encoding="utf-8")
popup = (ROOT / "popup.js").read_text(encoding="utf-8")
all_text = "\n".join(
    p.read_text(encoding="utf-8")
    for p in ROOT.rglob("*")
    if p.is_file()
    and p.name != "static_test.py"
    and p.suffix in {".js", ".json", ".md", ".html", ".css", ".py"}
)

assert manifest["version"] == "0.5.9"
assert manifest["host_permissions"] == ["http://127.0.0.1/*"]
assert "https://*/*" in manifest["optional_host_permissions"]

assert "ONES_INVENTORY_READ" in worker
assert "ONES_FIELD_READ" in worker
assert "ONES_ROOT_CAUSE_WRITE" in worker
assert "ONES_ROOT_CAUSE_FORMAT_REPAIR" in worker
assert "RELAY_PING" in worker
assert "validatedOnesScope" in worker
assert "chrome.permissions.request" in popup
assert "chrome.storage.session" in popup
assert "onesRelaySetupDraftV041" in popup
assert "tokenPresent" in popup
assert "if (!validId(fieldId))" in worker
assert "/^field[0-9]{1,6}$/" not in worker
assert "HwyyVZy8" not in worker  # no private field hardcoding; custom IDs are accepted generically
assert "normalizeSemanticText" in worker
assert "ones-editor-text" in worker
assert "replace(/<!--version:[^>]*-->/gi" in worker

# Public projection remains configuration-driven; the only write lanes are bounded root-cause operations.
writer = (ROOT / "root-cause-writer.js").read_text(encoding="utf-8")
assert "RENDERED_LEFT_VERIFIED" in writer
assert "FORMAT_REPAIR_VERIFIED" in writer
assert "authoritativeSemantic" in writer
assert "ACCEPTED_FIELD_READ_FAILED" in writer
assert "rcAcceptedFieldRead" in writer
assert "EXACT_VALUE_LEFT_ALIGN_ONLY" in writer
assert "onesRootCauseFormatRepairExecute" in writer
assert "debugger" in manifest["permissions"]
assert "ONES_ROOT_CAUSE_WRITE" in worker
assert "writeEnabled" in worker and "writeEnabled" in popup
assert "taskTargetPolicy" in writer and "UNIQUE_ONES_TASK_ONLY" in writer
assert "fill_empty_only" in writer
assert "desiredSha256" in writer
assert "DESIRED_VALUE_HASH_MISMATCH" in writer
assert "crypto.subtle.digest" in writer
assert "WRITE_VERIFIED" in writer
assert "WRITE_UNVERIFIED" in writer
assert "ensureFieldReadTab" in worker
assert 'const route = u.pathname + u.search + u.hash;' in worker
assert 'route.includes("/team/" + scope.teamUuid + "/")' in worker
assert "draft.savePoint" in writer
assert "WRITE_VALUE_VERIFIED_EVENT_PENDING" in writer
assert "justifyLeft" in writer
assert "DRAFT_LEFT_ALIGN_VERIFIED" in writer
assert "CONFLICT_REVIEW" in writer
assert "chrome.debugger" in writer
assert "tasks/update3" not in writer
assert "HwyyVZy8" not in writer
assert "YF-12439" not in writer
assert "TARGET_NOT_AUTHORIZED" not in all_text
assert "onesOrigin" in worker
assert "teamUuid" in worker
assert "projectUuid" in worker
assert "issueTypeUuid" in worker
assert "assigneeDepartmentUuid" in worker
assert "inventoryPageUrl" in worker

# No fixed HTTPS production origin is allowed in the browser implementation.
assert not re.search(r"https://[^*\s\"']+", worker)
assert not re.search(r"https://[^*\s\"']+", popup)


# Issue #84: opening is root-cause-specific, one-click, and identity-bound before input.
preflight = writer.split("async function rcPagePreflightWrite(input) {", 1)[1].split("function rcPageInspectSelection", 1)[0]
assert 'text === "问题根因" || text === "【问题根因】"' in preflight
assert preflight.count("entries[0].click()") == 1
assert "root.id !== FIELD_UUID" in preflight
assert "container.querySelectorAll(editorSelector)" in preflight
assert "ROOT_CAUSE_CONTAINER_LOST" in preflight
assert "EDITOR_FIELD_ID_MISMATCH" in preflight
assert "location.href !== initialHref" in preflight
assert preflight.index("root.id !== FIELD_UUID") < preflight.index("const blocks =")
assert "Input.insertText" not in preflight
assert "dispatchMouseEvent" not in preflight
assert "setInterval" not in preflight

# Issue #86 convergence may read only and must remain bounded.
convergence = writer.split("async function rcVerifyRootCauseAfterSave", 1)[1].split("globalThis.onesRootCauseWriteExecute", 1)[0]
assert "rcPageVerifyWrite" in convergence
assert "maxElapsedMs = 90000" in convergence
assert 'name:"convergence"' in convergence
for forbidden in ("chrome.debugger", "Input.insertText", "dispatchMouseEvent", ".click(", "fetch(", "enqueue"):
    assert forbidden not in convergence
assert "valueReadVerified" in convergence
assert "READBACK_TIMEOUT" in convergence
assert "READBACK_EXECUTION_FAILED" in convergence
assert "ONESQL_AND_FIELD_EVENTS" in convergence
# Issue #85: only normal rendered field DOM can prove presentation acceptance.
rendered = writer.split("function rcPageVerifyRenderedAlignment", 1)[1].split("globalThis.onesRootCauseFormatRepairExecute", 1)[0]
assert "RENDERED_EDITOR_STILL_OPEN" in rendered
assert "RENDERED_FIELD_NOT_UNIQUE" in rendered
assert "rows.every" in rendered
assert "expectedHref" in rendered
assert "RENDERED_FIELD_DOM" in rendered
for forbidden in ("chrome.debugger", "Input.insertText", "dispatchMouseEvent", ".click(", "execCommand", "fetch("):
    assert forbidden not in rendered
assert 'presentationPolicy:"EXACT_SINGLE_PARAGRAPH_LEFT_V1"' in writer
assert 'semanticVerified && !presentation?.ok ? "WRITE_PRESENTATION_UNVERIFIED"' in writer
# Issue #83: config must be acknowledged before a permission prompt can destroy the popup.
save_handler = popup.split('$("saveConfig").addEventListener("click", async () => {', 1)[1].split('$("bindInventory")', 1)[0]
assert save_handler.index('type:"ONES_RELAY_SET_CONFIG"') < save_handler.index("chrome.permissions.request")
assert save_handler.index("if (!result?.ok)") < save_handler.index("chrome.permissions.request")
assert save_handler.index("await clearDraft()") < save_handler.index("chrome.permissions.request")
assert 'origins:[origin + "/*"]' in save_handler
assert 'normalizeOrigin(form.onesOrigin)' in save_handler
assert 'storedDraft?.baseConfig === draftBase' in popup
print("BROWSER_BRIDGE_PUBLIC_V059_PERSIST_BEFORE_PERMISSION_PASS")
