#!/usr/bin/env python3
import hashlib
import importlib.util
import json
import subprocess
import sys
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent


def load_module(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


ENV = load_module("gate_d2_env", ROOT / "transport-envelope" / "envelope.py")
SPOOL = load_module("gate_d2_spool", ROOT / "transport-spool" / "spool.py")
EX = load_module("gate_d2_exchange", ROOT / "filesystem-exchange" / "exchange.py")


def sha256(data):
    return hashlib.sha256(data).hexdigest()


def write_json(path, value):
    Path(path).write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def run_json(cmd, expected_rc=0):
    proc = subprocess.run(cmd, cwd=ROOT, text=True, capture_output=True)
    if proc.returncode != expected_rc:
        raise AssertionError(
            f"unexpected rc={proc.returncode} expected={expected_rc}\nstdout={proc.stdout}\nstderr={proc.stderr}"
        )
    docs = []
    for line in proc.stdout.splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            doc = json.loads(line)
        except Exception:
            continue
        if isinstance(doc, dict):
            docs.append(doc)
    return proc, (docs[-1] if docs else None)


def emit_raw_envelope(payload_bytes, path, *, complete=True):
    envelope = ENV.build_envelope_bytes(
        payload_bytes,
        direction="BIGCIRCLE_TO_WINDOWS",
        kind="CASE_FEED",
        producer="bigcircle-control",
        consumer="windows-agent",
        created_at="2026-09-22T00:00:00Z",
    )
    write_json(path, envelope)
    return envelope


def drain_reverse(win_spool, exchange, big_spool, receipts):
    imported = []
    while True:
        exported = EX.export_one(win_spool, exchange, "windows-agent", cleanup=True)
        if exported["status"] == "EMPTY":
            break
        assert exported["status"] in {"EXPORTED", "EXPORT_NOOP"}
        inbound = EX.import_one(exchange, big_spool, "bigcircle-control", cleanup=True)
        assert inbound["status"] in {"IMPORTED", "IMPORT_NOOP"}
        proc, result = run_json([
            sys.executable,
            str(ROOT / "bigcircle-control" / "consume_result.py"),
            "--spool-root", str(big_spool),
            "--receipt-root", str(receipts),
        ])
        assert result and result["status"] in {"RECEIPT_STORED", "RECEIPT_NOOP"}
        imported.append(result)
    return imported


def receipt_payloads(receipts):
    out = []
    for path in Path(receipts).rglob("env-*.json"):
        doc = json.loads(path.read_text(encoding="utf-8-sig"))
        out.append((path.parent.name, doc["payload"]))
    return out


def main():
    if sys.platform != "win32":
        print(json.dumps({"status": "GATE_D2_WINDOWS_RUNTIME_SKIPPED", "reason": "WINDOWS_REQUIRED"}))
        return 0

    case_feed_raw = (
        b'{\r\n'
        b'  "schema" : "bigcircle.confirmed-case-export/v1alpha1",\r\n'
        b'  "generatedAt" : "2026-09-22T00:00:00Z",\r\n'
        b'  "sourceTables" : ["ENG260921-260927"],\r\n'
        b'  "sourceTableCount" : 1,\r\n'
        b'  "exportedCaseCount" : 2,\r\n'
        b'  "complete" : true,\r\n'
        b'  "configuredPeopleScope" : ["Engineer-A"],\r\n'
        b'  "people" : ["Engineer-A"],\r\n'
        b'  "metadata" : {"complete":true,"exportedCaseCount":2,"sourceTables":["ENG260921-260927"],"sourceTableCount":1,"missingKeyCount":0},\r\n'
        b'  "cases" : [\r\n'
        b'    {"localCaseId":"CASE-SYNTH-001","sourceTable":"ENG260921-260927","date":"2026-09-22","dutyPersons":[],"handlerPersons":["Engineer-A"],"contactPersons":[],"groupChatName":"ABC-1 synthetic","sourceTicketKey":"ABC-1","summary":"synthetic match","remarks":"Synthetic confirmed evidence","caseStatus":"CONFIRMED_REAL_CASE"},\r\n'
        b'    {"localCaseId":"CASE-SYNTH-002","sourceTable":"ENG260921-260927","date":"2026-09-22","dutyPersons":[],"handlerPersons":["Engineer-A"],"contactPersons":[],"groupChatName":"MISS-2 synthetic","sourceTicketKey":"MISS-2","summary":"synthetic missing","remarks":"Synthetic confirmed evidence","caseStatus":"CONFIRMED_REAL_CASE"}\r\n'
        b'  ]\r\n'
        b'}\r\n'
    )
    expected_case_sha = sha256(case_feed_raw)

    inventory = {
        "capturedAt": "2026-09-22T00:00:00Z",
        "status": "INVENTORY_VERIFIED",
        "readOnly": True,
        "inventoryComplete": True,
        "reconciliationAllowed": True,
        "ticketCount": 1,
        "serverTotalCount": 1,
        "visiblePageTotal": 1,
        "unkeyedCount": 0,
        "tickets": [{
            "sourceTicketKey": "ABC-1",
            "onesDisplayId": "YF-SYNTH-1",
            "onesTaskUuid": "task-synthetic-1",
            "assignee": {"uuid": "user-synthetic-a", "name": "Engineer-A"},
        }],
    }

    with tempfile.TemporaryDirectory() as td:
        td = Path(td)
        big_spool = td / "big-spool"
        win_spool = td / "win-spool"
        exchange = td / "exchange"
        case_feed_dir = td / "case-feed"
        synthetic_relay_dir = td / "synthetic-input"
        runtime_dir = td / "runtime"
        receipts = td / "receipts"
        synthetic_relay_dir.mkdir(parents=True)
        write_json(synthetic_relay_dir / "synthetic-inventory.json", inventory)

        diagnostic_case_dir = td / "diagnostic-case-feed"
        diagnostic_runtime = td / "diagnostic-runtime"
        diagnostic_case_dir.mkdir(parents=True)
        diagnostic_case_file = diagnostic_case_dir / f"case-feed-{expected_case_sha}.json"
        diagnostic_case_file.write_bytes(case_feed_raw)
        _, diagnostic = run_json([
            "powershell.exe",
            "-NoProfile",
            "-ExecutionPolicy", "Bypass",
            "-File", str(HERE / "synthetic-periodic-alignment.ps1"),
            "-CaseFeedDir", str(diagnostic_case_dir),
            "-RelayDir", str(synthetic_relay_dir),
            "-ReconciliationDir", str(ROOT / "reconciliation"),
            "-RuntimeDir", str(diagnostic_runtime),
        ])
        assert diagnostic and diagnostic["status"] == "RECONCILIATION_VERIFIED", diagnostic

        source_env_file = td / "case-feed-envelope.json"
        source_env = emit_raw_envelope(case_feed_raw, source_env_file)
        assert source_env["payloadSha256"] == expected_case_sha
        assert ENV.decode_payload_bytes(source_env) == case_feed_raw

        stored = SPOOL.emit_outbound(big_spool, "bigcircle-control", source_env_file)
        assert stored["status"] == "OUTBOUND_STORED"
        big_outbox = Path(stored["path"])
        envelope_bytes = big_outbox.read_bytes()

        exported = EX.export_one(big_spool, exchange, "bigcircle-control", cleanup=False)
        assert exported["status"] == "EXPORTED"
        assert Path(exported["exchange"]).read_bytes() == envelope_bytes
        duplicate_export = EX.export_one(big_spool, exchange, "bigcircle-control", cleanup=False)
        assert duplicate_export["status"] == "EXPORT_NOOP"

        imported = EX.import_one(exchange, win_spool, "windows-agent", cleanup=False)
        assert imported["status"] == "IMPORTED"
        assert Path(imported["spool"]).read_bytes() == envelope_bytes
        duplicate_import = EX.import_one(exchange, win_spool, "windows-agent", cleanup=False)
        assert duplicate_import["status"] == "IMPORT_NOOP"

        _, first = run_json([
            sys.executable,
            str(ROOT / "windows-agent" / "run_once.py"),
            "--spool-root", str(win_spool),
            "--case-feed-dir", str(case_feed_dir),
            "--relay-dir", str(synthetic_relay_dir),
            "--reconciliation-dir", str(ROOT / "reconciliation"),
            "--periodic-script", str(HERE / "synthetic-periodic-alignment.ps1"),
            "--runtime-dir", str(runtime_dir),
        ])
        assert first and first["status"] == "RECONCILIATION_VERIFIED"
        assert first["materializationStatus"] == "MATERIALIZED"
        assert first["caseFeedSha256"] == expected_case_sha
        materialized = case_feed_dir / f"case-feed-{expected_case_sha}.json"
        assert materialized.read_bytes() == case_feed_raw
        assert (win_spool / "processed" / f'{source_env["envelopeId"]}.json').exists()

        first_receipts = drain_reverse(win_spool, exchange, big_spool, receipts)
        assert len(first_receipts) == 3, first_receipts
        first_payloads = receipt_payloads(receipts)
        assert any(kind == "result" and p.get("status") == "RECONCILIATION_VERIFIED" for kind, p in first_payloads)
        assert any(kind == "checkpoint" and p.get("status") == "CASE_FEED_MATERIALIZED" for kind, p in first_payloads)
        assert any(kind == "checkpoint" and p.get("status") == "RECONCILIATION_ACCEPTED" for kind, p in first_payloads)

        _, second = run_json([
            sys.executable,
            str(ROOT / "windows-agent" / "run_once.py"),
            "--spool-root", str(win_spool),
            "--case-feed-dir", str(case_feed_dir),
            "--relay-dir", str(synthetic_relay_dir),
            "--reconciliation-dir", str(ROOT / "reconciliation"),
            "--periodic-script", str(HERE / "synthetic-periodic-alignment.ps1"),
            "--runtime-dir", str(runtime_dir),
        ])
        assert second and second["status"] == "RECONCILIATION_NOOP_VERIFIED"
        assert second["materializationStatus"] == "EMPTY"
        assert second["caseFeedSha256"] == expected_case_sha
        noop_receipts = drain_reverse(win_spool, exchange, big_spool, receipts)
        assert len(noop_receipts) == 2, noop_receipts
        all_payloads = receipt_payloads(receipts)
        assert any(kind == "result" and p.get("status") == "RECONCILIATION_NOOP_VERIFIED" for kind, p in all_payloads)

        bad_case_feed = json.dumps({
            "schema": "bigcircle.confirmed-case-export/v1alpha1",
            "complete": False,
            "exportedCaseCount": 0,
            "cases": [],
        }, separators=(",", ":")).encode("utf-8")
        bad_env_file = td / "bad-case-envelope.json"
        bad_env = emit_raw_envelope(bad_case_feed, bad_env_file)
        SPOOL.emit_outbound(big_spool, "bigcircle-control", bad_env_file)

        while True:
            e = EX.export_one(big_spool, exchange, "bigcircle-control", cleanup=True)
            if e["status"] == "EMPTY":
                break
            if e["envelopeId"] == bad_env["envelopeId"]:
                break
        while True:
            bad_import = EX.import_one(exchange, win_spool, "windows-agent", cleanup=True)
            assert bad_import["status"] in {"IMPORTED", "IMPORT_NOOP"}
            if bad_import["envelopeId"] == bad_env["envelopeId"]:
                assert bad_import["status"] == "IMPORTED"
                break

        blocked_proc, blocked_doc = run_json([
            sys.executable,
            str(ROOT / "windows-agent" / "run_once.py"),
            "--spool-root", str(win_spool),
            "--case-feed-dir", str(case_feed_dir),
            "--relay-dir", str(synthetic_relay_dir),
            "--reconciliation-dir", str(ROOT / "reconciliation"),
            "--periodic-script", str(HERE / "synthetic-periodic-alignment.ps1"),
            "--runtime-dir", str(runtime_dir),
        ], expected_rc=2)
        assert "CASE_FEED_NOT_COMPLETE" in blocked_proc.stderr, blocked_proc.stderr
        assert (win_spool / "rejected" / f'{bad_env["envelopeId"]}.json').exists()

        print(json.dumps({
            "status": "GATE_D2_WINDOWS_LOCAL_RUNTIME_ACCEPTANCE_PASS",
            "caseFeedSha256": expected_case_sha,
            "exactPayloadBytesPreserved": True,
            "exportDuplicateNoop": True,
            "importDuplicateNoop": True,
            "claimProcessed": True,
            "claimRejected": True,
            "firstReconciliationStatus": first["status"],
            "secondReconciliationStatus": second["status"],
            "firstReverseReceiptCount": len(first_receipts),
            "noopReverseReceiptCount": len(noop_receipts),
            "failClosed": True,
            "browserRelayUsed": False,
            "productionProviderUsed": False,
        }, separators=(",", ":")))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
