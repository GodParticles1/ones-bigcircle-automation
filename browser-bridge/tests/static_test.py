from pathlib import Path
import json, re

ROOT = Path(__file__).resolve().parents[1]
manifest = json.loads((ROOT / "manifest.json").read_text(encoding="utf-8"))
worker = (ROOT / "service-worker.js").read_text(encoding="utf-8")
popup = (ROOT / "popup.js").read_text(encoding="utf-8")
all_text = "\n".join(p.read_text(encoding="utf-8") for p in ROOT.rglob("*") if p.is_file() and p.name != "static_test.py" and p.suffix in {".js",".json",".md",".html",".css",".py"})

assert manifest["version"] == "0.4.0"
assert manifest["host_permissions"] == ["http://127.0.0.1/*"]
assert "https://*/*" in manifest["optional_host_permissions"]
assert "ONES_INVENTORY_READ" in worker
assert "RELAY_PING" in worker
assert "validatedOnesScope" in worker
assert "chrome.permissions.request" in popup
assert "update3" not in worker
assert "WRITE_VERIFIED" not in worker
assert "TARGET_NOT_AUTHORIZED" not in all_text

blocked = [
    r"ones\.xbrother\.com",
    r"TPfsXAwV",
    r"ELHHaaC7QhbJbqiC",
    r"RXZXaZsr",
    r"4548qTtT",
    r"YF-12439",
    r"张晓东|刘彬|郑嘉煌|方绍羽",
]
for pattern in blocked:
    assert not re.search(pattern, all_text), pattern

print("BROWSER_BRIDGE_PUBLIC_V040_STATIC_PASS")
