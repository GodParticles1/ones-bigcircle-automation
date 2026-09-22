# Root-cause planner runtime v0.1.0

Execution-free Windows runtime package for Issue #20 / root-cause planning acceptance.

Inputs:
- exact CASE_FEED_V1 JSON;
- reconciliation v0.2.1 latest report bound to that exact CASE_FEED raw SHA;
- verified `ones.root-cause-field-read/v1alpha1` snapshot;
- runtime field UUID.

It regenerates deterministic root-cause extraction and emits only planner decisions:
- SET_CANDIDATE
- NOOP
- CONFLICT_REVIEW
- BLOCK

It does not call Browser Bridge or Relay and cannot write to ONES.

Example:
```powershell
.\run-planner.ps1 `
  -Cases "D:\tools\case-feed-accepted-252.json" `
  -Reconciliation "D:\tools\periodic-alignment-runtime\reconciliation-output\reconciliation-latest.json" `
  -FieldReads "D:\tools\periodic-alignment-runtime\field-read\issue20-YF-12439-HwyyVZy8-v044.json" `
  -FieldId "HwyyVZy8"
```
