"""Local UUID observations from a complete Browser Bridge inventory snapshot."""
import argparse
import json
import sys
from pathlib import Path

from pipeline import atomic_write_json

from reconcile import load_json, validate_inventory


SCHEMA = "ones.readonly-uuid-observation/v1"
SCOPE_FIELDS = ("teamUuid", "projectUuid", "issueTypeUuid", "assigneeDepartmentUuid")


def observe(inventory, assignee, previous=None):
    errors, _, _ = validate_inventory(inventory)
    if errors:
        raise ValueError("inventory gate failed: " + "; ".join(errors))
    if (inventory.get("schemaVersion") != "ones.external-ticket-inventory/v1alpha1"
            or inventory.get("readOnly") is not True or not inventory.get("pages")):
        raise ValueError("expected read-only inventory with native page receipts")
    declared = inventory.get("scope")
    if not isinstance(declared, dict):
        raise ValueError("missing inventory scope")
    scope = {key: declared.get(key) for key in SCOPE_FIELDS}
    scope["assigneeUuid"] = assignee
    if not all(isinstance(value, str) and value.strip() and value.strip() == value for value in scope.values()):
        raise ValueError("incomplete inventory scope")

    current = set()
    for ticket in inventory["tickets"]:
        if "assignee" not in ticket:
            raise ValueError("missing inventory assignee")
        owner = ticket["assignee"]
        if owner is None:
            continue
        owner_id = owner.get("uuid") if isinstance(owner, dict) else None
        if not isinstance(owner_id, str) or not owner_id.strip() or owner_id.strip() != owner_id:
            raise ValueError("unknown inventory assignee")
        if owner_id == assignee:
            current.add(ticket["onesTaskUuid"])
    seen = set()
    baseline = True
    if previous is not None:
        if not isinstance(previous, dict) or previous.get("schemaVersion") != SCHEMA:
            raise ValueError("invalid previous observation")
        prior_scope = previous.get("scope")
        prior_ids = previous.get("seenTaskUuids")
        if (not isinstance(prior_scope, dict) or prior_scope.keys() != scope.keys()
                or not all(isinstance(v, str) and v.strip() for v in prior_scope.values())
                or not isinstance(prior_ids, list)
                or not all(isinstance(v, str) and v.strip() for v in prior_ids)):
            raise ValueError("invalid previous observation scope or UUIDs")
        baseline = prior_scope != scope
        if not baseline:
            seen.update(prior_ids)
    return {
        "schemaVersion": SCHEMA, "scope": scope, "baseline": baseline,
        "inventoryComplete": False, "reconciliationAllowed": False,
        "newTaskUuids": [] if baseline else sorted(current - seen),
        "seenTaskUuids": sorted(current | seen),
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--inventory", required=True)
    parser.add_argument("--assignee", required=True, help="Exact assignee UUID")
    history = parser.add_mutually_exclusive_group()
    history.add_argument("--state-dir", type=Path, help="Periodic runner history directory (caller serializes scans)")
    history.add_argument("--previous", help="Most recent successful observation from this ONES installation")
    args = parser.parse_args()
    try:
        state = args.state_dir / "uuid-observation.json" if args.state_dir else None
        prior = state if state and state.exists() else args.previous
        previous = load_json(prior) if prior else None
        if prior and previous is None:
            raise ValueError("invalid previous observation")
        result = observe(load_json(args.inventory), args.assignee, previous)
        if state:
            atomic_write_json(state, result)
    except (OSError, ValueError, TypeError, AttributeError) as error:
        print(f"Observation blocked: {error}", file=sys.stderr)
        return 2
    print(json.dumps(result, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
