#!/usr/bin/env python3
import argparse
import base64
import hashlib
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

SCHEMA = "ones.bigcircle-transport-envelope/v1alpha1"
SUPPORTED_KINDS = {"CASE_FEED", "RESULT", "CHECKPOINT"}
SUPPORTED_DIRECTIONS = {"BIGCIRCLE_TO_WINDOWS", "WINDOWS_TO_BIGCIRCLE"}
KIND_DIRECTIONS = {
    "CASE_FEED": "BIGCIRCLE_TO_WINDOWS",
    "RESULT": "WINDOWS_TO_BIGCIRCLE",
    "CHECKPOINT": "WINDOWS_TO_BIGCIRCLE",
}


class EnvelopeError(ValueError):
    pass


def canonical_json_bytes(value):
    return json.dumps(
        value,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    ).encode("utf-8")


def sha256_hex(data):
    return hashlib.sha256(data).hexdigest()


def normalize_text(name, value, max_len=128):
    if not isinstance(value, str):
        raise EnvelopeError(f"{name}_INVALID")
    text = value.strip()
    if not text or len(text) > max_len:
        raise EnvelopeError(f"{name}_INVALID")
    return text


def validate_route(direction, kind):
    if kind not in SUPPORTED_KINDS:
        raise EnvelopeError("KIND_UNSUPPORTED")
    if direction not in SUPPORTED_DIRECTIONS:
        raise EnvelopeError("DIRECTION_UNSUPPORTED")
    if KIND_DIRECTIONS[kind] != direction:
        raise EnvelopeError("DIRECTION_KIND_MISMATCH")


def immutable_identity(direction, kind, producer, consumer, payload_sha256):
    seed = {
        "schema": SCHEMA,
        "direction": direction,
        "kind": kind,
        "producer": producer,
        "consumer": consumer,
        "payloadSha256": payload_sha256,
    }
    digest = sha256_hex(canonical_json_bytes(seed))
    return f"env-{digest}", f"idem-{digest}"


def validate_json_object_bytes(payload_bytes):
    if not isinstance(payload_bytes, (bytes, bytearray)) or not payload_bytes:
        raise EnvelopeError("PAYLOAD_INVALID")
    try:
        payload = json.loads(bytes(payload_bytes).decode("utf-8-sig"))
    except Exception as exc:
        raise EnvelopeError("PAYLOAD_JSON_INVALID") from exc
    if not isinstance(payload, dict):
        raise EnvelopeError("PAYLOAD_INVALID")
    return payload


def build_envelope_bytes(
    payload_bytes,
    *,
    direction,
    kind,
    producer,
    consumer,
    created_at=None,
):
    validate_route(direction, kind)
    producer = normalize_text("PRODUCER", producer)
    consumer = normalize_text("CONSUMER", consumer)
    payload_bytes = bytes(payload_bytes)
    validate_json_object_bytes(payload_bytes)

    payload_sha256 = sha256_hex(payload_bytes)
    envelope_id, idempotency_key = immutable_identity(
        direction, kind, producer, consumer, payload_sha256
    )
    created_at = created_at or datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")

    return {
        "schema": SCHEMA,
        "envelopeId": envelope_id,
        "idempotencyKey": idempotency_key,
        "direction": direction,
        "kind": kind,
        "createdAt": created_at,
        "producer": producer,
        "consumer": consumer,
        "payloadEncoding": "json-utf8+base64",
        "payloadSha256": payload_sha256,
        "payloadBase64": base64.b64encode(payload_bytes).decode("ascii"),
    }


def build_envelope(payload, *, direction, kind, producer, consumer, created_at=None):
    if not isinstance(payload, dict):
        raise EnvelopeError("PAYLOAD_INVALID")
    return build_envelope_bytes(
        canonical_json_bytes(payload),
        direction=direction,
        kind=kind,
        producer=producer,
        consumer=consumer,
        created_at=created_at,
    )


def decode_payload_bytes(envelope):
    if not isinstance(envelope, dict):
        raise EnvelopeError("ENVELOPE_INVALID")
    if envelope.get("schema") != SCHEMA:
        raise EnvelopeError("SCHEMA_UNSUPPORTED")

    direction = envelope.get("direction")
    kind = envelope.get("kind")
    validate_route(direction, kind)

    producer = normalize_text("PRODUCER", envelope.get("producer"))
    consumer = normalize_text("CONSUMER", envelope.get("consumer"))
    if envelope.get("payloadEncoding") != "json-utf8+base64":
        raise EnvelopeError("PAYLOAD_ENCODING_UNSUPPORTED")

    payload_b64 = envelope.get("payloadBase64")
    if not isinstance(payload_b64, str) or not payload_b64:
        raise EnvelopeError("PAYLOAD_MISSING")
    try:
        payload_bytes = base64.b64decode(payload_b64.encode("ascii"), validate=True)
    except Exception as exc:
        raise EnvelopeError("PAYLOAD_BASE64_INVALID") from exc

    actual_sha = sha256_hex(payload_bytes)
    if actual_sha != envelope.get("payloadSha256"):
        raise EnvelopeError("PAYLOAD_SHA256_MISMATCH")

    expected_id, expected_idem = immutable_identity(
        direction, kind, producer, consumer, actual_sha
    )
    if envelope.get("envelopeId") != expected_id:
        raise EnvelopeError("ENVELOPE_ID_MISMATCH")
    if envelope.get("idempotencyKey") != expected_idem:
        raise EnvelopeError("IDEMPOTENCY_KEY_MISMATCH")

    validate_json_object_bytes(payload_bytes)
    return payload_bytes


def decode_and_validate(envelope):
    payload_bytes = decode_payload_bytes(envelope)
    return json.loads(payload_bytes.decode("utf-8-sig"))


def main():
    ap = argparse.ArgumentParser(description="Build or validate transport-neutral envelopes")
    sub = ap.add_subparsers(dest="cmd", required=True)

    build = sub.add_parser("build")
    build.add_argument("--payload", required=True)
    build.add_argument("--direction", required=True, choices=sorted(SUPPORTED_DIRECTIONS))
    build.add_argument("--kind", required=True, choices=sorted(SUPPORTED_KINDS))
    build.add_argument("--producer", required=True)
    build.add_argument("--consumer", required=True)
    build.add_argument("--output", required=True)

    validate = sub.add_parser("validate")
    validate.add_argument("--input", required=True)

    args = ap.parse_args()
    try:
        if args.cmd == "build":
            payload_bytes = Path(args.payload).read_bytes()
            env = build_envelope_bytes(
                payload_bytes,
                direction=args.direction,
                kind=args.kind,
                producer=args.producer,
                consumer=args.consumer,
            )
            Path(args.output).parent.mkdir(parents=True, exist_ok=True)
            Path(args.output).write_text(
                json.dumps(env, ensure_ascii=False, indent=2) + "\n",
                encoding="utf-8",
            )
            print(json.dumps({
                "status": "ENVELOPE_BUILT",
                "envelopeId": env["envelopeId"],
                "idempotencyKey": env["idempotencyKey"],
                "payloadSha256": env["payloadSha256"],
                "output": args.output,
            }))
            return 0

        env = json.loads(Path(args.input).read_text(encoding="utf-8-sig"))
        payload = decode_and_validate(env)
        print(json.dumps({
            "status": "ENVELOPE_VALID",
            "kind": env["kind"],
            "direction": env["direction"],
            "payloadKeyCount": len(payload),
        }))
        return 0
    except Exception as exc:
        print(f"TRANSPORT_ENVELOPE_BLOCKED: {exc}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
