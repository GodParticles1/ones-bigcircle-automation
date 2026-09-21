# Test Matrix

| Lane | Test | Expected |
| --- | --- | --- |
| reconciliation | `python reconciliation/tests/test_reconciliation.py` | `RECONCILIATION_V011_TEST_PASS` |
| reconciliation pipeline | `python reconciliation/tests/test_pipeline.py` | `RECONCILIATION_PIPELINE_V020_TEST_PASS` |
| local relay | `python local-relay/tests/test_relay.py` | relay integration PASS |
| browser bridge | `node --check browser-bridge/service-worker.js && node --check browser-bridge/popup.js && python browser-bridge/tests/static_test.py` | PASS |
| public safety | `python scripts/repo_guard.py .` | PASS |
| Python syntax | `python -m compileall reconciliation local-relay` | PASS |
