#!/usr/bin/env python3
import argparse
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


envmod = load_module("transport_envelope", ROOT / "transport-envelope" / "envelope.py")
spoolmod = load_module("transport_spool", ROOT / "transport-spool" / "spool.py")
matmod = load_module("casefeed_materializer", HERE / "materialize_case_feed.py")

VERIFIED_STATUSES = {"RECONCILIATION_VERIFIED", "RECONCILIATION_NOOP_VERIFIED"}


class AgentRunError(ValueError):
    pass


def last_json_line(stdout):
    lines = [line.strip() for line in stdout.splitlines() if line.strip()]
    if not lines:
        raise AgentRunError("DOWNSTREAM_OUTPUT_EMPTY")
    for line in reversed(lines):
        try:
            doc = json.loads(line)
        except Exception:
            continue
        if isinstance(doc, dict):
            return doc
    raise AgentRunError("DOWNSTREAM_OUTPUT_INVALID")


def validate_downstream_result(doc):
    if not isinstance(doc, dict):
        raise AgentRunError("DOWNSTREAM_RESULT_INVALID")
    status = doc.get("status")
    if status not in VERIFIED_STATUSES:
        raise AgentRunError(f"DOWNSTREAM_NOT_VERIFIED:{status or 'STATUS_MISSING'}")
    required = ["caseFeedSha256", "inventorySha256", "reconciliationRunKey", "reconciliationOutput"]
    for key in required:
        value = doc.get(key)
        if not isinstance(value, str) or not value.strip():
            raise AgentRunError(f"DOWNSTREAM_FIELD_MISSING:{key}")
    return doc


def build_result_envelope(doc):
    payload = {
        "schema": "ones.bigcircle-transport-result/v1alpha1",
        "status": doc["status"],
        "caseFeedSha256": doc["caseFeedSha256"],
        "inventorySha256": doc["inventorySha256"],
        "reconciliationRunKey": doc["reconciliationRunKey"],
        "reconciliationOutput": doc["reconciliationOutput"],
    }
    return envmod.build_envelope(
        payload,
        direction="WINDOWS_TO_BIGCIRCLE",
        kind="RESULT",
        producer="windows-agent",
        consumer="bigcircle-control",
    )


def build_checkpoint_envelope(doc, result_envelope_id, materialization=None):
    payload = {
        "schema": "ones.bigcircle-transport-checkpoint/v1alpha1",
        "status": "RECONCILIATION_ACCEPTED",
        "reconciliationStatus": doc["status"],
        "caseFeedSha256": doc["caseFeedSha256"],
        "inventorySha256": doc["inventorySha256"],
        "reconciliationRunKey": doc["reconciliationRunKey"],
        "resultEnvelopeId": result_envelope_id,
    }
    if isinstance(materialization, dict) and materialization.get("sourceEnvelopeId"):
        payload["sourceEnvelopeId"] = materialization["sourceEnvelopeId"]
        payload["materializationStatus"] = materialization.get("status")
    return envmod.build_envelope(
        payload,
        direction="WINDOWS_TO_BIGCIRCLE",
        kind="CHECKPOINT",
        producer="windows-agent",
        consumer="bigcircle-control",
    )


def emit_envelope(spool_root, envelope):
    with tempfile.NamedTemporaryFile("w", suffix=".json", delete=False, encoding="utf-8") as tmp:
        json.dump(envelope, tmp, ensure_ascii=False, indent=2)
        tmp.write("\n")
        tmp_path = Path(tmp.name)
    try:
        return spoolmod.emit_outbound(spool_root, "windows-agent", tmp_path)
    finally:
        try:
            tmp_path.unlink()
        except FileNotFoundError:
            pass


def invoke_periodic_alignment(script, case_feed_dir, relay_dir, reconciliation_dir, runtime_dir):
    cmd = [
        "powershell.exe",
        "-NoProfile",
        "-ExecutionPolicy",
        "Bypass",
        "-File",
        str(script),
        "-CaseFeedDir",
        str(case_feed_dir),
        "-RelayDir",
        str(relay_dir),
        "-ReconciliationDir",
        str(reconciliation_dir),
        "-RuntimeDir",
        str(runtime_dir),
    ]
    proc = subprocess.run(cmd, text=True, capture_output=True)
    doc = last_json_line(proc.stdout)
    if proc.returncode != 0 and doc.get("status") in VERIFIED_STATUSES:
        raise AgentRunError("DOWNSTREAM_EXIT_MISMATCH")
    return validate_downstream_result(doc)


def run_once(spool_root, case_feed_dir, relay_dir, reconciliation_dir, periodic_script, runtime_dir):
    materialization = matmod.process_one(spool_root, case_feed_dir)

    downstream = invoke_periodic_alignment(
        periodic_script,
        case_feed_dir,
        relay_dir,
        reconciliation_dir,
        runtime_dir,
    )

    result_env = build_result_envelope(downstream)
    result_emit = emit_envelope(spool_root, result_env)

    checkpoint_env = build_checkpoint_envelope(
        downstream,
        result_env["envelopeId"],
        materialization if materialization.get("status") != "EMPTY" else None,
    )
    checkpoint_emit = emit_envelope(spool_root, checkpoint_env)

    return {
        "status": downstream["status"],
        "materializationStatus": materialization.get("status"),
        "resultEnvelopeId": result_env["envelopeId"],
        "resultOutbox": result_emit["path"],
        "checkpointEnvelopeId": checkpoint_env["envelopeId"],
        "checkpointOutbox": checkpoint_emit["path"],
        "caseFeedSha256": downstream["caseFeedSha256"],
        "inventorySha256": downstream["inventorySha256"],
        "reconciliationRunKey": downstream["reconciliationRunKey"],
    }


def main():
    ap = argparse.ArgumentParser(description="Run one Windows Agent alignment cycle")
    ap.add_argument("--spool-root", required=True)
    ap.add_argument("--case-feed-dir", required=True)
    ap.add_argument("--relay-dir", required=True)
    ap.add_argument("--reconciliation-dir", required=True)
    ap.add_argument("--periodic-script", default=str(ROOT / "periodic-alignment" / "run-once.ps1"))
    ap.add_argument("--runtime-dir", default=str(HERE / "runtime"))
    args = ap.parse_args()

    try:
        result = run_once(
            args.spool_root,
            args.case_feed_dir,
            args.relay_dir,
            args.reconciliation_dir,
            args.periodic_script,
            args.runtime_dir,
        )
        print(json.dumps(result, ensure_ascii=False))
        return 0
    except Exception as exc:
        print(f"WINDOWS_AGENT_RUN_BLOCKED: {exc}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
