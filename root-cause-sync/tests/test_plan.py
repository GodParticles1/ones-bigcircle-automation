import copy
import hashlib
import importlib.util
import json
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location("root_cause_sync_plan", ROOT / "plan.py")
MOD = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MOD)

FIELD_ID = "field-root-cause"
CASE_ID = "CASE-001"
KEY = "ABC1-100"
TASK = "task-uuid-001"
REMARKS = "Phenomenon: service failed; root cause: synthetic configuration mismatch"
ROOT_TEXT = "synthetic configuration mismatch"


def write_json(path, doc):
    path.write_text(json.dumps(doc, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def fixture(root, *, state="CONFIRMED", current=None, match_status="MATCHED", task=TASK, read_status="READ_VERIFIED"):
    cases = {
        "schema": "bigcircle.confirmed-case-export/v1alpha1",
        "complete": True,
        "exportedCaseCount": 1,
        "cases": [{
            "localCaseId": CASE_ID,
            "sourceTicketKey": KEY,
            "remarks": REMARKS,
            "caseStatus": "CONFIRMED_REAL_CASE",
        }],
    }
    cases_path = root / "cases.json"
    write_json(cases_path, cases)
    cases_sha = hashlib.sha256(cases_path.read_bytes()).hexdigest()

    recon = {
        "schemaVersion": "ones.bigcircle-reconciliation/v1alpha1",
        "implementationVersion": "0.2.1",
        "pipeline": {"casesRawSha256": cases_sha, "runKey": "run-001"},
        "results": [{
            "caseId": CASE_ID,
            "sourceTicketKey": KEY,
            "matchStatus": match_status,
            "matchedOnesTaskUuid": task,
        }],
    }
    extraction = {
        "schema": "bigcircle.root-cause-extraction/v1alpha1",
        "inputCaseCount": 1,
        "cases": [{
            "localCaseId": CASE_ID,
            "sourceTicketKey": KEY,
            "remarks": REMARKS,
            "rootCauseState": state,
            "rootCauseText": ROOT_TEXT if state == "CONFIRMED" else None,
            "rootCauseEvidenceSummary": "synthetic",
            "rootCauseSource": "remarks",
        }],
    }
    reads = {
        "schema": "ones.root-cause-field-read/v1alpha1",
        "complete": True,
        "fieldId": FIELD_ID,
        "capturedAt": "2026-09-22T00:00:00Z",
        "reads": [{
            "onesTaskUuid": TASK,
            "fieldId": FIELD_ID,
            "status": read_status,
            "value": current,
            "capturedAt": "2026-09-22T00:00:00Z",
        }],
    }

    recon_path = root / "reconciliation.json"
    ext_path = root / "root-cause.json"
    reads_path = root / "field-reads.json"
    write_json(recon_path, recon)
    write_json(ext_path, extraction)
    write_json(reads_path, reads)
    return cases_path, recon_path, ext_path, reads_path


def build(**kwargs):
    td = tempfile.TemporaryDirectory()
    root = Path(td.name)
    paths = fixture(root, **kwargs)
    plan = MOD.build_plan(*paths, FIELD_ID)
    return td, plan, paths


def decision(plan):
    assert plan["status"] == "PLAN_READY", plan
    assert plan["caseCount"] == 1, plan
    return plan["cases"][0]


td, plan, _ = build(current=None)
assert decision(plan)["decision"] == "SET_CANDIDATE"
assert plan["taskTargetCount"] == 1, plan
assert plan["taskTotals"]["SET_CANDIDATE"] == 1, plan
assert plan["taskTargets"][0]["decision"] == "SET_CANDIDATE", plan
td.cleanup()

td, plan, _ = build(current="  synthetic configuration mismatch\r\n")
assert decision(plan)["decision"] == "NOOP"
td.cleanup()

td, plan, _ = build(current="Synthetic configuration mismatch")
assert decision(plan)["decision"] == "CONFLICT_REVIEW"
td.cleanup()

td, plan, _ = build(current="different existing cause")
assert decision(plan)["decision"] == "CONFLICT_REVIEW"
td.cleanup()

for state in ("PROVISIONAL", "ABSENT", "CONFLICT"):
    td, plan, _ = build(state=state, current=None)
    row = decision(plan)
    assert row["decision"] == "BLOCK", row
    assert row["reason"] == "LOCAL_ROOT_CAUSE_NOT_CONFIRMED", row
    td.cleanup()

for status in ("ONES_MISSING_CASE", "PERSON_SCOPE_MISMATCH", "AMBIGUOUS"):
    td, plan, _ = build(match_status=status, current=None)
    row = decision(plan)
    assert row["decision"] == "BLOCK", row
    assert row["reason"] == f"RECONCILIATION_{status}", row
    td.cleanup()

td, plan, _ = build(task="task-uuid-other", current=None)
row = decision(plan)
assert row["decision"] == "BLOCK", row
assert row["reason"] == "FIELD_READ_MISSING", row
td.cleanup()

td, plan, _ = build(current=None, read_status="READ_FAILED")
row = decision(plan)
assert row["decision"] == "BLOCK", row
assert row["reason"] == "FIELD_READ_NOT_VERIFIED", row
td.cleanup()

with tempfile.TemporaryDirectory() as td_name:
    root = Path(td_name)
    paths = fixture(root)
    reads = json.loads(paths[3].read_text(encoding="utf-8"))
    reads["reads"] = []
    write_json(paths[3], reads)
    plan = MOD.build_plan(*paths, FIELD_ID)
    row = decision(plan)
    assert row["decision"] == "BLOCK", row
    assert row["reason"] == "FIELD_READ_MISSING", row

with tempfile.TemporaryDirectory() as td_name:
    root = Path(td_name)
    paths = fixture(root)
    try:
        MOD.build_plan(*paths, "")
        raise AssertionError("expected FIELD_ID_MISSING")
    except MOD.PlannerBlocked as exc:
        assert str(exc) == "FIELD_ID_MISSING", exc

with tempfile.TemporaryDirectory() as td_name:
    root = Path(td_name)
    paths = fixture(root)
    recon = json.loads(paths[1].read_text(encoding="utf-8"))
    recon["pipeline"]["casesRawSha256"] = "0" * 64
    write_json(paths[1], recon)
    try:
        MOD.build_plan(*paths, FIELD_ID)
        raise AssertionError("expected hash drift block")
    except MOD.PlannerBlocked as exc:
        assert str(exc) == "CASE_FEED_RECONCILIATION_HASH_DRIFT", exc

with tempfile.TemporaryDirectory() as td_name:
    root = Path(td_name)
    paths = fixture(root)
    ext = json.loads(paths[2].read_text(encoding="utf-8"))
    ext["cases"][0]["remarks"] = "changed"
    write_json(paths[2], ext)
    try:
        MOD.build_plan(*paths, FIELD_ID)
        raise AssertionError("expected remarks drift block")
    except MOD.PlannerBlocked as exc:
        assert str(exc) == f"EXTRACTION_REMARKS_DRIFT:{CASE_ID}", exc

with tempfile.TemporaryDirectory() as td_name:
    root = Path(td_name)
    paths = fixture(root)
    ext = json.loads(paths[2].read_text(encoding="utf-8"))
    ext["cases"][0]["sourceTicketKey"] = "OTHER1-2"
    write_json(paths[2], ext)
    try:
        MOD.build_plan(*paths, FIELD_ID)
        raise AssertionError("expected identity drift block")
    except MOD.PlannerBlocked as exc:
        assert str(exc) == f"EXTRACTION_IDENTITY_DRIFT:{CASE_ID}", exc

with tempfile.TemporaryDirectory() as td_name:
    root = Path(td_name)
    paths = fixture(root)
    reads = json.loads(paths[3].read_text(encoding="utf-8"))
    reads["reads"].append(copy.deepcopy(reads["reads"][0]))
    write_json(paths[3], reads)
    try:
        MOD.build_plan(*paths, FIELD_ID)
        raise AssertionError("expected duplicate field read block")
    except MOD.PlannerBlocked as exc:
        assert str(exc).startswith("FIELD_READ_DUPLICATE:"), exc

with tempfile.TemporaryDirectory() as td_name:
    root = Path(td_name)
    paths = fixture(root)
    reads = json.loads(paths[3].read_text(encoding="utf-8"))
    reads["reads"][0]["value"] = {"unexpected": True}
    write_json(paths[3], reads)
    plan = MOD.build_plan(*paths, FIELD_ID)
    row = decision(plan)
    assert row["decision"] == "BLOCK", row
    assert row["reason"] == "FIELD_VALUE_INVALID_TYPE", row


def duplicate_task_fixture(root, *, second_state="CONFIRMED", second_root=ROOT_TEXT, current=None):
    case2 = "CASE-002"
    key2 = "ABC1-101"
    remarks2 = "Phenomenon: duplicate local observation; root cause: " + (second_root or "unknown")

    cases = {
        "schema": "bigcircle.confirmed-case-export/v1alpha1",
        "complete": True,
        "exportedCaseCount": 2,
        "cases": [
            {
                "localCaseId": CASE_ID,
                "sourceTicketKey": KEY,
                "remarks": REMARKS,
                "caseStatus": "CONFIRMED_REAL_CASE",
            },
            {
                "localCaseId": case2,
                "sourceTicketKey": key2,
                "remarks": remarks2,
                "caseStatus": "CONFIRMED_REAL_CASE",
            },
        ],
    }
    cases_path = root / "cases.json"
    write_json(cases_path, cases)
    cases_sha = hashlib.sha256(cases_path.read_bytes()).hexdigest()

    recon = {
        "schemaVersion": "ones.bigcircle-reconciliation/v1alpha1",
        "implementationVersion": "0.2.1",
        "pipeline": {"casesRawSha256": cases_sha, "runKey": "run-dup"},
        "results": [
            {
                "caseId": CASE_ID,
                "sourceTicketKey": KEY,
                "matchStatus": "MATCHED",
                "matchedOnesTaskUuid": TASK,
            },
            {
                "caseId": case2,
                "sourceTicketKey": key2,
                "matchStatus": "MATCHED",
                "matchedOnesTaskUuid": TASK,
            },
        ],
    }
    extraction = {
        "schema": "bigcircle.root-cause-extraction/v1alpha1",
        "inputCaseCount": 2,
        "cases": [
            {
                "localCaseId": CASE_ID,
                "sourceTicketKey": KEY,
                "remarks": REMARKS,
                "rootCauseState": "CONFIRMED",
                "rootCauseText": ROOT_TEXT,
                "rootCauseEvidenceSummary": "synthetic",
                "rootCauseSource": "remarks",
            },
            {
                "localCaseId": case2,
                "sourceTicketKey": key2,
                "remarks": remarks2,
                "rootCauseState": second_state,
                "rootCauseText": second_root if second_state == "CONFIRMED" else None,
                "rootCauseEvidenceSummary": "synthetic",
                "rootCauseSource": "remarks",
            },
        ],
    }
    reads = {
        "schema": "ones.root-cause-field-read/v1alpha1",
        "complete": True,
        "fieldId": FIELD_ID,
        "capturedAt": "2026-09-22T00:00:00Z",
        "reads": [{
            "onesTaskUuid": TASK,
            "fieldId": FIELD_ID,
            "status": "READ_VERIFIED",
            "value": current,
            "capturedAt": "2026-09-22T00:00:00Z",
        }],
    }

    recon_path = root / "reconciliation.json"
    ext_path = root / "root-cause.json"
    reads_path = root / "field-reads.json"
    write_json(recon_path, recon)
    write_json(ext_path, extraction)
    write_json(reads_path, reads)
    return cases_path, recon_path, ext_path, reads_path


with tempfile.TemporaryDirectory() as td_name:
    root = Path(td_name)
    paths = duplicate_task_fixture(root, second_root="  synthetic configuration mismatch\r\n", current=None)
    plan = MOD.build_plan(*paths, FIELD_ID)
    assert plan["taskTargetCount"] == 1, plan
    target = plan["taskTargets"][0]
    assert target["decision"] == "SET_CANDIDATE", target
    assert target["distinctConfirmedRootCauseCount"] == 1, target
    assert target["confirmedLocalCaseIds"] == ["CASE-001", "CASE-002"], target

with tempfile.TemporaryDirectory() as td_name:
    root = Path(td_name)
    paths = duplicate_task_fixture(root, second_root="different confirmed root cause", current=None)
    plan = MOD.build_plan(*paths, FIELD_ID)
    assert plan["taskTargetCount"] == 1, plan
    target = plan["taskTargets"][0]
    assert target["decision"] == "BLOCK", target
    assert target["reason"] == "LOCAL_ROOT_CAUSE_MULTI_CASE_CONFLICT", target
    assert target["distinctConfirmedRootCauseCount"] == 2, target

with tempfile.TemporaryDirectory() as td_name:
    root = Path(td_name)
    paths = duplicate_task_fixture(root, second_state="ABSENT", second_root=None, current=None)
    plan = MOD.build_plan(*paths, FIELD_ID)
    target = plan["taskTargets"][0]
    assert target["decision"] == "SET_CANDIDATE", target
    assert target["confirmedLocalCaseIds"] == ["CASE-001"], target

with tempfile.TemporaryDirectory() as td_name:
    root = Path(td_name)
    paths = duplicate_task_fixture(root, second_root="  synthetic configuration mismatch\r\n", current="synthetic configuration mismatch")
    plan = MOD.build_plan(*paths, FIELD_ID)
    target = plan["taskTargets"][0]
    assert target["decision"] == "NOOP", target

with tempfile.TemporaryDirectory() as td_name:
    root = Path(td_name)
    paths = duplicate_task_fixture(root, second_root="  synthetic configuration mismatch\r\n", current="different existing cause")
    plan = MOD.build_plan(*paths, FIELD_ID)
    target = plan["taskTargets"][0]
    assert target["decision"] == "CONFLICT_REVIEW", target

print("ROOT_CAUSE_SYNC_PLAN_TEST_PASS")
