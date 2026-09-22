import base64
import copy
import importlib.util
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location("transport_envelope", ROOT / "envelope.py")
MOD = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MOD)


def expect_block(fn, expected):
    try:
        fn()
        raise AssertionError(f"expected {expected}")
    except MOD.EnvelopeError as exc:
        assert str(exc) == expected, (str(exc), expected)


raw_case_feed = b'{\n  "schema": "bigcircle.confirmed-case-export/v1alpha1",\n  "complete": true,\n  "exportedCaseCount": 1,\n  "cases": [{"localCaseId":"CASE-SYNTH-001","sourceTicketKey":"ABC1-001","caseStatus":"CONFIRMED_REAL_CASE","remarks":"Synthetic root cause evidence"}]\n}\n'

case_feed = {
    "schema": "bigcircle.confirmed-case-export/v1alpha1",
    "complete": True,
    "exportedCaseCount": 1,
    "cases": [{
        "localCaseId": "CASE-SYNTH-001",
        "sourceTicketKey": "ABC1-001",
        "caseStatus": "CONFIRMED_REAL_CASE",
        "remarks": "Synthetic root cause evidence",
    }],
}

env1 = MOD.build_envelope(
    case_feed,
    direction="BIGCIRCLE_TO_WINDOWS",
    kind="CASE_FEED",
    producer="bigcircle-control",
    consumer="windows-agent",
    created_at="2026-09-22T00:00:00Z",
)
env2 = MOD.build_envelope(
    copy.deepcopy(case_feed),
    direction="BIGCIRCLE_TO_WINDOWS",
    kind="CASE_FEED",
    producer="bigcircle-control",
    consumer="windows-agent",
    created_at="2026-09-22T01:00:00Z",
)

assert env1["envelopeId"] == env2["envelopeId"]
assert env1["idempotencyKey"] == env2["idempotencyKey"]
assert env1["payloadSha256"] == env2["payloadSha256"]
assert MOD.decode_and_validate(env1) == case_feed

raw_env = MOD.build_envelope_bytes(
    raw_case_feed,
    direction="BIGCIRCLE_TO_WINDOWS",
    kind="CASE_FEED",
    producer="bigcircle-control",
    consumer="windows-agent",
)
assert MOD.decode_payload_bytes(raw_env) == raw_case_feed
assert raw_env["payloadSha256"] == MOD.sha256_hex(raw_case_feed)

result_payload = {
    "status": "RECONCILIATION_VERIFIED",
    "runKey": "synthetic-run-key",
    "totals": {"MATCHED": 1, "ONES_MISSING_CASE": 0},
}
result_env = MOD.build_envelope(
    result_payload,
    direction="WINDOWS_TO_BIGCIRCLE",
    kind="RESULT",
    producer="windows-agent",
    consumer="bigcircle-control",
)
assert MOD.decode_and_validate(result_env) == result_payload

checkpoint_payload = {
    "checkpoint": "synthetic-checkpoint",
    "inputSha256": "0" * 64,
}
checkpoint_env = MOD.build_envelope(
    checkpoint_payload,
    direction="WINDOWS_TO_BIGCIRCLE",
    kind="CHECKPOINT",
    producer="windows-agent",
    consumer="bigcircle-control",
)
assert MOD.decode_and_validate(checkpoint_env) == checkpoint_payload

drift = copy.deepcopy(env1)
raw = base64.b64decode(drift["payloadBase64"])
tampered = raw.replace(b"CASE-SYNTH-001", b"CASE-SYNTH-999")
drift["payloadBase64"] = base64.b64encode(tampered).decode("ascii")
expect_block(lambda: MOD.decode_and_validate(drift), "PAYLOAD_SHA256_MISMATCH")

bad_kind = copy.deepcopy(env1)
bad_kind["kind"] = "WRITE_JOB"
expect_block(lambda: MOD.decode_and_validate(bad_kind), "KIND_UNSUPPORTED")

bad_schema = copy.deepcopy(env1)
bad_schema["schema"] = "ones.bigcircle-transport-envelope/v2"
expect_block(lambda: MOD.decode_and_validate(bad_schema), "SCHEMA_UNSUPPORTED")

bad_direction = copy.deepcopy(env1)
bad_direction["direction"] = "WINDOWS_TO_WINDOWS"
expect_block(lambda: MOD.decode_and_validate(bad_direction), "DIRECTION_UNSUPPORTED")

bad_route = copy.deepcopy(env1)
bad_route["direction"] = "WINDOWS_TO_BIGCIRCLE"
expect_block(lambda: MOD.decode_and_validate(bad_route), "DIRECTION_KIND_MISMATCH")

bad_id = copy.deepcopy(env1)
bad_id["envelopeId"] = "env-bad"
expect_block(lambda: MOD.decode_and_validate(bad_id), "ENVELOPE_ID_MISMATCH")

bad_payload = copy.deepcopy(env1)
bad_payload["payloadBase64"] = base64.b64encode(b"not-json").decode("ascii")
bad_payload["payloadSha256"] = MOD.sha256_hex(b"not-json")
expected_id, expected_idem = MOD.immutable_identity(
    bad_payload["direction"],
    bad_payload["kind"],
    bad_payload["producer"],
    bad_payload["consumer"],
    bad_payload["payloadSha256"],
)
bad_payload["envelopeId"] = expected_id
bad_payload["idempotencyKey"] = expected_idem
expect_block(lambda: MOD.decode_and_validate(bad_payload), "PAYLOAD_JSON_INVALID")

assert "token" not in json.dumps(case_feed).lower()
assert "cookie" not in json.dumps(case_feed).lower()
assert "authorization" not in json.dumps(case_feed).lower()

print("TRANSPORT_ENVELOPE_V1_TEST_PASS")
