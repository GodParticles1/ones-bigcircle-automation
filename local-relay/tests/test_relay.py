import json
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PORT = 18732
BASE = f"http://127.0.0.1:{PORT}"


def request(method, path, token=None, payload=None):
    data = None if payload is None else json.dumps(payload).encode()
    headers = {"Content-Type": "application/json"}
    if token:
        headers["X-Relay-Token"] = token
    req = urllib.request.Request(BASE + path, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=3) as r:
            raw = r.read()
            return r.status, json.loads(raw) if raw else None
    except urllib.error.HTTPError as e:
        raw = e.read()
        return e.code, json.loads(raw) if raw else None


def main():
    with tempfile.TemporaryDirectory() as td:
        error_log = Path(td) / "relay-error.log"
        proc = subprocess.Popen(
            [sys.executable, str(ROOT / "relay.py"), "--port", str(PORT), "--data-dir", td],
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
        )
        try:
            for _ in range(50):
                try:
                    status, health = request("GET", "/health")
                    if status == 200:
                        break
                except Exception:
                    pass
                time.sleep(0.1)
            else:
                raise AssertionError("relay did not start")

            token = (Path(td) / "relay-token.txt").read_text().strip()
            assert health["ok"] is True
            assert health["version"] == "0.2.1"
            assert health["allowedJobTypes"] == ["ONES_INVENTORY_READ", "RELAY_PING"]
            assert int(health["pid"]) > 0

            status, body = request("GET", "/v1/stats")
            assert status == 401 and body["error"] == "UNAUTHORIZED"

            ping = {"jobType":"RELAY_PING", "idempotencyKey":"test-ping-1", "payload":{"source":"test"}}
            status, body = request("POST", "/v1/jobs", token, ping)
            assert status == 201 and body["job"]["state"] == "PENDING"
            ping_id = body["job"]["jobId"]

            status, body2 = request("POST", "/v1/jobs", token, ping)
            assert status == 200 and body2["deduplicated"] is True and body2["job"]["jobId"] == ping_id

            status, claim = request("POST", "/v1/extension/claim", token, {
                "executorId":"test-executor", "capabilities":["RELAY_PING", "ONES_INVENTORY_READ"]
            })
            assert status == 200 and claim["job"]["jobId"] == ping_id

            status, done = request("POST", "/v1/extension/result", token, {
                "jobId":ping_id, "executorId":"test-executor", "status":"RELAY_PING_OK", "result":{"ok":True}
            })
            assert status == 200 and done["job"]["state"] == "RELAY_PING_OK"

            inventory = {"jobType":"ONES_INVENTORY_READ", "idempotencyKey":"test-inventory-1", "payload":{"source":"test"}}
            status, body = request("POST", "/v1/jobs", token, inventory)
            assert status == 201
            inventory_id = body["job"]["jobId"]

            status, claim = request("POST", "/v1/extension/claim", token, {
                "executorId":"test-executor", "capabilities":["RELAY_PING", "ONES_INVENTORY_READ"]
            })
            assert status == 200 and claim["job"]["jobId"] == inventory_id

            inventory_result = {
                "status":"INVENTORY_VERIFIED", "ticketCount":128, "serverTotalCount":128,
                "visiblePageTotal":128, "inventoryComplete":True, "reconciliationAllowed":True
            }
            status, done = request("POST", "/v1/extension/result", token, {
                "jobId":inventory_id, "executorId":"test-executor", "status":"INVENTORY_VERIFIED", "result":inventory_result
            })
            assert status == 200 and done["job"]["state"] == "INVENTORY_VERIFIED"

            status, hb = request("POST", "/v1/extension/heartbeat", token, {
                "executorId":"test-executor", "extensionVersion":"0.3.36",
                "capabilities":["RELAY_PING", "ONES_INVENTORY_READ"], "onesTabCount":1
            })
            assert status == 200

            status, stats = request("GET", "/v1/stats", token)
            assert status == 200
            assert stats["jobsByState"]["RELAY_PING_OK"] == 1
            assert stats["jobsByState"]["INVENTORY_VERIFIED"] == 1

            # Routine success traffic must not generate normal request logs.
            assert not error_log.exists() or error_log.stat().st_size == 0
            print("RELAY_V021_TEST_PASS")
        finally:
            proc.terminate()
            try:
                proc.wait(timeout=3)
            except subprocess.TimeoutExpired:
                proc.kill()


if __name__ == "__main__":
    main()
