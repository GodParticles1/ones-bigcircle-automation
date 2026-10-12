"""Portable package contracts; actual installation/lifecycle tests run on Windows."""
import hashlib
import json
import pathlib
import re
import subprocess
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[3]
RELEASE = ROOT / "release/root-cause-fresh-install"
BASE = "055729c1668737bb23a750a98f2c998dadf98882"


class FreshInstallContracts(unittest.TestCase):
    def test_versions_and_release_hold(self):
        version = json.loads((RELEASE / "VERSION.json").read_text(encoding="utf-8-sig"))
        self.assertEqual(version["bridgeVersion"], "0.5.17")
        self.assertEqual(version["relayVersion"], "0.3.8")
        self.assertEqual(version["plannerVersion"], "0.2.0")
        self.assertFalse(version["writeEnabled"])
        self.assertEqual(version["operatorRelease"], "HOLD_WRITER_FIX")

    def test_core_sources_are_the_frozen_accepted_bytes(self):
        for relative in ("browser-bridge/root-cause-writer.js", "browser-bridge/service-worker.js",
                         "browser-bridge/manifest.json", "local-relay/relay.py", "root-cause/extract.py",
                         "root-cause-sync/plan.py", "release/root-cause-planner-runtime-v0.2.0/run-planner.ps1"):
            frozen = subprocess.check_output(["git", "show", f"{BASE}:{relative}"], cwd=ROOT)
            current = (ROOT / relative).read_bytes()
            # Windows Git can check text out as CRLF; compare canonical source bytes.
            self.assertEqual(hashlib.sha256(current.replace(b"\r\n", b"\n")).digest(),
                             hashlib.sha256(frozen.replace(b"\r\n", b"\n")).digest(), relative)

    def test_only_explicit_readonly_jobs_can_be_submitted(self):
        common = (RELEASE / "Common.ps1").read_text(encoding="utf-8-sig")
        verify = (RELEASE / "Verify-ReadOnly.ps1").read_text(encoding="utf-8-sig")
        self.assertIn("$Body.jobType -notin @('RELAY_PING','ONES_FIELD_READ')", common)
        self.assertIn("http://127.0.0.1:", common)
        self.assertEqual(verify.count("'/v1/jobs' 'POST'"), 1)
        self.assertIn("READONLY_EXECUTOR_GATE_FAILED", common)
        self.assertIn("FIELD_RESULT_NOT_COMPLETE_OR_EXACT", verify)
        self.assertIn("RESULT_EXECUTOR_MISMATCH", verify)

    def test_install_is_execution_free_and_normal_state_is_not_migrated(self):
        install = (RELEASE / "Install.ps1").read_text(encoding="utf-8-sig")
        start = (RELEASE / "Start.ps1").read_text(encoding="utf-8-sig")
        for forbidden in ("Invoke-FiRelay", "Start-Process", "Copy-Item *relay.db", "writeEnabled=$true"):
            self.assertNotIn(forbidden, install)
        self.assertIn("INSTALL_ROOT_NOT_EMPTY", install)
        self.assertIn("EXISTING_INSTALLATION_DIFFERS", install)
        self.assertIn("PORT_CONFLICT", start)
        self.assertIn("EXISTING_DB_WITHOUT_TOKEN", start)
        self.assertNotIn("upgrade-from", start)
        self.assertNotIn("ones-local-relay-v0.2", start)
        for path in RELEASE.glob("*.ps1"):
            content = path.read_text(encoding="utf-8-sig")
            for forbidden in ("Set-ExecutionPolicy", "Register-ScheduledTask", "--no-sandbox",
                              "ONES_ROOT_CAUSE_WRITE", "ONES_ROOT_CAUSE_FORMAT_REPAIR"):
                self.assertNotIn(forbidden, content, path.name)

    def test_package_inventory_has_no_runtime_state_or_thirdparty_binaries(self):
        builder = (ROOT / "scripts/build-root-cause-fresh-install.ps1").read_text(encoding="utf-8-sig")
        self.assertIn("BLOCKED_MISSING_ARTIFACT", builder)
        self.assertIn("sha256=(Get-FileHash", builder)
        self.assertIn("$entry.LastWriteTime", builder)
        self.assertNotIn("start.ps1'", builder)  # unsafe legacy migration entry is not shipped
        self.assertNotIn("enqueue-root-cause-write.ps1", builder)
        self.assertNotIn("Invoke-WebRequest", builder)
        for path in RELEASE.rglob("*"):
            if path.is_file():
                self.assertNotIn(path.suffix.lower(), (".exe", ".msi", ".db", ".sqlite"))
                self.assertNotEqual(path.name, "relay-token.txt")


if __name__ == "__main__":
    unittest.main()
