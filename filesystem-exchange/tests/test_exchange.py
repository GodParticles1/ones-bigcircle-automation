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


ENV = load_module("env_exchange_test", REPO / "transport-envelope" / "envelope.py")
SPOOL = load_module("spool_exchange_test", REPO / "transport-spool" / "spool.py")
EX = load_module("exchange_test", ROOT / "exchange.py")


def write_envelope(path, payload, direction, kind, producer, consumer):
    env = ENV.build_envelope(
        payload,
        direction=direction,
        kind=kind,
        producer=producer,
        consumer=consumer,
        created_at="2026-09-22T00:00:00Z",
    )
    path.write_text(json.dumps(env, ensure_ascii=False, indent=3) + "\n", encoding="utf-8")
    return env


with tempfile.TemporaryDirectory() as td:
    td = Path(td)
    exchange = td / "exchange"
    big_spool = td / "big"
    win_spool = td / "win"

    src = td / "case.json"
    case_env = write_envelope(
        src,
        {"schema":"bigcircle.confirmed-case-export/v1alpha1","complete":True,"exportedCaseCount":0,"cases":[]},
        "BIGCIRCLE_TO_WINDOWS",
        "CASE_FEED",
        "bigcircle-control",
        "windows-agent",
    )
    SPOOL.emit_outbound(big_spool, "bigcircle-control", src)
    out_path = big_spool / "outbox" / f'{case_env["envelopeId"]}.json'
    original_bytes = out_path.read_bytes()

    exported = EX.export_one(big_spool, exchange, "bigcircle-control", cleanup=False)
    assert exported["status"] == "EXPORTED"
    exchange_path = Path(exported["exchange"])
    assert exchange_path.read_bytes() == original_bytes

    exported2 = EX.export_one(big_spool, exchange, "bigcircle-control", cleanup=False)
    assert exported2["status"] == "EXPORT_NOOP"

    imported = EX.import_one(exchange, win_spool, "windows-agent", cleanup=False)
    assert imported["status"] == "IMPORTED"
    inbox_path = Path(imported["spool"])
    assert inbox_path.read_bytes() == original_bytes
    assert SPOOL.load_envelope(inbox_path)["envelopeId"] == case_env["envelopeId"]

    imported2 = EX.import_one(exchange, win_spool, "windows-agent", cleanup=False)
    assert imported2["status"] == "IMPORT_NOOP"

with tempfile.TemporaryDirectory() as td:
    td = Path(td)
    exchange = td / "exchange"
    win_spool = td / "win"
    big_spool = td / "big"

    for idx, kind in enumerate(("RESULT", "CHECKPOINT")):
        src = td / f"out-{idx}.json"
        payload = (
            {
                "schema":"ones.bigcircle-transport-result/v1alpha1",
                "status":"RECONCILIATION_VERIFIED",
                "caseFeedSha256":"1"*64,
                "inventorySha256":"2"*64,
                "reconciliationRunKey":f"run-{idx}",
                "reconciliationOutput":"out/report.json",
            }
            if kind == "RESULT"
            else {
                "schema":"ones.bigcircle-transport-checkpoint/v1alpha1",
                "status":"RECONCILIATION_ACCEPTED",
                "reconciliationStatus":"RECONCILIATION_VERIFIED",
                "caseFeedSha256":"1"*64,
                "inventorySha256":"2"*64,
                "reconciliationRunKey":f"run-{idx}",
                "resultEnvelopeId":"env-synthetic",
            }
        )
        env = write_envelope(
            src,
            payload,
            "WINDOWS_TO_BIGCIRCLE",
            kind,
            "windows-agent",
            "bigcircle-control",
        )
        SPOOL.emit_outbound(win_spool, "windows-agent", src)

    first = EX.export_one(win_spool, exchange, "windows-agent", cleanup=True)
    assert first["status"] == "EXPORTED"
    assert first["sourceRemoved"] is True
    assert not Path(first["source"]).exists()

    first_in = EX.import_one(exchange, big_spool, "bigcircle-control", cleanup=True)
    assert first_in["status"] == "IMPORTED"
    assert first_in["exchangeRemoved"] is True
    assert not Path(first_in["exchange"]).exists()

with tempfile.TemporaryDirectory() as td:
    td = Path(td)
    exchange = td / "exchange"
    win_spool = td / "win"
    wrong_dir = exchange / "BIGCIRCLE_TO_WINDOWS"
    wrong_dir.mkdir(parents=True)
    src = wrong_dir / "env-wrong.json"
    env = ENV.build_envelope(
        {"schema":"ones.bigcircle-transport-result/v1alpha1","status":"RECONCILIATION_VERIFIED"},
        direction="WINDOWS_TO_BIGCIRCLE",
        kind="RESULT",
        producer="windows-agent",
        consumer="bigcircle-control",
        created_at="2026-09-22T00:00:00Z",
    )
    src.write_text(json.dumps(env) + "\n", encoding="utf-8")
    assert EX.import_one(exchange, win_spool, "windows-agent")["status"] == "EMPTY"

print("FILESYSTEM_EXCHANGE_V1_TEST_PASS")
