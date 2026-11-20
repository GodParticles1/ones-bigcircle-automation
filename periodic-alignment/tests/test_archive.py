"""Run the Windows periodic entry point with an in-process synthetic Relay."""
from contextlib import nullcontext
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
param($Entry, $Root, $Reconciliation, $Assignee)
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
            $inputFile = Join-Path $Root 'input.json'
            $result = Get-Content $inputFile -Raw | ConvertFrom-Json
            if ($result.scenario) {
                $reader = Join-Path (Split-Path $Entry) 'tests/synthetic_pages.js'
                $raw = & node $reader $inputFile
                if ($LASTEXITCODE -ne 0) { throw 'Synthetic pagination failed' }
                $result = $raw | ConvertFrom-Json
            }
            return @{job=@{state=$result.status; result=$result}}
        }
        default { throw 'Unexpected synthetic route' }
    }
}
Set-Location -LiteralPath $Root
$options = @{}
if ($Assignee) { $options.ObserveAssignee = $Assignee }
& $Entry @options -CaseFeedDir "$Root/feed" -RelayDir "$Root/relay" -ReconciliationDir $Reconciliation -RuntimeDir "./runtime" -PollIntervalSeconds 0
exit $LASTEXITCODE
"""


@unittest.skipUnless(os.name == "nt", "Windows periodic entry point")
class PeriodicArchive(unittest.TestCase):
    def test_invalid_receipts_preserve_verified_files(self):
        reuse = os.environ.get("QT_ONES_SYNTHETIC_DIR")
        with (nullcontext(reuse) if reuse else tempfile.TemporaryDirectory()) as temp:
            root = Path(temp)
            if reuse:
                root = root.resolve()
                root.mkdir(parents=True, exist_ok=True)
                marker = root / ".synthetic-periodic-fixture-v1"
                if any(root.iterdir()) and not marker.is_file():
                    self.fail("Choose an empty directory or the existing marked synthetic fixture")
                marker.touch(exist_ok=True)
            (root / "feed").mkdir(exist_ok=True)
            token = root / "relay/data/relay-token.txt"
            token.parent.mkdir(parents=True, exist_ok=True)
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

            def run(doc, assignee=None):
                write_json(root / "input.json", doc)
                env = {k: v for k, v in os.environ.items() if k.upper() != "PSMODULEPATH"}
                proc = subprocess.run(command + ([assignee] if assignee else []), capture_output=True, timeout=35, env=env)
                self.assertTrue(proc.stdout.strip(), proc.stderr)
                return json.loads(proc.stdout.decode("utf-8-sig").splitlines()[-1])

            def saved():
                return {p.relative_to(root): p.read_bytes() for p in (root / "runtime").rglob("*") if p.is_file()}

            valid = snapshot("first")
            first = run(valid)
            self.assertIn(first["status"], ("RECONCILIATION_VERIFIED", "RECONCILIATION_NOOP_VERIFIED"), first)
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


            def scan(ids, assignee="user-a", fail_page=None):
                return run({"scenario": {"ids": ids, "failPage": fail_page}}, assignee)

            # One installation, one runtime and one prior full checkpoint throughout.
            self.assertEqual(scan(["existing"], "alternate-user")["status"], "READONLY_UUID_OBSERVATION")
            base = scan(["existing"])
            self.assertEqual(base["status"], "READONLY_UUID_OBSERVATION", base)
            self.assertTrue(base["baseline"])
            self.assertEqual(base["newTaskUuids"], [])
            added = scan(["existing", "new-b", "new-c"])
            self.assertFalse(added["baseline"])
            self.assertEqual(added["pageCount"], 3)
            self.assertEqual(added["newTaskUuids"], ["new-b", "new-c"])
            after_success = saved()
            recovered_ids = ["existing", "new-b", "new-c", "new-d"]
            failed = scan(recovered_ids, fail_page=2)
            self.assertEqual(failed["status"], "PERIODIC_ALIGNMENT_WAIT_ONES")
            self.assertEqual(failed["inventoryStatus"], "INVENTORY_PAGE_QUERY_FAILED")
            self.assertEqual(saved(), after_success)
            recovered = scan(recovered_ids)
            self.assertEqual(recovered["newTaskUuids"], ["new-d"])
            replay = scan(recovered_ids)
            self.assertEqual(replay["newTaskUuids"], [])
            observation = Path(replay["observationFile"])
            self.assertEqual(json.loads(observation.read_text(encoding="utf-8"))["seenTaskUuids"],
                             sorted(recovered_ids))
            observation_files = {"uuid-observation.json", "uuid-observation.lock"}
            full_before = {p: b for p, b in before.items() if p.name not in observation_files}
            full_after = {p: b for p, b in saved().items() if p.name not in observation_files}
            self.assertEqual(full_after.keys(), full_before.keys())
            self.assertTrue(full_after == full_before, "full inventory or reconciliation output changed")
            print(json.dumps({"baseline": base["baseline"], "pages": added["pageCount"],
                              "added": added["newTaskUuids"], "failedPage": 2, "http": 503,
                              "failedStatus": failed["inventoryStatus"], "unchangedOnFailure": True,
                              "retryAdded": recovered["newTaskUuids"], "replayAdded": replay["newTaskUuids"]}))


if __name__ == "__main__":
    unittest.main()
