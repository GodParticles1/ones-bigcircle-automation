#!/usr/bin/env python3
import argparse
import hashlib
import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path

from reconcile import IMPLEMENTATION_VERSION, load_json, reconcile

PIPELINE_SCHEMA_VERSION = "ones.bigcircle-reconciliation-pipeline/v1alpha1"
CHECKPOINT_SCHEMA_VERSION = "ones.bigcircle-reconciliation-checkpoint/v1alpha1"
PIPELINE_VERSION = "0.2.0"


def utc_now():
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def sha256_file(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def sha256_bytes(data):
    return hashlib.sha256(data).hexdigest()


def canonical_json_bytes(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")


def atomic_write_json(path, value):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(path.name + ".tmp")
    payload = json.dumps(value, ensure_ascii=False, indent=2) + "\n"
    tmp.write_text(payload, encoding="utf-8")
    os.replace(tmp, path)


def normalize_people_arg(value):
    if value is None:
        return None
    items = [x.strip() for x in value.replace("，", ",").split(",") if x.strip()]
    return sorted(set(items))


def make_run_key(cases_sha, inventory_sha, people):
    envelope = {
        "pipelineVersion": PIPELINE_VERSION,
        "implementationVersion": IMPLEMENTATION_VERSION,
        "casesRawSha256": cases_sha,
        "inventoryRawSha256": inventory_sha,
        "people": people or [],
    }
    return sha256_bytes(canonical_json_bytes(envelope))


def load_checkpoint(path):
    p = Path(path)
    if not p.exists():
        return None
    try:
        return json.loads(p.read_text(encoding="utf-8-sig"))
    except Exception as e:
        raise ValueError(f"checkpoint unreadable: {e}") from e


def checkpoint_report_is_valid(checkpoint, report_path):
    if not checkpoint or checkpoint.get("state") != "RECONCILIATION_VERIFIED":
        return False
    report_path = Path(report_path)
    if not report_path.exists():
        return False
    expected = checkpoint.get("report", {}).get("sha256")
    if not expected:
        return False
    return sha256_file(report_path) == expected


def run_pipeline(cases_path, inventory_path, state_dir, output_dir, people=None, force=False):
    cases_path = Path(cases_path)
    inventory_path = Path(inventory_path)
    state_dir = Path(state_dir)
    output_dir = Path(output_dir)
    state_dir.mkdir(parents=True, exist_ok=True)
    output_dir.mkdir(parents=True, exist_ok=True)

    cases_sha = sha256_file(cases_path)
    inventory_sha = sha256_file(inventory_path)
    normalized_people = normalize_people_arg(people)
    run_key = make_run_key(cases_sha, inventory_sha, normalized_people)

    checkpoint_path = state_dir / "reconciliation-checkpoint.json"
    latest_path = output_dir / "reconciliation-latest.json"
    checkpoint = load_checkpoint(checkpoint_path)

    if not force and checkpoint and checkpoint.get("runKey") == run_key and checkpoint_report_is_valid(checkpoint, latest_path):
        return {
            "status": "RECONCILIATION_NOOP_VERIFIED",
            "runKey": run_key,
            "checkpoint": str(checkpoint_path),
            "output": str(latest_path),
            "totals": checkpoint.get("totals", {}),
            "uniqueMissingSourceTicketKeyCount": checkpoint.get("uniqueMissingSourceTicketKeyCount"),
        }

    inventory = load_json(inventory_path)
    cases_doc = load_json(cases_path)
    report = reconcile(inventory, cases_doc, normalized_people)

    report["pipeline"] = {
        "schemaVersion": PIPELINE_SCHEMA_VERSION,
        "pipelineVersion": PIPELINE_VERSION,
        "runKey": run_key,
        "casesFile": cases_path.name,
        "casesRawSha256": cases_sha,
        "inventoryFile": inventory_path.name,
        "inventoryRawSha256": inventory_sha,
    }

    report_bytes = (json.dumps(report, ensure_ascii=False, indent=2) + "\n").encode("utf-8")
    report_sha = sha256_bytes(report_bytes)
    latest_tmp = latest_path.with_name(latest_path.name + ".tmp")
    latest_tmp.write_bytes(report_bytes)
    os.replace(latest_tmp, latest_path)

    archive_name = f"reconciliation-{run_key[:12]}.json"
    archive_path = output_dir / archive_name
    if not archive_path.exists() or sha256_file(archive_path) != report_sha:
        archive_tmp = archive_path.with_name(archive_path.name + ".tmp")
        archive_tmp.write_bytes(report_bytes)
        os.replace(archive_tmp, archive_path)

    checkpoint_doc = {
        "schemaVersion": CHECKPOINT_SCHEMA_VERSION,
        "pipelineVersion": PIPELINE_VERSION,
        "implementationVersion": IMPLEMENTATION_VERSION,
        "state": "RECONCILIATION_VERIFIED",
        "generatedAt": utc_now(),
        "runKey": run_key,
        "inputs": {
            "cases": {
                "file": cases_path.name,
                "rawSha256": cases_sha,
                "inputCaseCount": report.get("inputCaseCount"),
                "includedCaseCount": report.get("includedCaseCount"),
            },
            "inventory": {
                "file": inventory_path.name,
                "rawSha256": inventory_sha,
                "canonicalSha256": report.get("inventory", {}).get("snapshotSha256"),
                "capturedAt": report.get("inventory", {}).get("capturedAt"),
                "ticketCount": report.get("inventory", {}).get("ticketCount"),
                "status": report.get("inventory", {}).get("status"),
            },
        },
        "report": {
            "latest": latest_path.name,
            "archive": archive_name,
            "sha256": report_sha,
        },
        "totals": report.get("totals", {}),
        "uniqueMissingSourceTicketKeyCount": report.get("uniqueMissingSourceTicketKeyCount"),
        "quarterMetrics": report.get("quarterMetrics", {}),
        "exportWarnings": report.get("exportWarnings", []),
    }
    atomic_write_json(checkpoint_path, checkpoint_doc)

    return {
        "status": "RECONCILIATION_VERIFIED",
        "runKey": run_key,
        "checkpoint": str(checkpoint_path),
        "output": str(latest_path),
        "archive": str(archive_path),
        "reportSha256": report_sha,
        "includedCaseCount": report.get("includedCaseCount"),
        "totals": report.get("totals"),
        "uniqueMissingSourceTicketKeyCount": report.get("uniqueMissingSourceTicketKeyCount"),
        "quarterMetrics": report.get("quarterMetrics"),
    }


def main():
    ap = argparse.ArgumentParser(description="Checkpointed Big-circle reconciliation pipeline stage")
    ap.add_argument("--inventory", required=True)
    ap.add_argument("--cases", required=True)
    ap.add_argument("--state-dir", required=True)
    ap.add_argument("--output-dir", required=True)
    ap.add_argument("--people", help="Comma-separated configured people; optional")
    ap.add_argument("--force", action="store_true", help="Recompute even when the exact input pair is already verified")
    args = ap.parse_args()
    try:
        result = run_pipeline(
            args.cases,
            args.inventory,
            args.state_dir,
            args.output_dir,
            args.people,
            args.force,
        )
    except Exception as e:
        print(f"RECONCILIATION_PIPELINE_BLOCKED: {e}", file=sys.stderr)
        return 2
    print(json.dumps(result, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
