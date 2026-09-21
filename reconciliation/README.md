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
