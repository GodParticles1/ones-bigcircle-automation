# Reconciliation pipeline

Read-only exact-key matcher and checkpointed pipeline.

Run tests:

```powershell
python .\tests\test_reconciliation.py
python .\tests\test_pipeline.py
```

Run stage:

```powershell
.\run-stage.ps1 -Inventory .\inventory.json -Cases .\cases.json
```

Optional people filter uses configuration values such as:

```powershell
-People "Engineer-A,Engineer-B"
```

No production names or case exports belong in this repository.

## Scoped read-only observations

From the reconciliation directory, run the following against a saved Browser Bridge inventory with complete page receipts. The command filters by exact assignee UUID and prints JSON locally.

```powershell
python observe_inventory.py --inventory first.json --assignee user-a
python observe_inventory.py --inventory next.json --assignee user-a --previous first-observation.json
```

Save a successful observation to its own file to use as the next `--previous` input. Keep one chronological history per ONES installation. The first observation establishes a baseline. A change of team, project, issue type, department or assignee establishes another baseline with zero new items. Within the same scope each task UUID appears in `newTaskUuids` once. Failed reads emit no observation. The output contains local UUID history and is ineligible for full reconciliation.

For full reconciliation, older verified snapshots without pagination metadata retain the count-based contract. A snapshot declaring pagination must provide contiguous page receipts and unique task UUIDs. A native cursor capture also needs successful HTTP evidence for each page. The periodic runner verifies its pending file before publishing the inventory archive.
