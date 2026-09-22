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

ENV = load_module("env_test", REPO / "transport-envelope" / "envelope.py")
SPOOL = load_module("spool_test", REPO / "transport-spool" / "spool.py")
MAT = load_module("mat_test", ROOT / "materialize_case_feed.py")


def write_envelope(path, payload, kind="CASE_FEED"):
    direction = "BIGCIRCLE_TO_WINDOWS" if kind == "CASE_FEED" else "WINDOWS_TO_BIGCIRCLE"
    producer = "bigcircle-control" if kind == "CASE_FEED" else "windows-agent"
    consumer = "windows-agent" if kind == "CASE_FEED" else "bigcircle-control"
    env = ENV.build_envelope(
        payload,
        direction=direction,
        kind=kind,
        producer=producer,
        consumer=consumer,
        created_at="2026-09-22T00:00:00Z",
    )
    path.write_text(json.dumps(env, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return env


case_feed = {
    "schema": "bigcircle.confirmed-case-export/v1alpha1",
    "complete": True,
    "exportedCaseCount": 1,
    "cases": [{
        "localCaseId": "CASE-SYNTH-001",
        "sourceTicketKey": "ABC1-001",
        "caseStatus": "CONFIRMED_REAL_CASE",
        "remarks": "synthetic",
    }],
}

with tempfile.TemporaryDirectory() as td:
    td = Path(td)
    spool_root = td / "spool"
    case_dir = td / "cases"
    src = td / "inbound.json"
    env = write_envelope(src, case_feed)
    SPOOL.put_inbound(spool_root, "windows-agent", src)

    first = MAT.process_one(spool_root, case_dir)
    assert first["status"] == "MATERIALIZED"
    target = Path(first["caseFeedFile"])
    assert target.exists()
    assert ENV.sha256_hex(target.read_bytes()) == env["payloadSha256"]
    assert first["claimState"] == "PROCESSED"
    assert (spool_root / "processed" / f'{env["envelopeId"]}.json').exists()
    checkpoint_files = list((spool_root / "outbox").glob("env-*.json"))
    assert len(checkpoint_files) == 1
    checkpoint_env = json.loads(checkpoint_files[0].read_text(encoding="utf-8"))
    checkpoint_payload = ENV.decode_and_validate(checkpoint_env)
    assert checkpoint_env["kind"] == "CHECKPOINT"
    assert checkpoint_payload["sourceEnvelopeId"] == env["envelopeId"]
    assert checkpoint_payload["caseFeedSha256"] == env["payloadSha256"]

    assert MAT.process_one(spool_root, case_dir)["status"] == "EMPTY"

    SPOOL.put_inbound(spool_root, "windows-agent", src)
    assert MAT.process_one(spool_root, case_dir)["status"] == "EMPTY"

with tempfile.TemporaryDirectory() as td:
    td = Path(td)
    payload_bytes = b'{\n  "schema": "bigcircle.confirmed-case-export/v1alpha1",\n  "complete": true,\n  "exportedCaseCount": 0,\n  "cases": []\n}\n'
    env = ENV.build_envelope_bytes(
        payload_bytes,
        direction="BIGCIRCLE_TO_WINDOWS",
        kind="CASE_FEED",
        producer="bigcircle-control",
        consumer="windows-agent",
        created_at="2026-09-22T00:00:00Z",
    )
    src = td / "raw.json"
    src.write_text(json.dumps(env, indent=2) + "\n", encoding="utf-8")
    SPOOL.put_inbound(td / "spool", "windows-agent", src)
    result = MAT.process_one(td / "spool", td / "cases")
    target = Path(result["caseFeedFile"])
    assert target.read_bytes() == payload_bytes

with tempfile.TemporaryDirectory() as td:
    td = Path(td)
    bad_feed = {
        "schema": "bigcircle.confirmed-case-export/v1alpha1",
        "complete": False,
        "exportedCaseCount": 0,
        "cases": [],
    }
    src = td / "bad.json"
    env = write_envelope(src, bad_feed)
    SPOOL.put_inbound(td / "spool", "windows-agent", src)
    try:
        MAT.process_one(td / "spool", td / "cases")
        raise AssertionError("expected block")
    except MAT.MaterializerError as exc:
        assert str(exc) == "CASE_FEED_NOT_COMPLETE"
    assert (td / "spool" / "rejected" / f'{env["envelopeId"]}.json').exists()
    assert not list((td / "cases").glob("*.json")) if (td / "cases").exists() else True

print("WINDOWS_CASEFEED_MATERIALIZER_V1_TEST_PASS")
