"""Exercise the release startup script against the reusable synthetic periodic fixture."""
from contextlib import nullcontext
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest

from test_archive import MOCK, REPO, snapshot, cases, write_json


LAUNCH = MOCK.split("Set-Location -LiteralPath $Root", 1)[0].replace(
    "Join-Path $Root 'input.json'", "Join-Path $fixtureRoot 'input.json'").replace(
    "    switch ([uri]::new($Uri).AbsolutePath) {",
    "    if ((Split-Path $Reconciliation -Leaf) -eq 'legacy-reconciliation') { throw 'Unexpected relay call before component validation' }\n"
    "    switch ([uri]::new($Uri).AbsolutePath) {") + r'''
Set-Location -LiteralPath $Root
$fixtureRoot = $Root
$realShell = (Get-Command powershell.exe -CommandType Application).Source
$launchPath = Join-Path $Root 'launch-harness/run-once.ps1'
$periodicPath = Join-Path $Root 'launch-harness/periodic-alignment/run-once.ps1'
# Preserve the real launcher and its arguments; dispatch the periodic child in-process
# so the existing synthetic relay mock applies. Run all other children normally.
function powershell.exe {
    $fileIndex = [Array]::IndexOf($args, '-File')
    if ($fileIndex -ge 0 -and $args[$fileIndex + 1] -eq $periodicPath) {
        $child = @{PollIntervalSeconds=0; InventoryTimeoutSeconds=5}
        for ($i = $fileIndex + 2; $i -lt $args.Count; $i += 2) {
            $child[$args[$i].TrimStart('-')] = $args[$i + 1]
        }
        & $periodicPath @child
    } elseif ($fileIndex -ge 0 -and $args[$fileIndex + 1] -eq (Join-Path $Reconciliation 'run-stage.ps1')) {
        & $realShell @args
    } else {
        throw 'Unexpected synthetic child entry point'
    }
}
$options = @{ReconciliationDir=$Reconciliation}
if ($Assignee) { $options.ObserveAssignee = $Assignee }
& $launchPath @options
exit $LASTEXITCODE
'''


@unittest.skipUnless(os.name == "nt", "Windows startup entry point")
class StartupContract(unittest.TestCase):
    def test_default_opt_in_and_mismatched_components(self):
        reuse = os.environ.get("QT_ONES_SYNTHETIC_DIR")
        with (nullcontext(reuse) if reuse else tempfile.TemporaryDirectory()) as temp:
            root = Path(temp).resolve()
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
            doc = snapshot("launch-synthetic")
            write_json(root / "input.json", doc)
            stage = root / "launch-harness"
            (stage / "periodic-alignment").mkdir(parents=True, exist_ok=True)
            shutil.copyfile(REPO / "release/windows-agent-v0.1.1/run-once.ps1", stage / "run-once.ps1")
            shutil.copyfile(REPO / "periodic-alignment/run-once.ps1", stage / "periodic-alignment/run-once.ps1")
            (stage / "config.ps1").write_text(
                "$CaseFeedDir = './feed'\n$RelayDir = './relay'\n$RuntimeDir = './runtime'\n",
                encoding="ascii")
            mock = stage / "launch-mock.ps1"
            mock.write_text(LAUNCH, encoding="utf-8-sig")
            runtime = root / "runtime"
            observation = runtime / "uuid-observation.json"

            def run(assignee=None, reconciliation=REPO / "reconciliation"):
                command = ["powershell.exe", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", str(mock),
                           str(REPO / "periodic-alignment/run-once.ps1"), str(root), str(reconciliation)]
                env = {k: v for k, v in os.environ.items() if k.upper() != "PSMODULEPATH"}
                proc = subprocess.run(command + ([assignee] if assignee else []), capture_output=True,
                                      env=env, timeout=35)
                self.assertTrue(proc.stdout.strip(), proc.stderr)
                return proc.returncode, json.loads(proc.stdout.decode("utf-8-sig").splitlines()[-1])

            def full_files():
                return {p.relative_to(runtime): p.read_bytes() for p in runtime.rglob("*") if p.is_file()
                        and p.name not in ("uuid-observation.json", "uuid-observation.lock")}

            old_observation = observation.read_bytes() if observation.exists() else None
            before_missing = full_files()
            code, missing = run()
            self.assertEqual(code, 2)
            self.assertEqual(missing["reason"], "PACKAGE_MANIFEST_MISSING")
            self.assertEqual(full_files(), before_missing)
            self.assertEqual(observation.read_bytes() if observation.exists() else None, old_observation)
            # Source runs use the explicit original periodic entry, not the package launcher.
            mock.write_text(MOCK, encoding="utf-8-sig")
            code, default = run()
            self.assertEqual(code, 0)
            self.assertIn(default["status"], ("RECONCILIATION_VERIFIED", "RECONCILIATION_NOOP_VERIFIED"))
            self.assertEqual(observation.read_bytes() if observation.exists() else None, old_observation)
            before = full_files()
            code, enabled = run("launch-user")
            self.assertEqual(code, 0)
            self.assertEqual(enabled["status"], "READONLY_UUID_OBSERVATION")
            self.assertEqual(enabled["newTaskUuids"], [])
            self.assertEqual(full_files(), before)
            prior = observation.read_bytes()

            # Model the original installation's CLI, which has no --validate-only or observer.
            legacy = stage / "legacy-reconciliation"
            legacy.mkdir(exist_ok=True)
            (legacy / "reconcile.py").write_text("import argparse\nargparse.ArgumentParser().parse_args()\n", encoding="ascii")
            for assignee, option in ((None, "--validate-only"), ("launch-user", "--state-dir")):
                code, blocked = run(assignee, legacy)
                self.assertEqual(code, 2)
                self.assertEqual(blocked["status"], "PERIODIC_ALIGNMENT_BLOCKED")
                self.assertEqual(blocked["reason"], "RECONCILIATION_COMPONENT_MISMATCH")
                self.assertEqual(blocked["requiredOption"], option)
                self.assertEqual(full_files(), before)
                self.assertEqual(observation.read_bytes(), prior)
            print(json.dumps({"default": default["status"], "optIn": enabled["status"],
                              "defaultPreservedObservation": True, "optInPreservedFullFiles": True,
                              "mismatchedComponents": ["--validate-only", "--state-dir"],
                              "blockedWithoutStateChange": True}))


if __name__ == "__main__":
    unittest.main()
