import importlib.util
import json
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
REPO = ROOT.parent

def load_module(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod

RUN = load_module("run_once_test", ROOT / "run_once.py")
ENV = load_module("env_run_test", REPO / "transport-envelope" / "envelope.py")
SPOOL = load_module("spool_run_test", REPO / "transport-spool" / "spool.py")


def expect_block(fn, prefix):
    try:
        fn()
        raise AssertionError(f"expected block {prefix}")
    except RUN.AgentRunError as exc:
        assert str(exc).startswith(prefix), str(exc)


verified = {
    "status": "RECONCILIATION_VERIFIED",
    "caseFeedSha256": "1" * 64,
    "inventorySha256": "2" * 64,
    "reconciliationRunKey": "run-key-1",
    "reconciliationOutput": "out/report.json",
}
noop = dict(verified)
noop["status"] = "RECONCILIATION_NOOP_VERIFIED"
noop["reconciliationRunKey"] = "run-key-2"

assert RUN.validate_downstream_result(verified)["status"] == "RECONCILIATION_VERIFIED"
assert RUN.validate_downstream_result(noop)["status"] == "RECONCILIATION_NOOP_VERIFIED"

expect_block(
    lambda: RUN.validate_downstream_result({"status": "PERIODIC_ALIGNMENT_WAIT_ONES"}),
    "DOWNSTREAM_NOT_VERIFIED",
)
expect_block(
    lambda: RUN.validate_downstream_result({
        "status":"RECONCILIATION_VERIFIED",
        "caseFeedSha256":"1"*64,
        "inventorySha256":"2"*64,
        "reconciliationRunKey":"run-key",
    }),
    "DOWNSTREAM_FIELD_MISSING:reconciliationOutput",
)

mixed = "noise\n" + json.dumps(verified) + "\n"
assert RUN.last_json_line(mixed)["reconciliationRunKey"] == "run-key-1"
expect_block(lambda: RUN.last_json_line("noise only\n"), "DOWNSTREAM_OUTPUT_INVALID")

result_env = RUN.build_result_envelope(verified)
result_payload = ENV.decode_and_validate(result_env)
assert result_env["kind"] == "RESULT"
assert result_payload["status"] == "RECONCILIATION_VERIFIED"
assert result_payload["caseFeedSha256"] == "1"*64

checkpoint_env = RUN.build_checkpoint_envelope(
    verified,
    result_env["envelopeId"],
    {"status":"MATERIALIZED","sourceEnvelopeId":"env-source"},
)
checkpoint_payload = ENV.decode_and_validate(checkpoint_env)
assert checkpoint_env["kind"] == "CHECKPOINT"
assert checkpoint_payload["sourceEnvelopeId"] == "env-source"
assert checkpoint_payload["resultEnvelopeId"] == result_env["envelopeId"]

with tempfile.TemporaryDirectory() as td:
    spool = Path(td) / "spool"
    r = RUN.emit_envelope(spool, result_env)
    assert r["status"] == "OUTBOUND_STORED"
    r2 = RUN.emit_envelope(spool, result_env)
    assert r2["status"] == "OUTBOUND_NOOP"
    stored = Path(r["path"])
    assert stored.exists()
    stored_doc = json.loads(stored.read_text(encoding="utf-8"))
    assert ENV.decode_and_validate(stored_doc)["reconciliationRunKey"] == "run-key-1"

print("WINDOWS_AGENT_RUN_ONCE_V1_TEST_PASS")
