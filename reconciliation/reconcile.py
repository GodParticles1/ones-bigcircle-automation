#!/usr/bin/env python3
import argparse
import hashlib
import json
import re
import sys
from collections import Counter, defaultdict
from datetime import date, datetime, timezone
from pathlib import Path

SCHEMA_VERSION = "ones.bigcircle-reconciliation/v1alpha1"
IMPLEMENTATION_VERSION = "0.2.1"
MIN_DATE = date(2026, 6, 1)
FINAL_WRITE_STATES = {
    "WRITE_VERIFIED": "writeVerified",
    "NOOP_VERIFIED": "noopVerified",
    "CONFLICT_REVIEW": "conflictReview",
    "WRITE_UNVERIFIED": "writeUnverified",
}
PENDING_WRITE_STATES = {"PENDING", "CLAIMED", "WAITING_FOR_BROWSER", "LOGIN_REQUIRED", "EXECUTOR_OFFLINE"}
KEY_PREFIX_RE = re.compile(r"^\s*(?:\[([^\]]+)\]|【([^】]+)】)")
LEADING_ASCII_TICKET_RE = re.compile(r"^\s*([A-Z0-9]+(?:-[A-Z0-9]+)+)", re.I)
EXTERNAL_TICKET_RE = re.compile(r"^(?=[A-Z0-9]*[A-Z])[A-Z0-9]+-\d+$")
ONES_DISPLAY_ID_RE = re.compile(r"^YF-\d+$")


def load_json(path):
    with open(path, "r", encoding="utf-8-sig") as f:
        return json.load(f)


def canonical_hash(value):
    payload = json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")
    return hashlib.sha256(payload).hexdigest()


def normalize_source_key(value):
    if value is None:
        return None
    s = str(value).strip().upper()
    if not s:
        return None
    if (s.startswith("[") and s.endswith("]")) or (s.startswith("【") and s.endswith("】")):
        s = s[1:-1]
    s = re.sub(r"\s+", "", s)
    return s or None


def extract_source_key(group_name):
    if not group_name:
        return None
    m = KEY_PREFIX_RE.match(str(group_name))
    if not m:
        return None
    return normalize_source_key(m.group(1) or m.group(2))


def parse_case_date(value):
    if value is None:
        return None
    if isinstance(value, (int, float)):
        try:
            return datetime.fromtimestamp(value / 1000 if value > 10_000_000_000 else value, tz=timezone.utc).date()
        except (ValueError, OSError, OverflowError):
            return None
    s = str(value).strip()
    if not s:
        return None
    for candidate in (s, s[:10]):
        try:
            return datetime.fromisoformat(candidate.replace("Z", "+00:00")).date()
        except ValueError:
            pass
    for fmt in ("%Y-%m-%d", "%Y/%m/%d", "%Y.%m.%d"):
        try:
            return datetime.strptime(s[:10], fmt).date()
        except ValueError:
            pass
    return None


def quarter_bucket(d):
    if d is None or d < MIN_DATE:
        return None
    if d.year == 2026 and d.month == 6:
        return "2026-Q2-PARTIAL"
    q = (d.month - 1) // 3 + 1
    return f"{d.year}-Q{q}"


def listify(value):
    if value is None:
        return []
    if isinstance(value, list):
        return [str(x).strip() for x in value if str(x).strip()]
    s = str(value).strip()
    if not s:
        return []
    return [x.strip() for x in re.split(r"[,，、;/]+", s) if x.strip()]


def first(case, names, default=None):
    for name in names:
        if name in case and case[name] not in (None, ""):
            return case[name]
    return default


def normalize_person_name(value):
    if value is None:
        return None
    text = re.sub(r"\s+", "", str(value)).strip().casefold()
    return text or None


def derive_effective_persons(handlers, duty):
    handler_people = [p for p in handlers if normalize_person_name(p)]
    if handler_people:
        return sorted(set(handler_people)), "HANDLER_PRIMARY"
    duty_people = [p for p in duty if normalize_person_name(p)]
    if duty_people:
        return sorted(set(duty_people)), "DUTY_FALLBACK"
    return [], "PERSON_UNRESOLVED"


def ticket_assignee(ticket):
    assignee = ticket.get("assignee")
    if not isinstance(assignee, dict):
        return None
    name = assignee.get("name")
    if not normalize_person_name(name):
        return None
    return {
        "uuid": assignee.get("uuid"),
        "name": str(name).strip(),
    }


def person_scope_compatible(local_people, assignee):
    assignee_name = normalize_person_name((assignee or {}).get("name"))
    if not assignee_name:
        return False
    return assignee_name in {normalize_person_name(p) for p in local_people if normalize_person_name(p)}


def normalize_case(raw, index):
    group_name = first(raw, ["groupChatName", "groupName", "chatName", "群聊名称"], "")
    explicit_key = first(raw, ["sourceTicketKey", "sourceTicketNo", "source_ticket_key"])
    source_key = normalize_source_key(explicit_key) if explicit_key else extract_source_key(group_name)
    d = parse_case_date(first(raw, ["caseDate", "date", "createdAt", "日期"]))
    duty = listify(first(raw, ["dutyPersons", "dutyPerson", "值班人"]))
    handlers = listify(first(raw, ["handlerPersons", "handlerPerson", "处理人"]))
    contacts = listify(first(raw, ["contactPersons", "contactPerson", "对接人"]))
    engineers = sorted(set(duty + handlers))
    effective_people, attribution_source = derive_effective_persons(handlers, duty)
    execution_status = str(first(raw, ["executionStatus", "writeStatus", "relayStatus"], "")).strip().upper() or None
    root_confirmed = first(raw, ["rootCauseConfirmed", "root_cause_confirmed"])
    if root_confirmed is not None:
        root_confirmed = bool(root_confirmed)
    return {
        "caseId": str(first(raw, ["localCaseId", "caseId", "id", "case_id"], f"case-{index+1}")),
        "sourceTable": first(raw, ["sourceTable", "tableName", "source_table"]),
        "caseDate": d.isoformat() if d else None,
        "quarter": quarter_bucket(d),
        "groupChatName": str(group_name or ""),
        "sourceTicketKey": source_key,
        "dutyPersons": duty,
        "handlerPersons": handlers,
        "contactPersons": contacts,
        "engineers": engineers,
        "effectiveLocalPersons": effective_people,
        "attributionSource": attribution_source,
        "summary": str(first(raw, ["summary", "remarks", "note", "备注"], "") or ""),
        "remarks": str(first(raw, ["remarks", "note", "备注"], "") or ""),
        "rootCauseConfirmed": root_confirmed,
        "executionStatus": execution_status,
    }


def validate_inventory(inv):
    errors = []
    tickets = inv.get("tickets")
    if not isinstance(tickets, list):
        errors.append("tickets must be an array")
        tickets = []
    counts = {
        "ticketCount": inv.get("ticketCount"),
        "serverTotalCount": inv.get("serverTotalCount"),
        "visiblePageTotal": inv.get("visiblePageTotal"),
    }
    if inv.get("status") != "INVENTORY_VERIFIED":
        errors.append("status must be INVENTORY_VERIFIED")
    if inv.get("inventoryComplete") is not True:
        errors.append("inventoryComplete must be true")
    if inv.get("reconciliationAllowed") is not True:
        errors.append("reconciliationAllowed must be true")
    if any(not isinstance(v, int) for v in counts.values()):
        errors.append("ticketCount/serverTotalCount/visiblePageTotal must be integers")
    elif len(set(counts.values())) != 1 or counts["ticketCount"] != len(tickets):
        errors.append("ticketCount/serverTotalCount/visiblePageTotal/len(tickets) must match exactly")

    normalized = []
    unkeyed = 0
    for i, t in enumerate(tickets):
        key = normalize_source_key(t.get("sourceTicketKey") or t.get("sourceTicketNo"))
        if not key:
            key = extract_source_key(t.get("title"))
        if not key:
            unkeyed += 1
        normalized.append((key, t))
    declared_unkeyed = inv.get("unkeyedCount")
    if declared_unkeyed is not None and declared_unkeyed != unkeyed:
        errors.append(f"unkeyedCount mismatch: declared={declared_unkeyed} actual={unkeyed}")
    return errors, normalized, unkeyed


def read_cases_document(doc):
    if isinstance(doc, list):
        return doc, None
    if isinstance(doc, dict) and isinstance(doc.get("cases"), list):
        return doc["cases"], doc.get("people")
    raise ValueError("Big-circle input must be an array or object with cases[]")


def inventory_key_hits(group_name, ones_by_key):
    text = str(group_name or "").upper()
    hits = []
    for key in ones_by_key:
        pattern = r"(?<![A-Z0-9-])" + re.escape(key) + r"(?![A-Z0-9-])"
        if re.search(pattern, text):
            hits.append(key)
    return sorted(hits)


def validate_bigcircle_metadata(cases_doc, raw_cases):
    warnings = []
    if not isinstance(cases_doc, dict):
        return warnings
    meta = cases_doc.get("metadata")
    if not isinstance(meta, dict):
        return warnings
    if meta.get("complete") is False:
        raise ValueError("Big-circle export gate failed: metadata.complete must not be false")
    declared = meta.get("exportedCaseCount")
    if isinstance(declared, int) and declared != len(raw_cases):
        raise ValueError(f"Big-circle export gate failed: exportedCaseCount={declared} len(cases)={len(raw_cases)}")
    tables = meta.get("sourceTables")
    table_count = meta.get("sourceTableCount")
    if isinstance(tables, list) and isinstance(table_count, int) and table_count != len(tables):
        raise ValueError(f"Big-circle export gate failed: sourceTableCount={table_count} len(sourceTables)={len(tables)}")
    actual_missing = sum(1 for c in raw_cases if not normalize_source_key(first(c, ["sourceTicketKey", "sourceTicketNo", "source_ticket_key"])))
    declared_missing = meta.get("missingKeyCount")
    if isinstance(declared_missing, int) and declared_missing != actual_missing:
        warnings.append({
            "code": "BIGCIRCLE_METADATA_MISSING_KEY_COUNT_MISMATCH",
            "declared": declared_missing,
            "actual": actual_missing,
        })
    return warnings


def resolve_local_key(case_row, ones_by_key):
    explicit = normalize_source_key(case_row.get("sourceTicketKey"))
    group_name = case_row.get("groupChatName") or ""
    hits = inventory_key_hits(group_name, ones_by_key)

    if len(hits) > 1:
        return explicit, "AMBIGUOUS", "MULTIPLE_VERIFIED_INVENTORY_KEYS_IN_GROUP_NAME"
    if len(hits) == 1 and (not explicit or len(ones_by_key.get(explicit, [])) == 0):
        return hits[0], "MATCHED", "EXACT_VERIFIED_INVENTORY_KEY_EMBEDDED"

    if not explicit:
        return None, "AMBIGUOUS", "SOURCE_TICKET_KEY_MISSING_OR_MALFORMED"
    if ONES_DISPLAY_ID_RE.fullmatch(explicit):
        return explicit, "AMBIGUOUS", "LOCAL_KEY_IS_ONES_DISPLAY_ID"
    if not EXTERNAL_TICKET_RE.fullmatch(explicit):
        return explicit, "AMBIGUOUS", "LOCAL_KEY_NOT_EXTERNAL_TICKET_FORMAT"

    m = LEADING_ASCII_TICKET_RE.match(group_name)
    if m:
        leading = normalize_source_key(m.group(1))
        if leading and leading != explicit and leading.startswith(explicit + "-"):
            return explicit, "AMBIGUOUS", f"LOCAL_KEY_TRUNCATED_FROM_GROUP_PREFIX:{leading}"

    matches = ones_by_key.get(explicit, [])
    if len(matches) == 1:
        return explicit, "MATCHED", None
    if len(matches) > 1:
        return explicit, "AMBIGUOUS", "DUPLICATE_ONES_SOURCE_TICKET_KEY"
    return explicit, "ONES_MISSING_CASE", "NO_EXACT_SOURCE_TICKET_KEY_MATCH"


def aggregate_missing_keys(rows):
    grouped = {}
    for row in rows:
        key = row.get("sourceTicketKey")
        if not key:
            continue
        g = grouped.setdefault(key, {
            "sourceTicketKey": key,
            "localCaseCount": 0,
            "localCaseIds": [],
            "sourceTables": [],
            "firstDate": None,
            "lastDate": None,
            "quarters": [],
            "engineers": [],
            "sampleGroupChatNames": [],
        })
        g["localCaseCount"] += 1
        g["localCaseIds"].append(row.get("caseId"))
        if row.get("sourceTable") and row.get("sourceTable") not in g["sourceTables"]:
            g["sourceTables"].append(row.get("sourceTable"))
        d = row.get("caseDate")
        if d:
            g["firstDate"] = d if g["firstDate"] is None or d < g["firstDate"] else g["firstDate"]
            g["lastDate"] = d if g["lastDate"] is None or d > g["lastDate"] else g["lastDate"]
        q = row.get("quarter")
        if q and q not in g["quarters"]:
            g["quarters"].append(q)
        for person in row.get("effectiveLocalPersons") or []:
            if person not in g["engineers"]:
                g["engineers"].append(person)
        name = row.get("groupChatName") or ""
        if name and name not in g["sampleGroupChatNames"] and len(g["sampleGroupChatNames"]) < 3:
            g["sampleGroupChatNames"].append(name)
    return [grouped[k] for k in sorted(grouped)]


def reconcile(inventory, cases_doc, configured_people=None):
    errors, normalized_tickets, unkeyed_count = validate_inventory(inventory)
    if errors:
        raise ValueError("inventory gate failed: " + "; ".join(errors))

    raw_cases, embedded_people = read_cases_document(cases_doc)
    export_warnings = validate_bigcircle_metadata(cases_doc, raw_cases)
    if configured_people is None:
        configured_people = embedded_people
    people = sorted(set(listify(configured_people))) if configured_people else []

    ones_by_key = defaultdict(list)
    for key, ticket in normalized_tickets:
        if key:
            ones_by_key[key].append(ticket)
    duplicate_ones_keys = sorted(k for k, rows in ones_by_key.items() if len(rows) > 1)

    normalized_cases = [normalize_case(c, i) for i, c in enumerate(raw_cases)]
    included = []
    excluded_prebaseline = 0
    excluded_people = 0
    for c in normalized_cases:
        d = parse_case_date(c["caseDate"])
        if d is None or d < MIN_DATE:
            excluded_prebaseline += 1
            continue
        if people and not set(c["effectiveLocalPersons"]).intersection(people):
            excluded_people += 1
            continue
        included.append(c)

    results = []
    for c in included:
        row = dict(c)
        resolved_key, status, reason = resolve_local_key(row, ones_by_key)
        row["sourceTicketKey"] = resolved_key
        row["matchedOnesDisplayId"] = None
        row["matchedOnesTaskUuid"] = None
        row["matchedOnesAssignee"] = None
        row["reason"] = reason
        if status == "MATCHED":
            matches = ones_by_key.get(resolved_key, [])
            if len(matches) == 1:
                ticket = matches[0]
                row["matchedOnesDisplayId"] = ticket.get("onesDisplayId")
                row["matchedOnesTaskUuid"] = ticket.get("onesTaskUuid")
                assignee = ticket_assignee(ticket)
                row["matchedOnesAssignee"] = assignee
                if not row.get("effectiveLocalPersons"):
                    row["matchStatus"] = "AMBIGUOUS"
                    row["reason"] = "LOCAL_PERSON_UNRESOLVED"
                elif assignee is None:
                    row["matchStatus"] = "AMBIGUOUS"
                    row["reason"] = "ONES_ASSIGNEE_UNRESOLVED"
                elif person_scope_compatible(row["effectiveLocalPersons"], assignee):
                    row["matchStatus"] = "MATCHED"
                else:
                    row["matchStatus"] = "PERSON_SCOPE_MISMATCH"
                    row["reason"] = "ONES_ASSIGNEE_PERSON_SCOPE_MISMATCH"
            else:
                row["matchStatus"] = "AMBIGUOUS"
                row["reason"] = "EXACT_EMBEDDED_KEY_NOT_UNIQUE"
        elif status == "ONES_MISSING_CASE":
            if unkeyed_count:
                row["matchStatus"] = "AMBIGUOUS"
                row["reason"] = "INVENTORY_CONTAINS_UNKEYED_TICKETS"
            elif not row.get("effectiveLocalPersons"):
                row["matchStatus"] = "AMBIGUOUS"
                row["reason"] = "LOCAL_PERSON_UNRESOLVED"
            else:
                row["matchStatus"] = "ONES_MISSING_CASE"
        else:
            row["matchStatus"] = "AMBIGUOUS"
        results.append(row)

    quarter_metrics = {}
    for r in results:
        q = r["quarter"]
        m = quarter_metrics.setdefault(q, {
            "confirmedRealCases": 0,
            "matched": 0,
            "onesMissing": 0,
            "personScopeMismatch": 0,
            "ambiguous": 0,
            "rootCauseConfirmed": 0,
            "rootCauseUnconfirmed": 0,
            "extensionJobPending": 0,
            "writeVerified": 0,
            "noopVerified": 0,
            "conflictReview": 0,
            "writeUnverified": 0,
        })
        m["confirmedRealCases"] += 1
        if r["matchStatus"] == "MATCHED":
            m["matched"] += 1
        elif r["matchStatus"] == "ONES_MISSING_CASE":
            m["onesMissing"] += 1
        elif r["matchStatus"] == "PERSON_SCOPE_MISMATCH":
            m["personScopeMismatch"] += 1
        else:
            m["ambiguous"] += 1
        if r["rootCauseConfirmed"] is True:
            m["rootCauseConfirmed"] += 1
        elif r["rootCauseConfirmed"] is False:
            m["rootCauseUnconfirmed"] += 1
        status = r["executionStatus"]
        if status in PENDING_WRITE_STATES:
            m["extensionJobPending"] += 1
        elif status in FINAL_WRITE_STATES:
            m[FINAL_WRITE_STATES[status]] += 1

    missing = [r for r in results if r["matchStatus"] == "ONES_MISSING_CASE"]
    person_scope_mismatches = [r for r in results if r["matchStatus"] == "PERSON_SCOPE_MISMATCH"]
    ambiguous = [r for r in results if r["matchStatus"] == "AMBIGUOUS"]
    matched = [r for r in results if r["matchStatus"] == "MATCHED"]
    missing_keys = aggregate_missing_keys(missing)
    repeated_local_keys = sorted(k for k, n in Counter(r.get("sourceTicketKey") for r in results if r.get("sourceTicketKey")).items() if n > 1)

    return {
        "schemaVersion": SCHEMA_VERSION,
        "implementationVersion": IMPLEMENTATION_VERSION,
        "generatedAt": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "comparisonBaseline": "2026-06-01",
        "people": people,
        "inventory": {
            "status": inventory.get("status"),
            "capturedAt": inventory.get("capturedAt"),
            "relayJobId": inventory.get("relayJobId"),
            "ticketCount": inventory.get("ticketCount"),
            "serverTotalCount": inventory.get("serverTotalCount"),
            "visiblePageTotal": inventory.get("visiblePageTotal"),
            "unkeyedCount": unkeyed_count,
            "duplicateSourceTicketKeys": duplicate_ones_keys,
            "snapshotSha256": canonical_hash(inventory),
        },
        "inputCaseCount": len(raw_cases),
        "exportWarnings": export_warnings,
        "includedCaseCount": len(included),
        "excluded": {
            "preBaselineOrInvalidDate": excluded_prebaseline,
            "outsideConfiguredPeople": excluded_people,
        },
        "totals": {
            "MATCHED": len(matched),
            "ONES_MISSING_CASE": len(missing),
            "PERSON_SCOPE_MISMATCH": len(person_scope_mismatches),
            "AMBIGUOUS": len(ambiguous),
        },
        "uniqueMissingSourceTicketKeyCount": len(missing_keys),
        "repeatedLocalSourceTicketKeys": repeated_local_keys,
        "quarterMetrics": quarter_metrics,
        "missingExternalTicketKeys": missing_keys,
        "missingExternalTickets": missing,
        "personScopeMismatches": person_scope_mismatches,
        "ambiguousCases": ambiguous,
        "matchedCases": matched,
        "results": results,
    }


def main():
    ap = argparse.ArgumentParser(description="Exact sourceTicketKey reconciliation between verified ONES inventory and Big-circle cases")
    ap.add_argument("--inventory", required=True)
    ap.add_argument("--cases", required=True)
    ap.add_argument("--people", help="Comma-separated configured people; overrides cases document people[]")
    ap.add_argument("--output", required=True)
    args = ap.parse_args()
    try:
        inventory = load_json(args.inventory)
        cases_doc = load_json(args.cases)
        report = reconcile(inventory, cases_doc, args.people)
    except Exception as e:
        print(f"RECONCILIATION_BLOCKED: {e}", file=sys.stderr)
        return 2
    Path(args.output).write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({
        "status": "RECONCILIATION_COMPLETE",
        "output": str(Path(args.output)),
        "includedCaseCount": report["includedCaseCount"],
        "totals": report["totals"],
        "quarterMetrics": report["quarterMetrics"],
    }, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
