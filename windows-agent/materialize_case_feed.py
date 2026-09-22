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

CASE_FEED_SCHEMA = "bigcircle.confirmed-case-export/v1alpha1"


class MaterializerError(ValueError):
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


def validate_case_feed_bytes(payload_bytes):
    try:
        doc = json.loads(payload_bytes.decode("utf-8-sig"))
    except Exception as exc:
        raise MaterializerError("CASE_FEED_JSON_INVALID") from exc
    if not isinstance(doc, dict):
        raise MaterializerError("CASE_FEED_INVALID")
    if doc.get("schema") != CASE_FEED_SCHEMA:
        raise MaterializerError("CASE_FEED_SCHEMA_INVALID")
    if doc.get("complete") is not True:
        raise MaterializerError("CASE_FEED_NOT_COMPLETE")
    cases = doc.get("cases")
    if not isinstance(cases, list):
        raise MaterializerError("CASE_FEED_CASES_INVALID")
    if doc.get("exportedCaseCount") != len(cases):
        raise MaterializerError("CASE_FEED_COUNT_MISMATCH")
    return doc


def build_checkpoint_envelope(source_envelope, case_feed_sha256, materialized_name):
    payload = {
        "schema": "ones.bigcircle-transport-checkpoint/v1alpha1",
        "status": "CASE_FEED_MATERIALIZED",
        "sourceEnvelopeId": source_envelope["envelopeId"],
        "caseFeedSha256": case_feed_sha256,
        "materializedFile": materialized_name,
    }
    return envmod.build_envelope(
        payload,
        direction="WINDOWS_TO_BIGCIRCLE",
        kind="CHECKPOINT",
        producer="windows-agent",
        consumer="bigcircle-control",
    )


def process_one(spool_root, case_feed_dir):
    claim = spoolmod.claim_next(spool_root, "windows-agent")
    if claim["status"] == "EMPTY":
        return {"status": "EMPTY"}

    envelope_id = claim["envelopeId"]
    claimed_path = Path(claim["path"])

    try:
        envelope = spoolmod.load_envelope(claimed_path)
        if envelope.get("kind") != "CASE_FEED":
            raise MaterializerError("INBOUND_KIND_NOT_CASE_FEED")

        payload_bytes = envmod.decode_payload_bytes(envelope)
        validate_case_feed_bytes(payload_bytes)

        payload_sha = envmod.sha256_hex(payload_bytes)
        if envelope.get("payloadSha256") != payload_sha:
            raise MaterializerError("CASE_FEED_HASH_DRIFT")

        case_feed_dir = Path(case_feed_dir)
        case_feed_dir.mkdir(parents=True, exist_ok=True)
        filename = f"case-feed-{payload_sha}.json"
        target = case_feed_dir / filename

        materialized_status = "MATERIALIZED"
        if target.exists():
            existing = target.read_bytes()
            if envmod.sha256_hex(existing) != payload_sha:
                raise MaterializerError("CASE_FEED_TARGET_COLLISION")
            materialized_status = "MATERIALIZE_NOOP"
        else:
            atomic_write_bytes(target, payload_bytes)
            if envmod.sha256_hex(target.read_bytes()) != payload_sha:
                raise MaterializerError("CASE_FEED_POST_WRITE_HASH_MISMATCH")

        checkpoint = build_checkpoint_envelope(envelope, payload_sha, filename)
        checkpoint_path = claimed_path.parent / f"{envelope_id}.checkpoint.json"
        checkpoint_path.write_text(
            json.dumps(checkpoint, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )
        outbound = spoolmod.emit_outbound(
            spool_root,
            "windows-agent",
            checkpoint_path,
        )

        done = spoolmod.complete_claim(spool_root, envelope_id, True)
        try:
            checkpoint_path.unlink()
        except FileNotFoundError:
            pass

        return {
            "status": materialized_status,
            "sourceEnvelopeId": envelope_id,
            "caseFeedSha256": payload_sha,
            "caseFeedFile": str(target),
            "checkpointEnvelopeId": checkpoint["envelopeId"],
            "checkpointOutbox": outbound["path"],
            "claimState": done["status"],
        }
    except Exception as exc:
        try:
            spoolmod.complete_claim(spool_root, envelope_id, False)
        except Exception:
            pass
        raise


def main():
    ap = argparse.ArgumentParser(description="Materialize one inbound CASE_FEED envelope")
    ap.add_argument("--spool-root", required=True)
    ap.add_argument("--case-feed-dir", required=True)
    args = ap.parse_args()

    try:
        result = process_one(args.spool_root, args.case_feed_dir)
        print(json.dumps(result, ensure_ascii=False))
        return 0
    except Exception as exc:
        print(f"CASE_FEED_MATERIALIZER_BLOCKED: {exc}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
