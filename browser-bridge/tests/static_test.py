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

assert manifest["version"] == "0.5.2"
assert manifest["host_permissions"] == ["http://127.0.0.1/*"]
assert "https://*/*" in manifest["optional_host_permissions"]

assert "ONES_INVENTORY_READ" in worker
assert "ONES_FIELD_READ" in worker
assert "ONES_ROOT_CAUSE_WRITE" in worker
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

# Public projection remains configuration-driven; the only write lane is the bounded native richtext root-cause writer.
writer = (ROOT / "root-cause-writer.js").read_text(encoding="utf-8")
assert "debugger" in manifest["permissions"]
assert "ONES_ROOT_CAUSE_WRITE" in worker
assert "writeEnabled" in worker and "writeEnabled" in popup
assert "taskTargetPolicy" in writer and "UNIQUE_ONES_TASK_ONLY" in writer
assert "fill_empty_only" in writer
assert "desiredSha256" in writer
assert "DESIRED_VALUE_HASH_MISMATCH" in writer
assert "POST_DRAFT_SAVE_CONTROL_NOT_UNIQUE" in writer
assert "draft.savePoint" in writer
assert "preflight.savePoint.x" not in writer
assert "crypto.subtle.digest" in writer
assert "WRITE_VERIFIED" in writer
assert "WRITE_UNVERIFIED" in writer
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

print("BROWSER_BRIDGE_PUBLIC_V052_POST_DRAFT_SAVE_RELOCATE_PASS")
