from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
script = (ROOT / "run-once.ps1").read_text(encoding="utf-8")

required = [
    "PERIODIC_ALIGNMENT_WAIT_BIGCIRCLE",
    "PERIODIC_ALIGNMENT_WAIT_RELAY",
    "PERIODIC_ALIGNMENT_WAIT_EXECUTOR",
    "PERIODIC_ALIGNMENT_WAIT_ONES",
    "PERIODIC_ALIGNMENT_BLOCKED",
    "RECONCILIATION_VERIFIED",
    "RECONCILIATION_NOOP_VERIFIED",
    "ONES_INVENTORY_READ",
    "INVENTORY_VERIFIED",
    "bigcircle.confirmed-case-export/v1alpha1",
    "CONFIRMED_REAL_CASE",
    "run-stage.ps1",
    "Get-FileHash",
]
for value in required:
    assert value in script, value

for forbidden in [
    "resourceVersion",
    "observedGeneration",
    "ALIGNMENT_RESYNC_REQUIRED",
    "WRITE_VERIFIED",
    "ONES_WRITE",
    "REMOTE_QUEUE",
    "https://",
]:
    assert forbidden not in script, forbidden

assert '-Recurse' in script
assert "Sort-Object LastWriteTimeUtc, FullName -Descending" in script
assert 'ticketCount' in script and 'serverTotalCount' in script and 'visiblePageTotal' in script
assert '127.0.0.1:18731' in script

print("PERIODIC_ALIGNMENT_STATIC_PASS")
