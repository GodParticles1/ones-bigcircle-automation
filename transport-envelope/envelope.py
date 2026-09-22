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


def build_envelope(payload, *, direction, kind, producer, consumer, created_at=None):
    if kind not in SUPPORTED_KINDS:
        raise EnvelopeError("KIND_UNSUPPORTED")
    if direction not in SUPPORTED_DIRECTIONS:
        raise EnvelopeError("DIRECTION_UNSUPPORTED")
    producer = normalize_text("PRODUCER", producer)
    consumer = normalize_text("CONSUMER", consumer)
    if not isinstance(payload, dict):
        raise EnvelopeError("PAYLOAD_INVALID")

    payload_bytes = canonical_json_bytes(payload)
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
        "payloadEncoding": "json-canonical-utf8+base64",
        "payloadSha256": payload_sha256,
        "payloadBase64": base64.b64encode(payload_bytes).decode("ascii"),
    }


def decode_and_validate(envelope):
    if not isinstance(envelope, dict):
        raise EnvelopeError("ENVELOPE_INVALID")
    if envelope.get("schema") != SCHEMA:
        raise EnvelopeError("SCHEMA_UNSUPPORTED")

    direction = envelope.get("direction")
    kind = envelope.get("kind")
    if direction not in SUPPORTED_DIRECTIONS:
        raise EnvelopeError("DIRECTION_UNSUPPORTED")
    if kind not in SUPPORTED_KINDS:
        raise EnvelopeError("KIND_UNSUPPORTED")

    producer = normalize_text("PRODUCER", envelope.get("producer"))
    consumer = normalize_text("CONSUMER", envelope.get("consumer"))
    if envelope.get("payloadEncoding") != "json-canonical-utf8+base64":
        raise EnvelopeError("PAYLOAD_ENCODING_UNSUPPORTED")

    payload_b64 = envelope.get("payloadBase64")
    if not isinstance(payload_b64, str) or not payload_b64:
        raise EnvelopeError("PAYLOAD_MISSING")
    try:
        payload_bytes = base64.b64decode(payload_b64.encode("ascii"), validate=True)
    except Exception as exc:
        raise EnvelopeError("PAYLOAD_BASE64_INVALID") from exc

    actual_sha = sha256_hex(payload_bytes)
    expected_sha = envelope.get("payloadSha256")
    if actual_sha != expected_sha:
        raise EnvelopeError("PAYLOAD_SHA256_MISMATCH")

    expected_id, expected_idem = immutable_identity(
        direction, kind, producer, consumer, actual_sha
    )
    if envelope.get("envelopeId") != expected_id:
        raise EnvelopeError("ENVELOPE_ID_MISMATCH")
    if envelope.get("idempotencyKey") != expected_idem:
        raise EnvelopeError("IDEMPOTENCY_KEY_MISMATCH")

    try:
        payload = json.loads(payload_bytes.decode("utf-8"))
    except Exception as exc:
        raise EnvelopeError("PAYLOAD_JSON_INVALID") from exc
    if not isinstance(payload, dict):
        raise EnvelopeError("PAYLOAD_INVALID")

    if canonical_json_bytes(payload) != payload_bytes:
        raise EnvelopeError("PAYLOAD_NOT_CANONICAL")

    return payload


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
            payload = json.loads(Path(args.payload).read_text(encoding="utf-8-sig"))
            env = build_envelope(
                payload,
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
