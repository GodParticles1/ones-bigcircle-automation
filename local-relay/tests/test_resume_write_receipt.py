"""Exercise the actual PowerShell helper against an isolated loopback HTTP fixture."""
import hashlib
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
from threading import Thread
import unittest


TOKEN = "synthetic-resume-token"
VALUE = "Synthetic confirmed root cause"
JOB_ID = "synthetic-resume-job"
PROXY = Path(__file__).resolve().with_name("proxy_write_helper.ps1")


class ResumeReceiptTest(unittest.TestCase):
    def test_read_only_resume(self):
        shell = shutil.which("powershell.exe" if os.name == "nt" else "pwsh")
        self.assertIsNotNone(shell)
        target = {
            "matchedOnesTaskUuid": "synthetic-task", "fieldId": "synthetic-field",
            "decision": "SET_CANDIDATE", "distinctConfirmedRootCauseCount": 1,
            "currentValue": "", "proposedValue": VALUE,
        }
        raw = json.dumps({
            "status": "PLAN_READY", "taskTargetPolicy": "UNIQUE_ONES_TASK_ONLY",
            "taskTargets": [target],
        }).encode()
        plan_hash = hashlib.sha256(raw).hexdigest()
        value_hash = hashlib.sha256(VALUE.encode()).hexdigest()
        key = f"root-cause-write-utf8v3-{plan_hash[:12]}-synthetic-task-synthetic-field-{value_hash[:16]}"
        payload = {
            "displayId": "SYN-101", "taskUuid": "synthetic-task", "fieldId": "synthetic-field",
            "desiredValue": VALUE, "desiredSha256": value_hash, "planSha256": plan_hash,
            "taskTargetPolicy": "UNIQUE_ONES_TASK_ONLY", "decision": "SET_CANDIDATE",
            "writeMode": "fill_empty_only",
        }
        job = {"jobId": JOB_ID, "jobType": "ONES_ROOT_CAUSE_WRITE", "idempotencyKey": key,
               "payload": payload, "result": {"private": "SYNTHETIC-PRIVATE-RESULT"}}
        requests = []

        class RelayFixture(BaseHTTPRequestHandler):
            def do_GET(self):
                requests.append((self.command, self.path))
                if self.headers.get("X-Relay-Token") != TOKEN:
                    self.send_error(401)
                    return
                raw_response = json.dumps(response).encode()
                self.send_response(status)
                self.send_header("Content-Type", "application/json")
                self.end_headers()
                self.wfile.write(raw_response)

            def do_POST(self):
                requests.append((self.command, self.path))
                self.send_error(405)

            def log_message(self, *_args):
                pass

        cases = [
            ("offline", 503, {"ok": False}, None, "RESUME_RECEIPT_UNAVAILABLE"),
            ("recovered", 200, {"ok": True, "job": {**job, "state": "WRITE_VERIFIED"}},
             "CHECK_INDEPENDENT_READBACK_AND_RESTORE", None),
            ("missing", 404, {"ok": False, "error": "NOT_FOUND"}, None, "RESUME_RECEIPT_NOT_FOUND"),
            ("claimed", 200, {"ok": True, "job": {**job, "state": "CLAIMED"}}, "WAIT_EXISTING_JOB", None),
            ("uncertain", 200, {"ok": True, "job": {**job, "state": "WRITE_OPERATION_UNVERIFIED"}},
             "READ_ONLY_RECONCILIATION", None),
            ("wrong-field", 200, {"ok": True, "job": {**job, "payload": {**payload, "fieldId": "other"}}},
             None, "RESUME_RECEIPT_MISMATCH"),
            ("wrong-key", 200, {"ok": True, "job": {**job, "idempotencyKey": "other"}},
             None, "RESUME_RECEIPT_MISMATCH"),
        ]
        with tempfile.TemporaryDirectory() as temp, ThreadingHTTPServer(("127.0.0.1", 0), RelayFixture) as relay:
            plan = Path(temp) / "plan.json"
            plan.write_bytes(raw)
            token_file = Path(temp) / "token.txt"
            token_file.write_text(TOKEN, encoding="ascii")
            server = Thread(target=relay.serve_forever, daemon=True)
            server.start()
            child_env = {key: value for key, value in os.environ.items() if key.lower() != "psmodulepath"}
            try:
                for name, status, response, action, error_code in cases:
                    with self.subTest(name=name):
                        requests.clear()
                        result = subprocess.run([
                            shell, "-NoProfile", "-NonInteractive", "-File", str(PROXY),
                            "-PlanFile", str(plan), "-ExpectedPlanSha256", plan_hash,
                            "-TaskUuid", "synthetic-task", "-DisplayId", "SYN-101",
                            "-TokenFile", str(token_file), "-RelayPort", str(relay.server_port),
                            "-ResumeJobId", JOB_ID,
                        ], capture_output=True, text=True, errors="replace", timeout=15, env=child_env)
                        output = result.stdout + result.stderr
                        if error_code:
                            self.assertNotEqual(result.returncode, 0)
                            self.assertIn(error_code, output)
                        else:
                            self.assertEqual(result.returncode, 0, output)
                            self.assertEqual(json.loads(result.stdout), {
                                "jobId": JOB_ID, "state": response["job"]["state"],
                                "action": action, "newSubmissions": 0,
                            })
                        self.assertEqual(requests, [("GET", f"/v1/jobs/{JOB_ID}")])
                        for sensitive in (TOKEN, VALUE, "SYNTHETIC-PRIVATE-RESULT"):
                            self.assertNotIn(sensitive, output)
            finally:
                relay.shutdown()
                server.join()


if __name__ == "__main__":
    unittest.main()
