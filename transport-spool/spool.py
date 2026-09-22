#!/usr/bin/env python3
import argparse
import json
import os
import shutil
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
ENVELOPE_PATH = HERE.parent / "transport-envelope" / "envelope.py"

import importlib.util
_spec = importlib.util.spec_from_file_location("transport_envelope", ENVELOPE_PATH)
envmod = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(envmod)

ROLES = {"windows-agent", "bigcircle-control"}
INBOUND_DIRECTION = {
    "windows-agent": "BIGCIRCLE_TO_WINDOWS",
    "bigcircle-control": "WINDOWS_TO_BIGCIRCLE",
}
OUTBOUND_DIRECTION = {
    "windows-agent": "WINDOWS_TO_BIGCIRCLE",
    "bigcircle-control": "BIGCIRCLE_TO_WINDOWS",
}


class SpoolError(ValueError):
    pass


def ensure_dirs(root):
    root = Path(root)
    dirs = {
        "inbox": root / "inbox",
        "claimed": root / "claimed",
        "processed": root / "processed",
        "rejected": root / "rejected",
        "outbox": root / "outbox",
    }
    for p in dirs.values():
        p.mkdir(parents=True, exist_ok=True)
    return dirs


def atomic_write_json(path, doc):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(path.name + f".tmp-{os.getpid()}")
    data = json.dumps(doc, ensure_ascii=False, indent=2) + "\n"
    tmp.write_text(data, encoding="utf-8")
    os.replace(tmp, path)


def load_envelope(path):
    try:
        doc = json.loads(Path(path).read_text(encoding="utf-8-sig"))
    except Exception as exc:
        raise SpoolError("ENVELOPE_FILE_INVALID") from exc
    envmod.decode_payload_bytes(doc)
    return doc


def validate_role(role):
    if role not in ROLES:
        raise SpoolError("ROLE_INVALID")


def validate_direction_for_role(role, envelope, inbound):
    validate_role(role)
    expected = INBOUND_DIRECTION[role] if inbound else OUTBOUND_DIRECTION[role]
    if envelope.get("direction") != expected:
        raise SpoolError("ROLE_DIRECTION_MISMATCH")


def envelope_filename(envelope):
    envelope_id = envelope.get("envelopeId")
    if not isinstance(envelope_id, str) or not envelope_id.startswith("env-"):
        raise SpoolError("ENVELOPE_ID_INVALID")
    return envelope_id + ".json"


def put_inbound(root, role, envelope_path):
    dirs = ensure_dirs(root)
    envelope = load_envelope(envelope_path)
    validate_direction_for_role(role, envelope, inbound=True)
    name = envelope_filename(envelope)
    target = dirs["inbox"] / name

    for state in ("inbox", "claimed", "processed"):
        existing = dirs[state] / name
        if existing.exists():
            existing_doc = load_envelope(existing)
            if existing_doc.get("payloadSha256") != envelope.get("payloadSha256"):
                raise SpoolError("ENVELOPE_ID_COLLISION")
            return {
                "status": "INBOUND_NOOP",
                "state": state.upper(),
                "envelopeId": envelope["envelopeId"],
                "path": str(existing),
            }

    atomic_write_json(target, envelope)
    return {
        "status": "INBOUND_STORED",
        "state": "INBOX",
        "envelopeId": envelope["envelopeId"],
        "path": str(target),
    }


def emit_outbound(root, role, envelope_path):
    dirs = ensure_dirs(root)
    envelope = load_envelope(envelope_path)
    validate_direction_for_role(role, envelope, inbound=False)
    name = envelope_filename(envelope)
    target = dirs["outbox"] / name
    if target.exists():
        existing = load_envelope(target)
        if existing.get("payloadSha256") != envelope.get("payloadSha256"):
            raise SpoolError("ENVELOPE_ID_COLLISION")
        return {
            "status": "OUTBOUND_NOOP",
            "envelopeId": envelope["envelopeId"],
            "path": str(target),
        }
    atomic_write_json(target, envelope)
    return {
        "status": "OUTBOUND_STORED",
        "envelopeId": envelope["envelopeId"],
        "path": str(target),
    }


def claim_next(root, role):
    dirs = ensure_dirs(root)
    validate_role(role)
    for source in sorted(dirs["inbox"].glob("env-*.json")):
        try:
            envelope = load_envelope(source)
            validate_direction_for_role(role, envelope, inbound=True)
        except Exception:
            rejected = dirs["rejected"] / source.name
            os.replace(source, rejected)
            continue

        target = dirs["claimed"] / source.name
        try:
            os.replace(source, target)
        except FileNotFoundError:
            continue
        return {
            "status": "CLAIMED",
            "envelopeId": envelope["envelopeId"],
            "path": str(target),
        }
    return {"status": "EMPTY"}


def complete_claim(root, envelope_id, accepted):
    dirs = ensure_dirs(root)
    name = envelope_id + ".json"
    source = dirs["claimed"] / name
    if not source.exists():
        raise SpoolError("CLAIM_NOT_FOUND")
    load_envelope(source)
    target_dir = dirs["processed"] if accepted else dirs["rejected"]
    target = target_dir / name
    if target.exists():
        existing = load_envelope(target)
        source_doc = load_envelope(source)
        if existing.get("payloadSha256") != source_doc.get("payloadSha256"):
            raise SpoolError("ENVELOPE_ID_COLLISION")
        source.unlink()
    else:
        os.replace(source, target)
    return {
        "status": "PROCESSED" if accepted else "REJECTED",
        "envelopeId": envelope_id,
        "path": str(target),
    }


def main():
    ap = argparse.ArgumentParser(description="Durable provider-neutral transport spool")
    ap.add_argument("--root", required=True)
    ap.add_argument("--role", required=True, choices=sorted(ROLES))
    sub = ap.add_subparsers(dest="cmd", required=True)

    pin = sub.add_parser("put-inbound")
    pin.add_argument("--envelope", required=True)

    pout = sub.add_parser("emit-outbound")
    pout.add_argument("--envelope", required=True)

    sub.add_parser("claim-next")

    complete = sub.add_parser("complete")
    complete.add_argument("--envelope-id", required=True)
    complete.add_argument("--accepted", choices=["true", "false"], required=True)

    args = ap.parse_args()
    try:
        if args.cmd == "put-inbound":
            result = put_inbound(args.root, args.role, args.envelope)
        elif args.cmd == "emit-outbound":
            result = emit_outbound(args.root, args.role, args.envelope)
        elif args.cmd == "claim-next":
            result = claim_next(args.root, args.role)
        else:
            result = complete_claim(
                args.root,
                args.envelope_id,
                args.accepted == "true",
            )
        print(json.dumps(result, ensure_ascii=False))
        return 0
    except Exception as exc:
        print(f"TRANSPORT_SPOOL_BLOCKED: {exc}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
