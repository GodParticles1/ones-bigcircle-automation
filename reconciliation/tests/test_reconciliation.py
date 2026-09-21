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


def ticket(key, display_id, task_uuid, assignee):
    return {
        "sourceTicketKey": key,
        "onesDisplayId": display_id,
        "onesTaskUuid": task_uuid,
        "assignee": {"uuid": "user-" + assignee.lower(), "name": assignee},
    }


def main():
    assert normalize_source_key(" 【 src-1001 】 ") == "SRC-1001"
    assert extract_source_key(" [ SRC-1001 ] issue") == "SRC-1001"
    assert extract_source_key("prefix [ABC-1]") is None

    tickets = [
        ticket("SRC-1001", "YF-1", "t1", "Engineer-A"),
        ticket("SRC-2002", "YF-2", "t2", "Engineer-A"),
        ticket("DUTY-1", "YF-3", "t3", "Engineer-A"),
        ticket("DIFF-1", "YF-4", "t4", "Engineer-B"),
        ticket("OTHER-1", "YF-5", "t5", "Engineer-B"),
        ticket("DUP-1", "YF-6", "t6", "Engineer-A"),
        ticket("DUP-1", "YF-7", "t7", "Engineer-A"),
    ]

    cases = {
        "metadata": {"complete": True, "exportedCaseCount": 12, "missingKeyCount": 1},
        "people": ["Engineer-A"],
        "cases": [
            {
                "localCaseId": "handler-primary",
                "sourceTable": "ENG-WEEK-01",
                "date": "2026-06-30",
                "groupChatName": "SRC-1001 issue",
                "sourceTicketKey": "SRC-1001",
                "dutyPersons": ["Engineer-B"],
                "handlerPersons": ["Engineer-A"],
            },
            {
                "localCaseId": "duty-fallback",
                "date": "2026-07-01",
                "groupChatName": "DUTY-1 issue",
                "sourceTicketKey": "DUTY-1",
                "dutyPersons": ["Engineer-A"],
            },
            {
                "localCaseId": "person-mismatch",
                "date": "2026-07-02",
                "groupChatName": "DIFF-1 issue",
                "sourceTicketKey": "DIFF-1",
                "handlerPersons": ["Engineer-A"],
            },
            {
                "localCaseId": "missing-1",
                "date": "2026-07-03",
                "groupChatName": "NO-1 issue",
                "sourceTicketKey": "NO-1",
                "handlerPersons": ["Engineer-A"],
            },
            {
                "localCaseId": "missing-2",
                "date": "2026-07-04",
                "groupChatName": "NO-1 followup",
                "sourceTicketKey": "NO-1",
                "handlerPersons": ["Engineer-A"],
            },
            {
                "localCaseId": "num",
                "date": "2026-07-05",
                "groupChatName": "160653 INC...",
                "sourceTicketKey": "160653",
                "handlerPersons": ["Engineer-A"],
            },
            {
                "localCaseId": "inc",
                "date": "2026-07-06",
                "groupChatName": "INC202607010001 x",
                "sourceTicketKey": "INC202607010001",
                "handlerPersons": ["Engineer-A"],
            },
            {
                "localCaseId": "yf",
                "date": "2026-07-07",
                "groupChatName": "YF-9004 【ABC-1】",
                "sourceTicketKey": "YF-9004",
                "handlerPersons": ["Engineer-A"],
            },
            {
                "localCaseId": "trunc",
                "date": "2026-07-08",
                "groupChatName": "X-99-000001 support",
                "sourceTicketKey": "X-99",
                "handlerPersons": ["Engineer-A"],
            },
            {
                "localCaseId": "embedded",
                "date": "2026-07-09",
                "groupChatName": "ke host (SRC-2002 kernel)",
                "sourceTicketKey": None,
                "handlerPersons": ["Engineer-A"],
            },
            {
                "localCaseId": "dup",
                "date": "2026-07-10",
                "groupChatName": "DUP-1 issue",
                "sourceTicketKey": "DUP-1",
                "handlerPersons": ["Engineer-A"],
            },
            {
                "localCaseId": "outside-person",
                "date": "2026-07-11",
                "groupChatName": "OTHER-1 issue",
                "sourceTicketKey": "OTHER-1",
                "handlerPersons": ["Engineer-B"],
            },
        ],
    }

    report = reconcile(inv(tickets), cases)
    by_id = {r["caseId"]: r for r in report["results"]}

    hp = by_id["handler-primary"]
    assert hp["matchStatus"] == "MATCHED"
    assert hp["effectiveLocalPersons"] == ["Engineer-A"]
    assert hp["attributionSource"] == "HANDLER_PRIMARY"
    assert hp["matchedOnesAssignee"]["name"] == "Engineer-A"
    assert "Engineer-B" in hp["dutyPersons"]

    df = by_id["duty-fallback"]
    assert df["matchStatus"] == "MATCHED"
    assert df["effectiveLocalPersons"] == ["Engineer-A"]
    assert df["attributionSource"] == "DUTY_FALLBACK"

    mm = by_id["person-mismatch"]
    assert mm["matchStatus"] == "PERSON_SCOPE_MISMATCH"
    assert mm["matchedOnesAssignee"]["name"] == "Engineer-B"
    assert mm["reason"] == "ONES_ASSIGNEE_PERSON_SCOPE_MISMATCH"

    assert by_id["embedded"]["matchStatus"] == "MATCHED"
    assert by_id["embedded"]["sourceTicketKey"] == "SRC-2002"
    assert by_id["embedded"]["reason"] == "EXACT_VERIFIED_INVENTORY_KEY_EMBEDDED"

    assert by_id["num"]["reason"] == "LOCAL_KEY_NOT_EXTERNAL_TICKET_FORMAT"
    assert by_id["inc"]["reason"] == "LOCAL_KEY_NOT_EXTERNAL_TICKET_FORMAT"
    assert by_id["yf"]["reason"] == "LOCAL_KEY_IS_ONES_DISPLAY_ID"
    assert by_id["trunc"]["reason"].startswith("LOCAL_KEY_TRUNCATED_FROM_GROUP_PREFIX:X-99-000001")
    assert by_id["dup"]["reason"] == "DUPLICATE_ONES_SOURCE_TICKET_KEY"

    assert "outside-person" not in by_id
    assert report["excluded"]["outsideConfiguredPeople"] == 1
    assert report["totals"]["PERSON_SCOPE_MISMATCH"] == 1
    assert report["uniqueMissingSourceTicketKeyCount"] == 1
    assert report["missingExternalTicketKeys"][0]["sourceTicketKey"] == "NO-1"
    assert report["missingExternalTicketKeys"][0]["localCaseCount"] == 2
    assert report["missingExternalTicketKeys"][0]["localCaseIds"] == ["missing-1", "missing-2"]
    assert report["missingExternalTicketKeys"][0]["engineers"] == ["Engineer-A"]

    no_person = reconcile(
        inv([ticket("SRC-1001", "YF-1", "t1", "Engineer-A")]),
        {
            "cases": [
                {
                    "localCaseId": "no-person",
                    "date": "2026-07-12",
                    "groupChatName": "SRC-1001 issue",
                    "sourceTicketKey": "SRC-1001",
                }
            ]
        },
    )
    assert no_person["results"][0]["matchStatus"] == "AMBIGUOUS"
    assert no_person["results"][0]["attributionSource"] == "PERSON_UNRESOLVED"
    assert no_person["results"][0]["reason"] == "LOCAL_PERSON_UNRESOLVED"

    bad = inv(tickets, visiblePageTotal=99)
    try:
        reconcile(bad, cases)
    except ValueError as e:
        assert "inventory gate failed" in str(e)
    else:
        raise AssertionError("count mismatch must block reconciliation")

    unkeyed_tickets = [
        {
            "sourceTicketKey": None,
            "title": "no bracket",
            "onesDisplayId": "YF-X",
            "assignee": {"uuid": "user-a", "name": "Engineer-A"},
        }
    ]
    rep2 = reconcile(
        inv(unkeyed_tickets),
        {
            "cases": [
                {
                    "localCaseId": "n1",
                    "date": "2026-07-01",
                    "groupChatName": "NO-2",
                    "sourceTicketKey": "NO-2",
                    "handlerPersons": ["Engineer-A"],
                }
            ]
        },
    )
    assert rep2["totals"]["ONES_MISSING_CASE"] == 0
    assert rep2["results"][0]["reason"] == "INVENTORY_CONTAINS_UNKEYED_TICKETS"

    print("RECONCILIATION_V021_TEST_PASS")


if __name__ == "__main__":
    main()
