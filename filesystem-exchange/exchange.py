#!/usr/bin/env python3
import argparse
import importlib.util
import json
import os
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent


def load_module(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


envmod = load_module("transport_envelope", ROOT / "transport-envelope" / "envelope.py")
spoolmod = load_module("transport_spool", ROOT / "transport-spool" / "spool.py")

DIRECTIONS = {
    "BIGCIRCLE_TO_WINDOWS",
    "WINDOWS_TO_BIGCIRCLE",
}


class ExchangeError(ValueError):
    pass


def atomic_write_bytes(path, data):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(path.name + f".tmp-{os.getpid()}")
    with open(tmp, "wb") as f:
        f.write(data)
        f.flush()
        os.fsync(f.fileno())
    os.replace(tmp, path)


def envelope_file_bytes(path):
    path = Path(path)
    data = path.read_bytes()
    try:
        doc = json.loads(data.decode("utf-8-sig"))
    except Exception as exc:
        raise ExchangeError("ENVELOPE_FILE_INVALID") from exc
    envmod.decode_payload_bytes(doc)
    return data, doc


def verify_same_bytes(path, expected):
    actual = Path(path).read_bytes()
    if actual != expected:
        raise ExchangeError("EXCHANGE_BYTE_MISMATCH")


def export_one(spool_root, exchange_root, role, cleanup=False):
    spoolmod.validate_role(role)
    dirs = spoolmod.ensure_dirs(spool_root)
    expected_direction = spoolmod.OUTBOUND_DIRECTION[role]

    for source in sorted(dirs["outbox"].glob("env-*.json")):
        raw, envelope = envelope_file_bytes(source)
        spoolmod.validate_direction_for_role(role, envelope, inbound=False)
        if envelope.get("direction") != expected_direction:
            raise ExchangeError("EXPORT_DIRECTION_MISMATCH")

        target = Path(exchange_root) / expected_direction / source.name
        if target.exists():
            verify_same_bytes(target, raw)
            status = "EXPORT_NOOP"
        else:
            atomic_write_bytes(target, raw)
            verify_same_bytes(target, raw)
            status = "EXPORTED"

        if cleanup:
            verify_same_bytes(target, raw)
            source.unlink()

        return {
            "status": status,
            "role": role,
            "direction": expected_direction,
            "envelopeId": envelope["envelopeId"],
            "source": str(source),
            "exchange": str(target),
            "sourceRemoved": cleanup,
        }
    return {"status": "EMPTY"}


def _find_existing_spool_envelope(dirs, name):
    for state in ("inbox", "claimed", "processed"):
        p = dirs[state] / name
        if p.exists():
            return state, p
    return None, None


def import_one(exchange_root, spool_root, role, cleanup=False):
    spoolmod.validate_role(role)
    expected_direction = spoolmod.INBOUND_DIRECTION[role]
    exchange_dir = Path(exchange_root) / expected_direction
    if not exchange_dir.exists():
        return {"status": "EMPTY"}

    dirs = spoolmod.ensure_dirs(spool_root)
    for source in sorted(exchange_dir.glob("env-*.json")):
        raw, envelope = envelope_file_bytes(source)
        spoolmod.validate_direction_for_role(role, envelope, inbound=True)
        if envelope.get("direction") != expected_direction:
            raise ExchangeError("IMPORT_DIRECTION_MISMATCH")

        name = spoolmod.envelope_filename(envelope)
        state, existing = _find_existing_spool_envelope(dirs, name)
        if existing is not None:
            existing_doc = spoolmod.load_envelope(existing)
            if existing_doc.get("payloadSha256") != envelope.get("payloadSha256"):
                raise ExchangeError("ENVELOPE_ID_COLLISION")
            status = "IMPORT_NOOP"
            target = existing
        else:
            target = dirs["inbox"] / name
            atomic_write_bytes(target, raw)
            verify_same_bytes(target, raw)
            stored = spoolmod.load_envelope(target)
            if stored.get("envelopeId") != envelope.get("envelopeId"):
                raise ExchangeError("IMPORT_ID_MISMATCH")
            state = "inbox"
            status = "IMPORTED"

        if cleanup:
            if status == "IMPORTED":
                verify_same_bytes(target, raw)
            else:
                existing_doc = spoolmod.load_envelope(target)
                if existing_doc.get("payloadSha256") != envelope.get("payloadSha256"):
                    raise ExchangeError("IMPORT_VERIFY_FAILED")
            source.unlink()

        return {
            "status": status,
            "role": role,
            "direction": expected_direction,
            "envelopeId": envelope["envelopeId"],
            "exchange": str(source),
            "spool": str(target),
            "spoolState": state.upper(),
            "exchangeRemoved": cleanup,
        }
    return {"status": "EMPTY"}


def main():
    ap = argparse.ArgumentParser(description="Provider-neutral filesystem exchange adapter")
    ap.add_argument("--exchange-root", required=True)
    ap.add_argument("--spool-root", required=True)
    ap.add_argument("--role", required=True, choices=sorted(spoolmod.ROLES))
    ap.add_argument("--cleanup", action="store_true")
    sub = ap.add_subparsers(dest="cmd", required=True)
    sub.add_parser("export-one")
    sub.add_parser("import-one")
    args = ap.parse_args()

    try:
        if args.cmd == "export-one":
            result = export_one(args.spool_root, args.exchange_root, args.role, args.cleanup)
        else:
            result = import_one(args.exchange_root, args.spool_root, args.role, args.cleanup)
        print(json.dumps(result, ensure_ascii=False))
        return 0
    except Exception as exc:
        print(f"FILESYSTEM_EXCHANGE_BLOCKED: {exc}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
