"""Run the Windows periodic entry point with an in-process synthetic Relay."""
import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO / "reconciliation" / "tests"))
from test_readonly_inventory import snapshot
from test_pipeline import cases, write_json


MOCK = r"""
param($Entry, $Root, $Reconciliation)
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
function Invoke-RestMethod($Method, $Uri, $Headers, $Body, $ContentType, $TimeoutSec) {
    switch ([uri]::new($Uri).AbsolutePath) {
        '/health' { return @{ok=$true} }
        '/v1/stats' {
            return @{executors=@(@{lastSeenAt=[DateTime]::UtcNow; capabilities=@('ONES_INVENTORY_READ')})}
        }
        '/v1/jobs' {
            if (($Body | ConvertFrom-Json).jobType -ne 'ONES_INVENTORY_READ') { throw 'Unexpected job' }
            return @{job=@{jobId='synthetic'}}
        }
        '/v1/jobs/synthetic' {
            return @{job=@{state='INVENTORY_VERIFIED'; result=(Get-Content (Join-Path $Root 'input.json') -Raw | ConvertFrom-Json)}}
        }
        default { throw 'Unexpected synthetic route' }
    }
}
Set-Location -LiteralPath $Root
& $Entry -CaseFeedDir "$Root/feed" -RelayDir "$Root/relay" -ReconciliationDir $Reconciliation -RuntimeDir "./runtime" -PollIntervalSeconds 0
exit $LASTEXITCODE
"""


@unittest.skipUnless(os.name == "nt", "Windows periodic entry point")
class PeriodicArchive(unittest.TestCase):
    def test_invalid_receipts_preserve_verified_files(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            (root / "feed").mkdir()
            token = root / "relay/data/relay-token.txt"
            token.parent.mkdir(parents=True)
            token.write_text("synthetic", encoding="ascii")
            feed = cases()
            feed.update(schema="bigcircle.confirmed-case-export/v1alpha1", complete=True,
                        exportedCaseCount=len(feed["cases"]))
            for row in feed["cases"]:
                row["caseStatus"] = "CONFIRMED_REAL_CASE"
            write_json(root / "feed/feed.json", feed)
            mock = root / "mock.ps1"
            mock.write_text(MOCK, encoding="utf-8-sig")
            command = ["powershell.exe", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", str(mock),
                       str(REPO / "periodic-alignment/run-once.ps1"), str(root), str(REPO / "reconciliation")]

            def run(doc):
                write_json(root / "input.json", doc)
                env = {k: v for k, v in os.environ.items() if k.upper() != "PSMODULEPATH"}
                proc = subprocess.run(command, capture_output=True, timeout=35, env=env)
                self.assertTrue(proc.stdout.strip(), proc.stderr)
                return json.loads(proc.stdout.decode("utf-8-sig").splitlines()[-1])

            def saved():
                return {p.relative_to(root): p.read_bytes() for p in (root / "runtime").rglob("*") if p.is_file()}

            valid = snapshot("first")
            first = run(valid)
            self.assertEqual(first["status"], "RECONCILIATION_VERIFIED", first)
            before = saved()
            self.assertTrue(list((root / "runtime/inventory").glob("*.json")))
            gap = snapshot("a", "b", "c")
            del gap["pages"][1]
            unknown = snapshot("a")
            unknown["pages"][0]["hasNextPage"] = None
            partial = {"schemaVersion": "ones.readonly-uuid-observation/v1",
                       "inventoryComplete": False, "reconciliationAllowed": False, "seenTaskUuids": ["a"]}
            for name, bad in (("duplicate", snapshot("a", "a")), ("gap", gap),
                              ("unknown terminal", unknown), ("observation", partial)):
                with self.subTest(input=name):
                    self.assertEqual(run(bad)["status"], "PERIODIC_ALIGNMENT_WAIT_ONES")
                    self.assertEqual(sorted(saved()), sorted(before))
                    self.assertTrue(saved() == before, "verified runtime file contents changed")


if __name__ == "__main__":
    unittest.main()
