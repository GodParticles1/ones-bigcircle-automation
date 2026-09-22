#!/usr/bin/env python3
import argparse
import hashlib
import hmac
import importlib.util
import json
import os
import secrets
import sys
import tempfile
import time
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import urlparse
from urllib.request import Request, urlopen

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent


def load_module(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


envmod = load_module("remote_transport_envelope", ROOT / "transport-envelope" / "envelope.py")
spoolmod = load_module("remote_transport_spool", ROOT / "transport-spool" / "spool.py")

ROLE_PUSH_DIRECTION = dict(spoolmod.OUTBOUND_DIRECTION)
ROLE_PULL_DIRECTION = dict(spoolmod.INBOUND_DIRECTION)

HEADER_ROLE = "X-OBT-Role"
HEADER_TIMESTAMP = "X-OBT-Timestamp"
HEADER_NONCE = "X-OBT-Nonce"
HEADER_BODY_SHA = "X-OBT-Body-SHA256"
HEADER_SIGNATURE = "X-OBT-Signature"
HEADER_ENVELOPE_ID = "X-OBT-Envelope-Id"
HEADER_RAW_SHA = "X-OBT-Raw-SHA256"
HEADER_LEASE_ID = "X-OBT-Lease-Id"


class RemoteTransportError(ValueError):
    pass


def sha256_hex(data):
    return hashlib.sha256(data).hexdigest()


def canonical_json_bytes(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")


def canonical_signing_bytes(method, path_with_query, role, timestamp, nonce, body_sha):
    return "\n".join([
        method.upper(),
        path_with_query,
        role,
        str(timestamp),
        nonce,
        body_sha,
    ]).encode("utf-8")


def sign_request(secret, method, path_with_query, role, timestamp, nonce, body):
    if not isinstance(secret, (bytes, bytearray)) or len(secret) < 32:
        raise RemoteTransportError("SECRET_TOO_SHORT")
    body_sha = sha256_hex(body)
    canonical = canonical_signing_bytes(
        method, path_with_query, role, timestamp, nonce, body_sha
    )
    signature = hmac.new(bytes(secret), canonical, hashlib.sha256).hexdigest()
    return {
        HEADER_ROLE: role,
        HEADER_TIMESTAMP: str(timestamp),
        HEADER_NONCE: nonce,
        HEADER_BODY_SHA: body_sha,
        HEADER_SIGNATURE: signature,
    }


def read_secret(path):
    raw = Path(path).read_bytes().strip()
    if len(raw) < 32:
        raise RemoteTransportError("SECRET_TOO_SHORT")
    return raw


def validate_base_url(base_url, allow_http_loopback=False):
    parsed = urlparse(base_url)
    if parsed.scheme == "https" and parsed.netloc:
        return base_url.rstrip("/")
    if (
        allow_http_loopback
        and parsed.scheme == "http"
        and parsed.hostname in {"127.0.0.1", "localhost"}
        and parsed.netloc
    ):
        return base_url.rstrip("/")
    raise RemoteTransportError("HTTPS_REQUIRED")


def request_bytes(
    base_url,
    secret,
    role,
    method,
    path,
    body=b"",
    *,
    allow_http_loopback=False,
    timeout=20,
    nonce=None,
    timestamp=None,
):
    spoolmod.validate_role(role)
    base_url = validate_base_url(base_url, allow_http_loopback)
    nonce = nonce or secrets.token_urlsafe(24)
    timestamp = int(time.time() if timestamp is None else timestamp)
    headers = sign_request(secret, method, path, role, timestamp, nonce, body)
    headers["Content-Type"] = "application/octet-stream"
    req = Request(base_url + path, data=body, method=method.upper(), headers=headers)
    try:
        with urlopen(req, timeout=timeout) as resp:
            return resp.status, dict(resp.headers.items()), resp.read()
    except HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")[:2048]
        raise RemoteTransportError(f"HTTP_{exc.code}:{detail}") from exc
    except URLError as exc:
        raise RemoteTransportError(f"NETWORK_ERROR:{exc.reason}") from exc


def parse_json_response(raw):
    try:
        doc = json.loads(raw.decode("utf-8"))
    except Exception as exc:
        raise RemoteTransportError("PROVIDER_JSON_INVALID") from exc
    if not isinstance(doc, dict):
        raise RemoteTransportError("PROVIDER_JSON_INVALID")
    return doc


def load_envelope_raw(path):
    raw = Path(path).read_bytes()
    try:
        doc = json.loads(raw.decode("utf-8-sig"))
    except Exception as exc:
        raise RemoteTransportError("ENVELOPE_FILE_INVALID") from exc
    envmod.decode_payload_bytes(doc)
    return raw, doc


def push_one(spool_root, role, base_url, secret, *, cleanup=False, allow_http_loopback=False):
    spoolmod.validate_role(role)
    dirs = spoolmod.ensure_dirs(spool_root)
    expected_direction = ROLE_PUSH_DIRECTION[role]

    for source in sorted(dirs["outbox"].glob("env-*.json")):
        raw, envelope = load_envelope_raw(source)
        spoolmod.validate_direction_for_role(role, envelope, inbound=False)
        if envelope["direction"] != expected_direction:
            raise RemoteTransportError("PUSH_DIRECTION_MISMATCH")

        raw_sha = sha256_hex(raw)
        path = f'/v1/envelopes/{expected_direction}/{envelope["envelopeId"]}'
        status, _, response_raw = request_bytes(
            base_url,
            secret,
            role,
            "PUT",
            path,
            raw,
            allow_http_loopback=allow_http_loopback,
        )
        if status != 200:
            raise RemoteTransportError(f"PUSH_HTTP_STATUS:{status}")
        response = parse_json_response(response_raw)
        if response.get("status") not in {"STORED", "NOOP"}:
            raise RemoteTransportError("PUSH_STATUS_INVALID")
        if response.get("envelopeId") != envelope["envelopeId"]:
            raise RemoteTransportError("PUSH_ID_MISMATCH")
        if response.get("rawSha256") != raw_sha:
            raise RemoteTransportError("PUSH_RAW_SHA_MISMATCH")

        if cleanup:
            if sha256_hex(source.read_bytes()) != raw_sha:
                raise RemoteTransportError("LOCAL_OUTBOX_CHANGED")
            source.unlink()

        return {
            "status": "PUSHED" if response["status"] == "STORED" else "PUSH_NOOP",
            "role": role,
            "direction": expected_direction,
            "envelopeId": envelope["envelopeId"],
            "rawSha256": raw_sha,
            "source": str(source),
            "sourceRemoved": cleanup,
        }

    return {"status": "EMPTY"}


def atomic_write_bytes(path, data):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(path.name + f".tmp-{os.getpid()}")
    with open(tmp, "wb") as f:
        f.write(data)
        f.flush()
        os.fsync(f.fileno())
    os.replace(tmp, path)


def find_existing(dirs, name):
    for state in ("inbox", "claimed", "processed"):
        p = dirs[state] / name
        if p.exists():
            return state, p
    return None, None


def persist_claimed_raw(spool_root, role, raw, envelope, expected_raw_sha):
    dirs = spoolmod.ensure_dirs(spool_root)
    spoolmod.validate_direction_for_role(role, envelope, inbound=True)
    name = spoolmod.envelope_filename(envelope)
    state, existing = find_existing(dirs, name)
    if existing is not None:
        existing_raw = existing.read_bytes()
        if sha256_hex(existing_raw) != expected_raw_sha or existing_raw != raw:
            raise RemoteTransportError("LOCAL_RAW_COLLISION")
        return {
            "status": "INBOUND_NOOP",
            "state": state.upper(),
            "path": str(existing),
        }

    target = dirs["inbox"] / name
    atomic_write_bytes(target, raw)
    if target.read_bytes() != raw or sha256_hex(target.read_bytes()) != expected_raw_sha:
        raise RemoteTransportError("LOCAL_PERSIST_VERIFY_FAILED")
    stored = spoolmod.load_envelope(target)
    if stored.get("envelopeId") != envelope.get("envelopeId"):
        raise RemoteTransportError("LOCAL_PERSIST_ID_MISMATCH")
    return {
        "status": "INBOUND_STORED",
        "state": "INBOX",
        "path": str(target),
    }


def pull_one(spool_root, role, base_url, secret, *, allow_http_loopback=False):
    spoolmod.validate_role(role)
    expected_direction = ROLE_PULL_DIRECTION[role]
    claim_body = b"{}"
    claim_path = f"/v1/claims/{expected_direction}"
    status, headers, raw = request_bytes(
        base_url,
        secret,
        role,
        "POST",
        claim_path,
        claim_body,
        allow_http_loopback=allow_http_loopback,
    )
    if status == 204:
        return {"status": "EMPTY"}
    if status != 200:
        raise RemoteTransportError(f"CLAIM_HTTP_STATUS:{status}")

    lower = {k.lower(): v for k, v in headers.items()}
    envelope_id = lower.get(HEADER_ENVELOPE_ID.lower())
    raw_sha = lower.get(HEADER_RAW_SHA.lower())
    lease_id = lower.get(HEADER_LEASE_ID.lower())
    if not envelope_id or not raw_sha or not lease_id:
        raise RemoteTransportError("CLAIM_HEADERS_MISSING")
    if sha256_hex(raw) != raw_sha:
        raise RemoteTransportError("CLAIM_RAW_SHA_MISMATCH")

    try:
        envelope = json.loads(raw.decode("utf-8-sig"))
    except Exception as exc:
        raise RemoteTransportError("CLAIM_ENVELOPE_INVALID") from exc
    envmod.decode_payload_bytes(envelope)
    spoolmod.validate_direction_for_role(role, envelope, inbound=True)
    if envelope.get("direction") != expected_direction:
        raise RemoteTransportError("CLAIM_DIRECTION_MISMATCH")
    if envelope.get("envelopeId") != envelope_id:
        raise RemoteTransportError("CLAIM_ID_MISMATCH")

    persisted = persist_claimed_raw(
        spool_root, role, raw, envelope, raw_sha
    )

    ack_body = canonical_json_bytes({
        "leaseId": lease_id,
        "rawSha256": raw_sha,
    })
    ack_path = f"/v1/acks/{expected_direction}/{envelope_id}"
    ack_status, _, ack_raw = request_bytes(
        base_url,
        secret,
        role,
        "POST",
        ack_path,
        ack_body,
        allow_http_loopback=allow_http_loopback,
    )
    if ack_status != 200:
        raise RemoteTransportError(f"ACK_HTTP_STATUS:{ack_status}")
    ack = parse_json_response(ack_raw)
    if ack.get("status") != "ACKED":
        raise RemoteTransportError("ACK_STATUS_INVALID")
    if ack.get("envelopeId") != envelope_id or ack.get("rawSha256") != raw_sha:
        raise RemoteTransportError("ACK_MISMATCH")

    return {
        "status": "PULLED" if persisted["status"] == "INBOUND_STORED" else "PULL_NOOP",
        "role": role,
        "direction": expected_direction,
        "envelopeId": envelope_id,
        "rawSha256": raw_sha,
        "spool": persisted["path"],
        "spoolState": persisted["state"],
        "acked": True,
    }


def main():
    ap = argparse.ArgumentParser(description="Signed remote transport client v1")
    ap.add_argument("--base-url", required=True)
    ap.add_argument("--spool-root", required=True)
    ap.add_argument("--role", required=True, choices=sorted(spoolmod.ROLES))
    ap.add_argument("--secret-file", required=True)
    ap.add_argument("--allow-http-loopback-test", action="store_true")
    sub = ap.add_subparsers(dest="cmd", required=True)
    push = sub.add_parser("push-one")
    push.add_argument("--cleanup", action="store_true")
    sub.add_parser("pull-one")
    args = ap.parse_args()

    try:
        secret = read_secret(args.secret_file)
        if args.cmd == "push-one":
            result = push_one(
                args.spool_root,
                args.role,
                args.base_url,
                secret,
                cleanup=args.cleanup,
                allow_http_loopback=args.allow_http_loopback_test,
            )
        else:
            result = pull_one(
                args.spool_root,
                args.role,
                args.base_url,
                secret,
                allow_http_loopback=args.allow_http_loopback_test,
            )
        print(json.dumps(result, ensure_ascii=False))
        return 0
    except Exception as exc:
        print(f"REMOTE_TRANSPORT_BLOCKED: {exc}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
