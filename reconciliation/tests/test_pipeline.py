import json
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from pipeline import run_pipeline


def inv():
    return {
        "capturedAt": "2026-09-20T08:36:42.179Z",
        "status": "INVENTORY_VERIFIED",
        "inventoryComplete": True,
        "reconciliationAllowed": True,
        "ticketCount": 1,
        "serverTotalCount": 1,
        "visiblePageTotal": 1,
        "unkeyedCount": 0,
        "tickets": [
            {"sourceTicketKey": "ABC-1", "onesDisplayId": "YF-1", "onesTaskUuid": "t1"}
        ],
    }


def cases():
    return {
        "metadata": {
            "complete": True,
            "exportedCaseCount": 2,
            "sourceTables": ["ENG260914-260920"],
            "sourceTableCount": 1,
            "missingKeyCount": 0,
        },
        "cases": [
            {
                "localCaseId": "c1",
                "sourceTable": "ENG260914-260920",
                "date": "2026-09-18",
                "groupChatName": "ABC-1 test",
                "sourceTicketKey": "ABC-1",
                "handlerPersons": ["Engineer-A"],
            },
            {
                "localCaseId": "c2",
                "sourceTable": "ENG260914-260920",
                "date": "2026-09-19",
                "groupChatName": "MISS-2 test",
                "sourceTicketKey": "MISS-2",
                "handlerPersons": ["Engineer-A"],
            },
        ],
    }


def write_json(path, value):
    Path(path).write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def main():
    with tempfile.TemporaryDirectory() as td:
        root = Path(td)
        inv_path = root / "inventory.json"
        cases_path = root / "cases.json"
        state_dir = root / "state"
        out_dir = root / "out"
        write_json(inv_path, inv())
        write_json(cases_path, cases())

        first = run_pipeline(cases_path, inv_path, state_dir, out_dir)
        assert first["status"] == "RECONCILIATION_VERIFIED"
        assert first["totals"] == {"MATCHED": 1, "ONES_MISSING_CASE": 1, "AMBIGUOUS": 0}
        assert first["uniqueMissingSourceTicketKeyCount"] == 1
        checkpoint_before = (state_dir / "reconciliation-checkpoint.json").read_bytes()
        latest_before = (out_dir / "reconciliation-latest.json").read_bytes()

        second = run_pipeline(cases_path, inv_path, state_dir, out_dir)
        assert second["status"] == "RECONCILIATION_NOOP_VERIFIED"
        assert (state_dir / "reconciliation-checkpoint.json").read_bytes() == checkpoint_before
        assert (out_dir / "reconciliation-latest.json").read_bytes() == latest_before

        bad = inv()
        bad["visiblePageTotal"] = 9
        write_json(inv_path, bad)
        try:
            run_pipeline(cases_path, inv_path, state_dir, out_dir)
        except ValueError as e:
            assert "inventory gate failed" in str(e)
        else:
            raise AssertionError("bad inventory must block pipeline")
        assert (state_dir / "reconciliation-checkpoint.json").read_bytes() == checkpoint_before
        assert (out_dir / "reconciliation-latest.json").read_bytes() == latest_before

    print("RECONCILIATION_PIPELINE_V020_TEST_PASS")


if __name__ == "__main__":
    main()
