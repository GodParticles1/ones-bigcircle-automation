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

ENV = load_module("env_consumer_test", REPO / "transport-envelope" / "envelope.py")
SPOOL = load_module("spool_consumer_test", REPO / "transport-spool" / "spool.py")
CON = load_module("consumer_test", ROOT / "consume_result.py")


def write_env(path, payload, kind):
    env = ENV.build_envelope(
        payload,
        direction="WINDOWS_TO_BIGCIRCLE",
        kind=kind,
        producer="windows-agent",
        consumer="bigcircle-control",
        created_at="2026-09-22T00:00:00Z",
    )
    path.write_text(json.dumps(env, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return env


result_payload = {
    "schema":"ones.bigcircle-transport-result/v1alpha1",
    "status":"RECONCILIATION_VERIFIED",
    "caseFeedSha256":"1"*64,
    "inventorySha256":"2"*64,
    "reconciliationRunKey":"run-1",
    "reconciliationOutput":"out/report.json",
}

with tempfile.TemporaryDirectory() as td:
    td = Path(td)
    spool = td / "spool"
    receipts = td / "receipts"
    src = td / "result.json"
    env = write_env(src, result_payload, "RESULT")
    SPOOL.put_inbound(spool, "bigcircle-control", src)
    r = CON.consume_one(spool, receipts)
    assert r["status"] == "RECEIPT_STORED"
    assert r["kind"] == "RESULT"
    assert r["claimState"] == "PROCESSED"
    assert (receipts / "result" / f'{env["envelopeId"]}.json').exists()
    SPOOL.put_inbound(spool, "bigcircle-control", src)
    assert CON.consume_one(spool, receipts)["status"] == "EMPTY"

with tempfile.TemporaryDirectory() as td:
    td = Path(td)
    spool = td / "spool"
    receipts = td / "receipts"
    res_src = td / "result.json"
    res_env = write_env(res_src, result_payload, "RESULT")
    SPOOL.put_inbound(spool, "bigcircle-control", res_src)
    CON.consume_one(spool, receipts)

    cp = {
        "schema":"ones.bigcircle-transport-checkpoint/v1alpha1",
        "status":"RECONCILIATION_ACCEPTED",
        "reconciliationStatus":"RECONCILIATION_VERIFIED",
        "caseFeedSha256":"1"*64,
        "inventorySha256":"2"*64,
        "reconciliationRunKey":"run-1",
        "resultEnvelopeId":res_env["envelopeId"],
    }
    cp_src = td / "cp.json"
    cp_env = write_env(cp_src, cp, "CHECKPOINT")
    SPOOL.put_inbound(spool, "bigcircle-control", cp_src)
    r = CON.consume_one(spool, receipts)
    assert r["status"] == "RECEIPT_STORED"
    assert (receipts / "checkpoint" / f'{cp_env["envelopeId"]}.json').exists()

with tempfile.TemporaryDirectory() as td:
    td = Path(td)
    spool = td / "spool"
    receipts = td / "receipts"
    bad = dict(result_payload)
    bad["status"] = "PERIODIC_ALIGNMENT_WAIT_ONES"
    src = td / "bad.json"
    env = write_env(src, bad, "RESULT")
    SPOOL.put_inbound(spool, "bigcircle-control", src)
    try:
        CON.consume_one(spool, receipts)
        raise AssertionError("expected block")
    except CON.ConsumerError as exc:
        assert str(exc) == "RESULT_STATUS_INVALID"
    assert (spool / "rejected" / f'{env["envelopeId"]}.json').exists()

with tempfile.TemporaryDirectory() as td:
    td = Path(td)
    spool = td / "spool"
    receipts = td / "receipts"
    res_src = td / "result.json"
    res_env = write_env(res_src, result_payload, "RESULT")
    SPOOL.put_inbound(spool, "bigcircle-control", res_src)
    CON.consume_one(spool, receipts)

    cp = {
        "schema":"ones.bigcircle-transport-checkpoint/v1alpha1",
        "status":"RECONCILIATION_ACCEPTED",
        "reconciliationStatus":"RECONCILIATION_VERIFIED",
        "caseFeedSha256":"9"*64,
        "inventorySha256":"2"*64,
        "reconciliationRunKey":"run-1",
        "resultEnvelopeId":res_env["envelopeId"],
    }
    cp_src = td / "cp-bad.json"
    cp_env = write_env(cp_src, cp, "CHECKPOINT")
    SPOOL.put_inbound(spool, "bigcircle-control", cp_src)
    try:
        CON.consume_one(spool, receipts)
        raise AssertionError("expected mismatch")
    except CON.ConsumerError as exc:
        assert str(exc) == "CHECKPOINT_RESULT_CASEFEED_MISMATCH"
    assert (spool / "rejected" / f'{cp_env["envelopeId"]}.json').exists()

print("BIGCIRCLE_RESULT_CONSUMER_V1_TEST_PASS")
