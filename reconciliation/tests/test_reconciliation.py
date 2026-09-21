import sys
from pathlib import Path
ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from reconcile import reconcile, normalize_source_key, extract_source_key


def inv(tickets, **overrides):
    n = len(tickets)
    base = {
        "status": "INVENTORY_VERIFIED",
        "inventoryComplete": True,
        "reconciliationAllowed": True,
        "ticketCount": n,
        "serverTotalCount": n,
        "visiblePageTotal": n,
        "unkeyedCount": sum(1 for t in tickets if not t.get("sourceTicketKey")),
        "tickets": tickets,
    }
    base.update(overrides)
    return base


def main():
    assert normalize_source_key(" 【 src-1001 】 ") == "SRC-1001"
    assert extract_source_key(" [ SRC-1001 ] issue") == "SRC-1001"
    assert extract_source_key("prefix [ABC-1]") is None

    tickets = [
        {"sourceTicketKey": "SRC-1001", "onesDisplayId": "YF-1", "onesTaskUuid": "t1"},
        {"sourceTicketKey": "SRC-2002", "onesDisplayId": "YF-2", "onesTaskUuid": "t2"},
        {"sourceTicketKey": "DUP-1", "onesDisplayId": "YF-3", "onesTaskUuid": "t3"},
        {"sourceTicketKey": "DUP-1", "onesDisplayId": "YF-4", "onesTaskUuid": "t4"},
    ]
    cases = {
        "metadata": {"complete": True, "exportedCaseCount": 9, "missingKeyCount": 0},
        "people": ["Engineer-A"],
        "cases": [
            {"localCaseId": "m1", "sourceTable": "ENG-WEEK-01", "date": "2026-06-30", "groupChatName": "SRC-1001 issue", "sourceTicketKey": "SRC-1001", "handlerPersons": ["Engineer-A"]},
            {"localCaseId": "x1", "date": "2026-07-01", "groupChatName": "NO-1 issue", "sourceTicketKey": "NO-1", "handlerPersons": ["Engineer-A"]},
            {"localCaseId": "num", "date": "2026-07-02", "groupChatName": "160653 INC...", "sourceTicketKey": "160653", "handlerPersons": ["Engineer-A"]},
            {"localCaseId": "inc", "date": "2026-07-03", "groupChatName": "INC202607010001 x", "sourceTicketKey": "INC202607010001", "handlerPersons": ["Engineer-A"]},
            {"localCaseId": "yf", "date": "2026-07-04", "groupChatName": "YF-9004 【ABC-1】", "sourceTicketKey": "YF-9004", "handlerPersons": ["Engineer-A"]},
            {"localCaseId": "trunc", "date": "2026-07-05", "groupChatName": "X-99-000001 support", "sourceTicketKey": "X-99", "handlerPersons": ["Engineer-A"]},
            {"localCaseId": "embedded", "date": "2026-07-06", "groupChatName": "ke host (SRC-2002 kernel)", "sourceTicketKey": None, "handlerPersons": ["Engineer-A"]},
            {"localCaseId": "dup", "date": "2026-07-07", "groupChatName": "DUP-1 issue", "sourceTicketKey": "DUP-1", "handlerPersons": ["Engineer-A"]},
            {"localCaseId": "x2", "date": "2026-07-08", "groupChatName": "NO-1 followup", "sourceTicketKey": "NO-1", "handlerPersons": ["Engineer-A"]},
        ],
    }
    report = reconcile(inv(tickets), cases)
    by_id = {r["caseId"]: r for r in report["results"]}
    assert by_id["m1"]["matchStatus"] == "MATCHED"
    assert by_id["m1"]["sourceTable"] == "ENG-WEEK-01"
    assert by_id["embedded"]["matchStatus"] == "MATCHED"
    assert by_id["embedded"]["sourceTicketKey"] == "SRC-2002"
    assert by_id["embedded"]["reason"] == "EXACT_VERIFIED_INVENTORY_KEY_EMBEDDED"
    assert by_id["num"]["reason"] == "LOCAL_KEY_NOT_EXTERNAL_TICKET_FORMAT"
    assert by_id["inc"]["reason"] == "LOCAL_KEY_NOT_EXTERNAL_TICKET_FORMAT"
    assert by_id["yf"]["reason"] == "LOCAL_KEY_IS_ONES_DISPLAY_ID"
    assert by_id["trunc"]["reason"].startswith("LOCAL_KEY_TRUNCATED_FROM_GROUP_PREFIX:X-99-000001")
    assert by_id["dup"]["reason"] == "DUPLICATE_ONES_SOURCE_TICKET_KEY"
    assert report["uniqueMissingSourceTicketKeyCount"] == 1
    assert report["missingExternalTicketKeys"][0]["sourceTicketKey"] == "NO-1"
    assert report["missingExternalTicketKeys"][0]["localCaseCount"] == 2
    assert report["missingExternalTicketKeys"][0]["localCaseIds"] == ["x1", "x2"]
    assert report["exportWarnings"][0]["code"] == "BIGCIRCLE_METADATA_MISSING_KEY_COUNT_MISMATCH"

    bad = inv(tickets, visiblePageTotal=99)
    try:
        reconcile(bad, cases)
    except ValueError as e:
        assert "inventory gate failed" in str(e)
    else:
        raise AssertionError("count mismatch must block reconciliation")

    unkeyed_tickets = [{"sourceTicketKey": None, "title": "no bracket", "onesDisplayId": "YF-X"}]
    rep2 = reconcile(inv(unkeyed_tickets), {"cases": [{"localCaseId": "n1", "date": "2026-07-01", "groupChatName": "NO-2", "sourceTicketKey": "NO-2", "handlerPersons": ["Engineer-A"]}]})
    assert rep2["totals"]["ONES_MISSING_CASE"] == 0
    assert rep2["results"][0]["reason"] == "INVENTORY_CONTAINS_UNKEYED_TICKETS"

    print("RECONCILIATION_V011_TEST_PASS")


if __name__ == "__main__":
    main()
