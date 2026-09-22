#!/usr/bin/env python3
import argparse
import hashlib
import json
import sys
from collections import Counter
from pathlib import Path

PLAN_SCHEMA = "ones.root-cause-sync-plan/v1alpha1"
CASE_FEED_SCHEMA = "bigcircle.confirmed-case-export/v1alpha1"
RECONCILIATION_SCHEMA = "ones.bigcircle-reconciliation/v1alpha1"
RECONCILIATION_IMPLEMENTATION = "0.2.1"
EXTRACTION_SCHEMA = "bigcircle.root-cause-extraction/v1alpha1"
FIELD_READ_SCHEMA = "ones.root-cause-field-read/v1alpha1"

DECISIONS = {"SET_CANDIDATE", "NOOP", "CONFLICT_REVIEW", "BLOCK"}


class PlannerBlocked(ValueError):
    pass


def load_json(path):
    with open(path, "r", encoding="utf-8-sig") as f:
        return json.load(f)


def sha256_file(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def nonblank(value):
    return isinstance(value, str) and bool(value.strip())


def normalize_compare_text(value):
    if value is None:
        return ""
    if not isinstance(value, str):
        raise PlannerBlocked("FIELD_VALUE_INVALID_TYPE")
    return value.replace("\r\n", "\n").replace("\r", "\n").strip()


def unique_index(rows, key_name, label):
    if not isinstance(rows, list):
        raise PlannerBlocked(f"{label}_ROWS_INVALID")
    counts = Counter(row.get(key_name) for row in rows if isinstance(row, dict))
    duplicates = sorted(str(k) for k, n in counts.items() if k is not None and n > 1)
    if duplicates:
        raise PlannerBlocked(f"{label}_DUPLICATE_ID:{','.join(duplicates)}")
    out = {}
    for row in rows:
        if not isinstance(row, dict):
            raise PlannerBlocked(f"{label}_ROW_INVALID")
        key = row.get(key_name)
        if not nonblank(key):
            raise PlannerBlocked(f"{label}_ID_MISSING")
        out[key] = row
    return out


def validate_case_feed(doc):
    if not isinstance(doc, dict) or doc.get("schema") != CASE_FEED_SCHEMA:
        raise PlannerBlocked("CASE_FEED_SCHEMA_INVALID")
    if doc.get("complete") is not True:
        raise PlannerBlocked("CASE_FEED_NOT_COMPLETE")
    cases = doc.get("cases")
    if not isinstance(cases, list):
        raise PlannerBlocked("CASE_FEED_CASES_INVALID")
    if doc.get("exportedCaseCount") != len(cases):
        raise PlannerBlocked("CASE_FEED_COUNT_MISMATCH")
    for row in cases:
        if not isinstance(row, dict):
            raise PlannerBlocked("CASE_FEED_ROW_INVALID")
        if row.get("caseStatus") != "CONFIRMED_REAL_CASE":
            raise PlannerBlocked("CASE_FEED_NON_CONFIRMED_ROW")
        if not nonblank(row.get("localCaseId")):
            raise PlannerBlocked("CASE_FEED_LOCAL_CASE_ID_MISSING")
        if not isinstance(row.get("remarks"), str):
            raise PlannerBlocked("CASE_FEED_REMARKS_INVALID")
    return cases


def validate_reconciliation(doc, cases_sha):
    if not isinstance(doc, dict) or doc.get("schemaVersion") != RECONCILIATION_SCHEMA:
        raise PlannerBlocked("RECONCILIATION_SCHEMA_INVALID")
    if doc.get("implementationVersion") != RECONCILIATION_IMPLEMENTATION:
        raise PlannerBlocked("RECONCILIATION_VERSION_INVALID")
    pipeline = doc.get("pipeline")
    if not isinstance(pipeline, dict):
        raise PlannerBlocked("RECONCILIATION_PIPELINE_MISSING")
    if pipeline.get("casesRawSha256") != cases_sha:
        raise PlannerBlocked("CASE_FEED_RECONCILIATION_HASH_DRIFT")
    return unique_index(doc.get("results"), "caseId", "RECONCILIATION")


def validate_extraction(doc, feed_index):
    if not isinstance(doc, dict) or doc.get("schema") != EXTRACTION_SCHEMA:
        raise PlannerBlocked("EXTRACTION_SCHEMA_INVALID")
    rows = doc.get("cases")
    if doc.get("inputCaseCount") != len(feed_index):
        raise PlannerBlocked("EXTRACTION_COUNT_MISMATCH")
    extraction = unique_index(rows, "localCaseId", "EXTRACTION")
    if set(extraction) != set(feed_index):
        raise PlannerBlocked("EXTRACTION_CASE_SET_DRIFT")
    for case_id, feed_row in feed_index.items():
        ext = extraction[case_id]
        if ext.get("sourceTicketKey") != feed_row.get("sourceTicketKey"):
            raise PlannerBlocked(f"EXTRACTION_IDENTITY_DRIFT:{case_id}")
        if ext.get("remarks") != feed_row.get("remarks"):
            raise PlannerBlocked(f"EXTRACTION_REMARKS_DRIFT:{case_id}")
    return extraction


def validate_field_reads(doc, field_id):
    if not nonblank(field_id):
        raise PlannerBlocked("FIELD_ID_MISSING")
    if not isinstance(doc, dict) or doc.get("schema") != FIELD_READ_SCHEMA:
        raise PlannerBlocked("FIELD_READ_SCHEMA_INVALID")
    if doc.get("complete") is not True:
        raise PlannerBlocked("FIELD_READ_SNAPSHOT_NOT_COMPLETE")
    if doc.get("fieldId") != field_id:
        raise PlannerBlocked("FIELD_READ_CONFIG_MISMATCH")
    rows = doc.get("reads")
    if not isinstance(rows, list):
        raise PlannerBlocked("FIELD_READ_ROWS_INVALID")
    index = {}
    for row in rows:
        if not isinstance(row, dict):
            raise PlannerBlocked("FIELD_READ_ROW_INVALID")
        task_uuid = row.get("onesTaskUuid")
        row_field = row.get("fieldId")
        if not nonblank(task_uuid) or not nonblank(row_field):
            raise PlannerBlocked("FIELD_READ_IDENTITY_MISSING")
        key = (task_uuid, row_field)
        if key in index:
            raise PlannerBlocked(f"FIELD_READ_DUPLICATE:{task_uuid}:{row_field}")
        index[key] = row
    return index


def block_row(feed_row, ext_row, reason, recon_row=None, field_id=None):
    return {
        "localCaseId": feed_row.get("localCaseId"),
        "sourceTicketKey": feed_row.get("sourceTicketKey"),
        "matchedOnesTaskUuid": (recon_row or {}).get("matchedOnesTaskUuid"),
        "fieldId": field_id,
        "rootCauseState": ext_row.get("rootCauseState"),
        "decision": "BLOCK",
        "reason": reason,
    }


def decide_case(feed_row, ext_row, recon_row, field_reads, field_id):
    if recon_row is None:
        return block_row(feed_row, ext_row, "RECONCILIATION_ROW_MISSING", None, field_id)
    if recon_row.get("sourceTicketKey") != feed_row.get("sourceTicketKey"):
        return block_row(feed_row, ext_row, "RECONCILIATION_IDENTITY_DRIFT", recon_row, field_id)
    status = recon_row.get("matchStatus")
    if status != "MATCHED":
        return block_row(feed_row, ext_row, f"RECONCILIATION_{status or 'STATUS_MISSING'}", recon_row, field_id)
    task_uuid = recon_row.get("matchedOnesTaskUuid")
    if not nonblank(task_uuid):
        return block_row(feed_row, ext_row, "MATCHED_TASK_UUID_MISSING", recon_row, field_id)
    if ext_row.get("rootCauseState") != "CONFIRMED" or not nonblank(ext_row.get("rootCauseText")):
        return block_row(feed_row, ext_row, "LOCAL_ROOT_CAUSE_NOT_CONFIRMED", recon_row, field_id)

    read_row = field_reads.get((task_uuid, field_id))
    if read_row is None:
        return block_row(feed_row, ext_row, "FIELD_READ_MISSING", recon_row, field_id)
    if read_row.get("status") != "READ_VERIFIED":
        return block_row(feed_row, ext_row, "FIELD_READ_NOT_VERIFIED", recon_row, field_id)

    value = read_row.get("value")
    if value is not None and not isinstance(value, str):
        return block_row(feed_row, ext_row, "FIELD_VALUE_INVALID_TYPE", recon_row, field_id)

    current = normalize_compare_text(value)
    proposed = normalize_compare_text(ext_row.get("rootCauseText"))
    if not proposed:
        return block_row(feed_row, ext_row, "LOCAL_ROOT_CAUSE_EMPTY_AFTER_NORMALIZATION", recon_row, field_id)

    if current == "":
        decision = "SET_CANDIDATE"
    elif current == proposed:
        decision = "NOOP"
    else:
        decision = "CONFLICT_REVIEW"

    return {
        "localCaseId": feed_row.get("localCaseId"),
        "sourceTicketKey": feed_row.get("sourceTicketKey"),
        "matchedOnesTaskUuid": task_uuid,
        "fieldId": field_id,
        "rootCauseState": ext_row.get("rootCauseState"),
        "decision": decision,
        "reason": "VERIFIED_CURRENT_VALUE_COMPARISON",
        "currentValue": value,
        "proposedValue": ext_row.get("rootCauseText"),
        "readCapturedAt": read_row.get("capturedAt"),
    }



def build_task_targets(feed_rows, extraction_index, recon_index, field_reads, field_id):
    groups = {}
    for feed_row in feed_rows:
        case_id = feed_row["localCaseId"]
        recon_row = recon_index.get(case_id)
        if not isinstance(recon_row, dict):
            continue
        if recon_row.get("matchStatus") != "MATCHED":
            continue
        task_uuid = recon_row.get("matchedOnesTaskUuid")
        if not nonblank(task_uuid):
            continue
        groups.setdefault(task_uuid, []).append({
            "feed": feed_row,
            "extraction": extraction_index[case_id],
            "reconciliation": recon_row,
        })

    targets = []
    for task_uuid in sorted(groups):
        rows = groups[task_uuid]
        local_case_ids = sorted(row["feed"]["localCaseId"] for row in rows)
        source_ticket_keys = sorted({
            row["feed"].get("sourceTicketKey")
            for row in rows
            if nonblank(row["feed"].get("sourceTicketKey"))
        })

        identity_drift = any(
            row["reconciliation"].get("sourceTicketKey") != row["feed"].get("sourceTicketKey")
            for row in rows
        )
        if identity_drift:
            targets.append({
                "matchedOnesTaskUuid": task_uuid,
                "fieldId": field_id,
                "localCaseIds": local_case_ids,
                "sourceTicketKeys": source_ticket_keys,
                "confirmedLocalCaseIds": [],
                "decision": "BLOCK",
                "reason": "RECONCILIATION_IDENTITY_DRIFT",
            })
            continue

        confirmed = []
        claims = {}
        for row in rows:
            ext = row["extraction"]
            if ext.get("rootCauseState") != "CONFIRMED" or not nonblank(ext.get("rootCauseText")):
                continue
            normalized = normalize_compare_text(ext.get("rootCauseText"))
            if not normalized:
                continue
            confirmed.append(row["feed"]["localCaseId"])
            claims.setdefault(normalized, []).append({
                "localCaseId": row["feed"]["localCaseId"],
                "sourceTicketKey": row["feed"].get("sourceTicketKey"),
                "raw": ext.get("rootCauseText"),
            })

        if not claims:
            targets.append({
                "matchedOnesTaskUuid": task_uuid,
                "fieldId": field_id,
                "localCaseIds": local_case_ids,
                "sourceTicketKeys": source_ticket_keys,
                "confirmedLocalCaseIds": sorted(confirmed),
                "decision": "BLOCK",
                "reason": "LOCAL_ROOT_CAUSE_NOT_CONFIRMED",
            })
            continue

        if len(claims) > 1:
            targets.append({
                "matchedOnesTaskUuid": task_uuid,
                "fieldId": field_id,
                "localCaseIds": local_case_ids,
                "sourceTicketKeys": source_ticket_keys,
                "confirmedLocalCaseIds": sorted(confirmed),
                "distinctConfirmedRootCauseCount": len(claims),
                "decision": "BLOCK",
                "reason": "LOCAL_ROOT_CAUSE_MULTI_CASE_CONFLICT",
            })
            continue

        proposed_normalized, provenance = next(iter(claims.items()))
        proposed_raw = provenance[0]["raw"]

        read_row = field_reads.get((task_uuid, field_id))
        if read_row is None:
            targets.append({
                "matchedOnesTaskUuid": task_uuid,
                "fieldId": field_id,
                "localCaseIds": local_case_ids,
                "sourceTicketKeys": source_ticket_keys,
                "confirmedLocalCaseIds": sorted(confirmed),
                "decision": "BLOCK",
                "reason": "FIELD_READ_MISSING",
                "proposedValue": proposed_raw,
            })
            continue
        if read_row.get("status") != "READ_VERIFIED":
            targets.append({
                "matchedOnesTaskUuid": task_uuid,
                "fieldId": field_id,
                "localCaseIds": local_case_ids,
                "sourceTicketKeys": source_ticket_keys,
                "confirmedLocalCaseIds": sorted(confirmed),
                "decision": "BLOCK",
                "reason": "FIELD_READ_NOT_VERIFIED",
                "proposedValue": proposed_raw,
            })
            continue

        value = read_row.get("value")
        if value is not None and not isinstance(value, str):
            targets.append({
                "matchedOnesTaskUuid": task_uuid,
                "fieldId": field_id,
                "localCaseIds": local_case_ids,
                "sourceTicketKeys": source_ticket_keys,
                "confirmedLocalCaseIds": sorted(confirmed),
                "decision": "BLOCK",
                "reason": "FIELD_VALUE_INVALID_TYPE",
                "proposedValue": proposed_raw,
            })
            continue

        current = normalize_compare_text(value)
        if current == "":
            decision = "SET_CANDIDATE"
        elif current == proposed_normalized:
            decision = "NOOP"
        else:
            decision = "CONFLICT_REVIEW"

        targets.append({
            "matchedOnesTaskUuid": task_uuid,
            "fieldId": field_id,
            "localCaseIds": local_case_ids,
            "sourceTicketKeys": source_ticket_keys,
            "confirmedLocalCaseIds": sorted(confirmed),
            "distinctConfirmedRootCauseCount": 1,
            "decision": decision,
            "reason": "UNIQUE_TASK_VERIFIED_CURRENT_VALUE_COMPARISON",
            "currentValue": value,
            "proposedValue": proposed_raw,
            "readCapturedAt": read_row.get("capturedAt"),
        })

    totals = {name: 0 for name in sorted(DECISIONS)}
    for row in targets:
        totals[row["decision"]] += 1
    return targets, totals


def build_plan(cases_path, reconciliation_path, extraction_path, field_reads_path, field_id):
    cases_sha = sha256_file(cases_path)
    case_doc = load_json(cases_path)
    recon_doc = load_json(reconciliation_path)
    extraction_doc = load_json(extraction_path)
    field_doc = load_json(field_reads_path)

    feed_rows = validate_case_feed(case_doc)
    feed_index = unique_index(feed_rows, "localCaseId", "CASE_FEED")
    recon_index = validate_reconciliation(recon_doc, cases_sha)
    extraction_index = validate_extraction(extraction_doc, feed_index)
    field_index = validate_field_reads(field_doc, field_id)

    decisions = []
    for feed_row in feed_rows:
        case_id = feed_row["localCaseId"]
        decisions.append(decide_case(
            feed_row,
            extraction_index[case_id],
            recon_index.get(case_id),
            field_index,
            field_id,
        ))

    totals = {name: 0 for name in sorted(DECISIONS)}
    for row in decisions:
        totals[row["decision"]] += 1

    task_targets, task_totals = build_task_targets(
        feed_rows,
        extraction_index,
        recon_index,
        field_index,
        field_id,
    )

    return {
        "schema": PLAN_SCHEMA,
        "status": "PLAN_READY",
        "fieldId": field_id,
        "inputs": {
            "caseFeedRawSha256": cases_sha,
            "reconciliationCasesRawSha256": recon_doc["pipeline"]["casesRawSha256"],
            "reconciliationRunKey": recon_doc["pipeline"].get("runKey"),
            "rootCauseInputCaseCount": extraction_doc.get("inputCaseCount"),
            "fieldReadCapturedAt": field_doc.get("capturedAt"),
        },
        "totals": totals,
        "caseCount": len(decisions),
        "cases": decisions,
        "taskTargetPolicy": "UNIQUE_ONES_TASK_ONLY",
        "taskTargetCount": len(task_targets),
        "taskTotals": task_totals,
        "taskTargets": task_targets,
    }


def main():
    ap = argparse.ArgumentParser(description="Build an execution-free root-cause synchronization plan")
    ap.add_argument("--cases", required=True)
    ap.add_argument("--reconciliation", required=True)
    ap.add_argument("--root-cause", required=True)
    ap.add_argument("--field-reads", required=True)
    ap.add_argument("--field-id", required=True)
    ap.add_argument("--output", required=True)
    args = ap.parse_args()
    try:
        plan = build_plan(
            args.cases,
            args.reconciliation,
            args.root_cause,
            args.field_reads,
            args.field_id,
        )
        Path(args.output).parent.mkdir(parents=True, exist_ok=True)
        Path(args.output).write_text(
            json.dumps(plan, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )
    except Exception as exc:
        print(f"ROOT_CAUSE_SYNC_PLAN_BLOCKED: {exc}", file=sys.stderr)
        return 2
    print(json.dumps({
        "status": plan["status"],
        "caseCount": plan["caseCount"],
        "totals": plan["totals"],
        "taskTargetCount": plan["taskTargetCount"],
        "taskTotals": plan["taskTotals"],
        "output": str(Path(args.output)),
    }, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
