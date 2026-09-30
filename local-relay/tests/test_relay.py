from contextlib import closing
import hashlib
import json
import os
import shutil
import sqlite3
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



def capture_canonical_write(td, name, task="synthetic_task", field="synthetic_field", desired="Synthetic root cause: \u6839\u56e0", plan_note="baseline"):
    # All files and credentials here belong to the temporary synthetic test run.
    shell = shutil.which("powershell.exe" if os.name == "nt" else "pwsh")
    assert shell, "PowerShell is required to exercise the canonical enqueue helper"
    plan = {
        "status": "PLAN_READY", "taskTargetPolicy": "UNIQUE_ONES_TASK_ONLY", "note": plan_note,
        "taskTargets": [{
            "matchedOnesTaskUuid": task, "fieldId": field, "decision": "SET_CANDIDATE",
            "distinctConfirmedRootCauseCount": 1, "currentValue": "", "proposedValue": desired,
        }],
    }
    plan_file = Path(td) / (name + "-plan.json")
    plan_bytes = json.dumps(plan, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    plan_file.write_bytes(plan_bytes)
    plan_sha = hashlib.sha256(plan_bytes).hexdigest()
    token_file = Path(td) / "helper-token.txt"
    token_file.write_text("synthetic-helper-token", encoding="ascii")
    capture_file = Path(td) / (name + "-captured.json")
    # Windows PowerShell must build its own module path, not inherit pwsh's.
    child_env = {key: value for key, value in os.environ.items() if key.lower() != "psmodulepath"} if os.name == "nt" else None
    captured = subprocess.run([
        shell, "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File",
        str(ROOT / "tests" / "capture_write_helper.ps1"),
        "-HelperPath", str(ROOT / "enqueue-root-cause-write.ps1"),
        "-PlanFile", str(plan_file), "-ExpectedPlanSha256", plan_sha,
        "-TaskUuid", task, "-DisplayId", "SYN-101",
        "-TokenFile", str(token_file), "-CaptureFile", str(capture_file),
    ], stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=30, env=child_env)
    assert captured.returncode == 0, captured.stderr.decode("utf-8", errors="replace")
    body = json.loads(capture_file.read_text(encoding="utf-8"))
    desired_sha = hashlib.sha256(desired.encode("utf-8")).hexdigest()
    assert body["jobType"] == "ONES_ROOT_CAUSE_WRITE"
    assert body["payload"] == {
        "planSha256": plan_sha, "taskTargetPolicy": "UNIQUE_ONES_TASK_ONLY",
        "decision": "SET_CANDIDATE", "writeMode": "fill_empty_only",
        "displayId": "SYN-101", "taskUuid": task, "fieldId": field,
        "desiredValue": desired, "desiredSha256": desired_sha,
    }
    assert body["idempotencyKey"] == f"root-cause-write-utf8v3-{plan_sha[:12]}-{task}-{field}-{desired_sha[:16]}"
    return body


def test_write_namespace(td, token):
    corrected = capture_canonical_write(td, "first")
    repeat = capture_canonical_write(td, "repeat")
    assert repeat == corrected, "same payload must produce a stable key across independent helper runs"
    legacy = {**corrected, "idempotencyKey": corrected["idempotencyKey"].replace("utf8v3-", "utf8v2-", 1)}
    assert legacy["payload"] == corrected["payload"]
    assert legacy["idempotencyKey"] != corrected["idempotencyKey"]
    status, old = request("POST", "/v1/jobs", token, legacy)
    assert status == 201 and old["deduplicated"] is False
    old_id = old["job"]["jobId"]
    status, claim = request("POST", "/v1/extension/claim", token, {
        "executorId": "synthetic-namespace-executor", "capabilities": ["ONES_ROOT_CAUSE_WRITE"],
    })
    assert status == 200 and claim["job"]["jobId"] == old_id
    status, blocked = request("POST", "/v1/extension/result", token, {
        "jobId": old_id, "executorId": "synthetic-namespace-executor", "status": "WRITE_BLOCKED",
        "result": {"ok": False, "writeAttempted": False, "saveDispatched": False},
    })
    assert status == 200 and blocked["job"]["state"] == "WRITE_BLOCKED"
    db_uri = (Path(td) / "relay.db").as_uri() + "?mode=ro"
    with closing(sqlite3.connect(db_uri, uri=True)) as conn:
        old_row = conn.execute("SELECT * FROM jobs WHERE job_id=?", (old_id,)).fetchone()
        schema = conn.execute("SELECT sql FROM sqlite_master WHERE name='jobs'").fetchone()
        assert "idempotency_key TEXT NOT NULL UNIQUE" in schema[0]
    status, new = request("POST", "/v1/jobs", token, corrected)
    assert status == 201 and new["deduplicated"] is False
    assert new["job"]["jobId"] != old_id
    assert new["job"]["payload"] == corrected["payload"]
    status, again = request("POST", "/v1/jobs", token, repeat)
    assert status == 200 and again["deduplicated"] is True
    assert again["job"] == new["job"]

    # Each input dimension continues to use the existing deterministic key formula.
    keys = {corrected["idempotencyKey"]}
    for name, changes in [
        ("plan", {"plan_note": "changed"}),
        ("task", {"task": "synthetic_other_task"}),
        ("field", {"field": "synthetic_other_field"}),
        ("desired", {"desired": "Synthetic distinct confirmed cause"}),
    ]:
        variant = capture_canonical_write(td, name, **changes)
        assert variant["idempotencyKey"] not in keys
        keys.add(variant["idempotencyKey"])
        status, created = request("POST", "/v1/jobs", token, variant)
        assert status == 201 and created["deduplicated"] is False
        status, duplicated = request("POST", "/v1/jobs", token, variant)
        assert status == 200 and duplicated["job"]["jobId"] == created["job"]["jobId"]
    status, preserved = request("POST", "/v1/jobs", token, legacy)
    assert status == 200 and preserved["deduplicated"] is True
    assert preserved["job"] == blocked["job"]
    with closing(sqlite3.connect(db_uri, uri=True)) as conn:
        assert conn.execute("SELECT * FROM jobs WHERE job_id=?", (old_id,)).fetchone() == old_row
        assert conn.execute("SELECT sql FROM sqlite_master WHERE name='jobs'").fetchone() == schema
        assert conn.execute("SELECT COUNT(*) FROM jobs WHERE idempotency_key=?", (corrected["idempotencyKey"],)).fetchone()[0] == 1
    print("CANONICAL_UTF8V3_NAMESPACE_AND_PRESERVED_UTF8V2_JOB_PASS")



def run_preinput_helper(td, token, plan_file, plan_sha, task, field, previous_id=None):
    shell = shutil.which("powershell.exe" if os.name == "nt" else "pwsh")
    capture = Path(td) / ("child-" + (previous_id or "initial") + ".out")
    args = [shell, "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", str(ROOT / "tests" / "proxy_write_helper.ps1"),
            "-PlanFile", str(plan_file), "-ExpectedPlanSha256", plan_sha, "-TaskUuid", task,
            "-DisplayId", "SYN-101", "-RelayPort", str(PORT), "-TokenFile", str(Path(td) / "helper-token.txt")]
    if previous_id:
        args += ["-PreviousBlockedJobId", previous_id]
    result = subprocess.run(args, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=30)
    capture.write_bytes(result.stdout + result.stderr)
    return result


def claim_until(token, target_id, executor_id):
    for _ in range(20):
        status, claim = request("POST", "/v1/extension/claim", token, {"executorId":executor_id,"capabilities":["ONES_ROOT_CAUSE_WRITE"]})
        assert status == 200, (status, claim)
        claimed = claim["job"]
        if claimed["jobId"] == target_id:
            return claimed
        status, _ = request("POST", "/v1/extension/result", token, {"jobId":claimed["jobId"],"executorId":executor_id,"status":"WRITE_BLOCKED","result":{"ok":False,"blockedBy":"ROOT_CAUSE_LABEL_NOT_UNIQUE","writeAttempted":False,"saveDispatched":False}})
        assert status == 200
    raise AssertionError("target job was not claimable")


def test_preinput_child_authorization_and_rejections(td, token):
    proxy_text = (ROOT / "tests" / "proxy_write_helper.ps1").read_text(encoding="utf-8")
    assert '$productionBase = "http://127.0.0.1:18731"' in proxy_text
    assert '$testBase = "http://127.0.0.1:$RelayPort"' in proxy_text
    assert 'if ($Method -notin @("Get", "Post"))' in proxy_text
    assert 'TEST_PROXY_UNEXPECTED_URI' in proxy_text
    task, field, desired = "child-task", "root-cause", "Synthetic confirmed root cause"
    plan = {"status":"PLAN_READY", "taskTargetPolicy":"UNIQUE_ONES_TASK_ONLY", "taskTargets":[{
        "matchedOnesTaskUuid":task,"fieldId":field,"decision":"SET_CANDIDATE",
        "distinctConfirmedRootCauseCount":1,"currentValue":"","proposedValue":desired}]}
    plan_file = Path(td) / "child-plan.json"
    raw = json.dumps(plan, ensure_ascii=False, separators=(",", ":")).encode()
    plan_file.write_bytes(raw); plan_sha=hashlib.sha256(raw).hexdigest()
    (Path(td)/"helper-token.txt").write_text(token, encoding="ascii")
    payload = {"taskTargetPolicy":"UNIQUE_ONES_TASK_ONLY","decision":"SET_CANDIDATE","writeMode":"fill_empty_only",
               "planSha256":plan_sha,"displayId":"SYN-101","taskUuid":task,"fieldId":field,
               "desiredValue":desired,"desiredSha256":hashlib.sha256(desired.encode()).hexdigest()}
    # Same values, deliberately different JSON property order after Relay round-trip.
    shuffled_payload = dict(reversed(list(payload.items())))
    assert shuffled_payload == payload
    assert json.dumps(shuffled_payload) != json.dumps(payload)
    status,parent = request("POST","/v1/jobs",token,{"jobType":"ONES_ROOT_CAUSE_WRITE","idempotencyKey":"parent-preinput-1","payload":shuffled_payload})
    assert status == 201
    parent_id=parent["job"]["jobId"]
    claim_until(token, parent_id, "preinput-test")
    status,blocked=request("POST","/v1/extension/result",token,{"jobId":parent_id,"executorId":"preinput-test","status":"WRITE_BLOCKED","result":{"ok":False,"blockedBy":"ROOT_CAUSE_LABEL_NOT_UNIQUE","writeAttempted":False,"saveDispatched":False}})
    assert status==200
    status,before=request("GET","/v1/jobs/"+parent_id,token)
    assert status==200
    assert list(before["job"]["payload"]) == list(shuffled_payload)
    db_uri = (Path(td) / "relay.db").as_uri() + "?mode=ro"
    with closing(sqlite3.connect(db_uri, uri=True)) as conn:
        parent_row = conn.execute("SELECT * FROM jobs WHERE job_id=?", (parent_id,)).fetchone()
    result=run_preinput_helper(td,token,plan_file,plan_sha,task,field,parent_id)
    assert result.returncode==0, (result.stdout+result.stderr).decode(errors="replace")
    output=result.stdout.decode(errors="replace")
    child = json.loads(output[output.index("{"):])
    expected_key = f"root-cause-write-utf8v3-{plan_sha[:12]}-{task}-{field}-{payload['desiredSha256'][:16]}-after-{parent_id}"
    assert child["idempotencyKey"] == expected_key
    assert child["payload"] == payload
    repeat=run_preinput_helper(td,token,plan_file,plan_sha,task,field,parent_id)
    assert repeat.returncode==0, "REPEAT_HELPER_FAILED: "+(repeat.stdout+repeat.stderr).decode(errors="replace")
    assert "DEDUPLICATED=True" in repeat.stdout.decode(errors="replace"), "REPEAT_DEDUPE_OUTPUT: "+repeat.stdout.decode(errors="replace")
    status,after=request("GET","/v1/jobs/"+parent_id,token)
    assert before==after, "parent resource mutated"
    with closing(sqlite3.connect(db_uri, uri=True)) as conn:
        assert conn.execute("SELECT * FROM jobs WHERE job_id=?", (parent_id,)).fetchone() == parent_row
        assert conn.execute("SELECT COUNT(*) FROM jobs WHERE idempotency_key=?", (expected_key,)).fetchone()[0] == 1
    print("SHUFFLED_PARENT_ACCEPTED_CHILD_KEY_EXACT_DEDUP_PARENT_ROW_UNCHANGED_PASS")

    status,draft_row=request("POST","/v1/jobs",token,{"jobType":"ONES_ROOT_CAUSE_WRITE","idempotencyKey":"parent-draft-mismatch","payload":payload})
    assert status == 201
    draft_parent_id=draft_row["job"]["jobId"]
    claim_until(token, draft_parent_id, "draft-executor")
    status,_=request("POST","/v1/extension/result",token,{"jobId":draft_parent_id,"executorId":"draft-executor","status":"WRITE_BLOCKED","result":{"ok":False,"blockedBy":"DRAFT_DOM_MISMATCH","writeAttempted":False,"saveDispatched":False}})
    assert status == 200
    status,draft_before=request("GET","/v1/jobs/"+draft_parent_id,token)
    assert status == 200
    with closing(sqlite3.connect(db_uri, uri=True)) as conn:
        draft_parent_row = conn.execute("SELECT * FROM jobs WHERE job_id=?", (draft_parent_id,)).fetchone()
    draft_child=run_preinput_helper(td,token,plan_file,plan_sha,task,field,draft_parent_id)
    assert draft_child.returncode == 0, (draft_child.stdout+draft_child.stderr).decode(errors="replace")
    draft_output=json.loads(draft_child.stdout.decode(errors="replace")[draft_child.stdout.decode(errors="replace").index("{"):])
    assert draft_output["jobId"] != draft_parent_id
    draft_expected_key = f"root-cause-write-utf8v3-{plan_sha[:12]}-{task}-{field}-{payload['desiredSha256'][:16]}-after-{draft_parent_id}"
    assert draft_output["idempotencyKey"] == draft_expected_key
    assert draft_output["payload"] == payload
    draft_repeat=run_preinput_helper(td,token,plan_file,plan_sha,task,field,draft_parent_id)
    assert draft_repeat.returncode == 0, (draft_repeat.stdout+draft_repeat.stderr).decode(errors="replace")
    repeated_output = draft_repeat.stdout.decode(errors="replace")
    assert "DEDUPLICATED=True" in repeated_output
    assert json.loads(repeated_output[repeated_output.index("{"):]) == draft_output
    status,draft_after=request("GET","/v1/jobs/"+draft_parent_id,token)
    assert status == 200 and draft_after == draft_before, "draft-blocked parent resource mutated"
    with closing(sqlite3.connect(db_uri, uri=True)) as conn:
        assert conn.execute("SELECT * FROM jobs WHERE job_id=?", (draft_parent_id,)).fetchone() == draft_parent_row
        assert conn.execute("SELECT COUNT(*) FROM jobs WHERE idempotency_key=?", (draft_expected_key,)).fetchone()[0] == 1
    print("DRAFT_DOM_MISMATCH_PARENT_AUTHORIZATION_PASS")
    print("DRAFT_PARENT_RESOURCE_AND_ROW_IMMUTABLE_CHILD_KEY_EXACT_DEDUP_PASS")

    for name, result_patch, expected in [
      ("write", {"writeAttempted":True}, "PREVIOUS_JOB_WRITE_ATTEMPTED"),
      ("save", {"saveDispatched":True}, "PREVIOUS_JOB_SAVE_DISPATCHED"),
      ("draft-write", {"blockedBy":"DRAFT_DOM_MISMATCH","writeAttempted":True}, "PREVIOUS_JOB_WRITE_ATTEMPTED"),
      ("draft-save", {"blockedBy":"DRAFT_DOM_MISMATCH","saveDispatched":True}, "PREVIOUS_JOB_SAVE_DISPATCHED"),
      ("left", {"blockedBy":"LEFT_ALIGN_COMMAND_FAILED"}, "PREVIOUS_JOB_BLOCKER_NOT_ALLOWED"),
      ("unknown", {"blockedBy":"UNKNOWN_BLOCKER"}, "PREVIOUS_JOB_BLOCKER_NOT_ALLOWED"),
    ]:
      status,row=request("POST","/v1/jobs",token,{"jobType":"ONES_ROOT_CAUSE_WRITE","idempotencyKey":"parent-"+name,"payload":payload})
      assert status==201
      pid=row["job"]["jobId"]
      claim_until(token, pid, "preinput-test-"+name)
      blocked_result={"ok":False,"blockedBy":"ROOT_CAUSE_LABEL_NOT_UNIQUE","writeAttempted":False,"saveDispatched":False}; blocked_result.update(result_patch)
      status,_=request("POST","/v1/extension/result",token,{"jobId":pid,"executorId":"preinput-test-"+name,"status":"WRITE_BLOCKED","result":blocked_result}); assert status==200
      rejected=run_preinput_helper(td,token,plan_file,plan_sha,task,field,pid)
      assert rejected.returncode != 0 and expected in (rejected.stdout+rejected.stderr).decode(errors="replace"), name+" REJECT_OUTPUT: "+(rejected.stdout+rejected.stderr).decode(errors="replace")
    # Every required field is checked, not just the desired value or hash.
    variants = []
    for field_name in payload:
        variants.append(("missing-" + field_name, {k:v for k,v in payload.items() if k != field_name}, "WRITE_BLOCKED"))
        variants.append(("value-" + field_name, {**payload, field_name:payload[field_name] + "changed"}, "WRITE_BLOCKED"))
    variants.extend([
        ("extra", {**payload, "unexpected":"extra"}, "WRITE_BLOCKED"),
        ("field-name-case", {**{k:v for k,v in payload.items() if k != "decision"}, "Decision":payload["decision"]}, "WRITE_BLOCKED"),
        ("value-case", {**payload, "decision":"set_candidate"}, "WRITE_BLOCKED"),
        ("value-null", {**payload, "desiredValue":None}, "WRITE_BLOCKED"),
        ("value-array", {**payload, "desiredValue":[desired]}, "WRITE_BLOCKED"),
        ("non-blocked", payload, "WRITE_UNVERIFIED"),
    ])
    for name, parent_payload, parent_state in variants:
        status,row=request("POST","/v1/jobs",token,{"jobType":"ONES_ROOT_CAUSE_WRITE","idempotencyKey":"parent-shape-"+name,"payload":parent_payload})
        assert status == 201
        pid = row["job"]["jobId"]
        executor_id = "shape-executor-" + name
        claim_until(token, pid, executor_id)
        status,_=request("POST","/v1/extension/result",token,{
            "jobId":pid,"executorId":executor_id,"status":parent_state,
            "result":{"ok":False,"blockedBy":"ROOT_CAUSE_LABEL_NOT_UNIQUE","writeAttempted":False,"saveDispatched":False}})
        assert status == 200
        with closing(sqlite3.connect(db_uri, uri=True)) as conn:
            before_rows = conn.execute("SELECT * FROM jobs ORDER BY job_id").fetchall()
        rejected = run_preinput_helper(td, token, plan_file, plan_sha, task, field, pid)
        expected = "PREVIOUS_JOB_STATE_INVALID" if parent_state != "WRITE_BLOCKED" else "PREVIOUS_JOB_PAYLOAD_MISMATCH"
        assert rejected.returncode != 0 and expected in (rejected.stdout+rejected.stderr).decode(errors="replace"), name
        with closing(sqlite3.connect(db_uri, uri=True)) as conn:
            assert conn.execute("SELECT * FROM jobs ORDER BY job_id").fetchall() == before_rows
    print("EXACT_NINE_FIELDS_MISSING_EXTRA_CASE_VALUE_REJECTIONS_PASS")
    print("PREINPUT_CHILD_AUTHORIZATION_AND_REJECTION_MATRIX_PASS")

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
            assert health["version"] == "0.3.8"
            assert health["allowedJobTypes"] == ["ONES_FIELD_READ", "ONES_INVENTORY_READ", "ONES_ROOT_CAUSE_FORMAT_REPAIR", "ONES_ROOT_CAUSE_WRITE", "RELAY_PING"]
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
                "executorId":"test-executor", "capabilities":["RELAY_PING", "ONES_INVENTORY_READ", "ONES_FIELD_READ"]
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

            field_read = {"jobType":"ONES_FIELD_READ", "idempotencyKey":"test-field-read-1", "payload":{"fieldId":"field123", "onesTaskUuids":["task-001"]}}
            status, body = request("POST", "/v1/jobs", token, field_read)
            assert status == 201
            field_read_id = body["job"]["jobId"]

            status, claim = request("POST", "/v1/extension/claim", token, {
                "executorId":"test-executor", "capabilities":["RELAY_PING", "ONES_INVENTORY_READ", "ONES_FIELD_READ"]
            })
            assert status == 200 and claim["job"]["jobId"] == field_read_id

            field_result = {
                "status":"FIELD_READ_VERIFIED",
                "schema":"ones.root-cause-field-read/v1alpha1",
                "complete":True,
                "fieldId":"field123",
                "reads":[{"onesTaskUuid":"task-001","fieldId":"field123","status":"READ_VERIFIED","value":None}],
            }
            status, done = request("POST", "/v1/extension/result", token, {
                "jobId":field_read_id, "executorId":"test-executor", "status":"FIELD_READ_VERIFIED", "result":field_result
            })
            assert status == 200 and done["job"]["state"] == "FIELD_READ_VERIFIED"

            writer_job = {
                "jobType":"ONES_ROOT_CAUSE_WRITE",
                "idempotencyKey":"test-root-cause-write-1",
                "payload":{
                    "taskTargetPolicy":"UNIQUE_ONES_TASK_ONLY",
                    "decision":"SET_CANDIDATE",
                    "writeMode":"fill_empty_only",
                    "planSha256":"a"*64,
                    "displayId":"TEST-1",
                    "taskUuid":"task-001",
                    "fieldId":"field-root",
                    "desiredValue":"synthetic confirmed root cause"
                }
            }
            status, body = request("POST", "/v1/jobs", token, writer_job)
            assert status == 201
            writer_id = body["job"]["jobId"]
            status, claim = request("POST", "/v1/extension/claim", token, {
                "executorId":"test-executor", "capabilities":["ONES_ROOT_CAUSE_WRITE"]
            })
            assert status == 200 and claim["job"]["jobId"] == writer_id
            status, done = request("POST", "/v1/extension/result", token, {
                "jobId":writer_id, "executorId":"test-executor", "status":"WRITE_VERIFIED",
                "result":{"ok":True,"status":"WRITE_VERIFIED","writeAttempted":True}
            })
            assert status == 200 and done["job"]["state"] == "WRITE_VERIFIED"

            status, hb = request("POST", "/v1/extension/heartbeat", token, {
                "executorId":"test-executor", "extensionVersion":"0.3.36",
                "capabilities":["RELAY_PING", "ONES_INVENTORY_READ", "ONES_FIELD_READ", "ONES_ROOT_CAUSE_WRITE"], "onesTabCount":1
            })
            assert status == 200

            status, stats = request("GET", "/v1/stats", token)
            assert status == 200
            assert stats["jobsByState"]["RELAY_PING_OK"] == 1
            assert stats["jobsByState"]["INVENTORY_VERIFIED"] == 1
            assert stats["jobsByState"]["FIELD_READ_VERIFIED"] == 1
            assert stats["jobsByState"]["WRITE_VERIFIED"] == 1

            test_preinput_child_authorization_and_rejections(td, token)
            test_write_namespace(td, token)

            shell = shutil.which("powershell.exe" if os.name == "nt" else "pwsh")
            child_env = {key:value for key,value in os.environ.items() if key.lower() != "psmodulepath"} if os.name == "nt" else None
            upgrade = subprocess.run([
                shell, "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File",
                str(ROOT / "tests" / "test_upgrade_v038.ps1"), "-FixtureRoot", td,
            ], stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=30, env=child_env)
            assert upgrade.returncode == 0, (upgrade.stdout+upgrade.stderr).decode(errors="replace")
            assert b"UPGRADE_V037_TO_V038_DB_WAL_SHM_TOKEN_PRESERVED_PASS" in upgrade.stdout
            print("UPGRADE_V037_TO_V038_DB_WAL_SHM_TOKEN_PRESERVED_PASS")

            # Routine success traffic must not generate normal request logs.
            assert not error_log.exists() or error_log.stat().st_size == 0
            print("RELAY_V038_WRITE_IDEMPOTENCY_TEST_PASS")
        finally:
            proc.terminate()
            try:
                proc.wait(timeout=3)
            except subprocess.TimeoutExpired:
                proc.kill()


if __name__ == "__main__":
    main()
