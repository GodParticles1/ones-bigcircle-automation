import importlib.util
import json
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location("transport_spool", ROOT / "spool.py")
MOD = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MOD)

ENV_SPEC = importlib.util.spec_from_file_location(
    "transport_envelope", ROOT.parent / "transport-envelope" / "envelope.py"
)
ENV = importlib.util.module_from_spec(ENV_SPEC)
ENV_SPEC.loader.exec_module(ENV)


def write_env(path, payload, direction, kind, producer, consumer):
    doc = ENV.build_envelope(
        payload,
        direction=direction,
        kind=kind,
        producer=producer,
        consumer=consumer,
        created_at="2026-09-22T00:00:00Z",
    )
    path.write_text(json.dumps(doc, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return doc


def expect_block(fn, expected):
    try:
        fn()
        raise AssertionError(f"expected {expected}")
    except MOD.SpoolError as exc:
        assert str(exc) == expected, (str(exc), expected)


with tempfile.TemporaryDirectory() as td:
    root = Path(td) / "spool"
    src = Path(td) / "case-feed-envelope.json"
    env = write_env(
        src,
        {"schema":"bigcircle.confirmed-case-export/v1alpha1","complete":True,"exportedCaseCount":0,"cases":[]},
        "BIGCIRCLE_TO_WINDOWS",
        "CASE_FEED",
        "bigcircle-control",
        "windows-agent",
    )

    first = MOD.put_inbound(root, "windows-agent", src)
    assert first["status"] == "INBOUND_STORED"
    second = MOD.put_inbound(root, "windows-agent", src)
    assert second["status"] == "INBOUND_NOOP"
    assert second["state"] == "INBOX"

    claim = MOD.claim_next(root, "windows-agent")
    assert claim["status"] == "CLAIMED"
    assert claim["envelopeId"] == env["envelopeId"]
    noop_claimed = MOD.put_inbound(root, "windows-agent", src)
    assert noop_claimed["status"] == "INBOUND_NOOP"
    assert noop_claimed["state"] == "CLAIMED"

    done = MOD.complete_claim(root, env["envelopeId"], True)
    assert done["status"] == "PROCESSED"
    assert (root / "processed" / f'{env["envelopeId"]}.json').exists()
    noop_processed = MOD.put_inbound(root, "windows-agent", src)
    assert noop_processed["state"] == "PROCESSED"

    assert MOD.claim_next(root, "windows-agent")["status"] == "EMPTY"

with tempfile.TemporaryDirectory() as td:
    root = Path(td) / "spool"
    src = Path(td) / "result-envelope.json"
    env = write_env(
        src,
        {"status":"RECONCILIATION_VERIFIED","runKey":"synthetic"},
        "WINDOWS_TO_BIGCIRCLE",
        "RESULT",
        "windows-agent",
        "bigcircle-control",
    )
    out = MOD.emit_outbound(root, "windows-agent", src)
    assert out["status"] == "OUTBOUND_STORED"
    out2 = MOD.emit_outbound(root, "windows-agent", src)
    assert out2["status"] == "OUTBOUND_NOOP"
    assert (root / "outbox" / f'{env["envelopeId"]}.json').exists()

with tempfile.TemporaryDirectory() as td:
    root = Path(td) / "spool"
    src = Path(td) / "wrong.json"
    write_env(
        src,
        {"status":"RECONCILIATION_VERIFIED"},
        "WINDOWS_TO_BIGCIRCLE",
        "RESULT",
        "windows-agent",
        "bigcircle-control",
    )
    expect_block(lambda: MOD.put_inbound(root, "windows-agent", src), "ROLE_DIRECTION_MISMATCH")

with tempfile.TemporaryDirectory() as td:
    root = Path(td) / "spool"
    dirs = MOD.ensure_dirs(root)
    bad = dirs["inbox"] / "env-bad.json"
    bad.write_text("{not-json", encoding="utf-8")
    result = MOD.claim_next(root, "windows-agent")
    assert result["status"] == "EMPTY"
    assert (dirs["rejected"] / "env-bad.json").exists()

print("TRANSPORT_SPOOL_V1_TEST_PASS")
