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

RESULT_SCHEMA = "ones.bigcircle-transport-result/v1alpha1"
CHECKPOINT_SCHEMA = "ones.bigcircle-transport-checkpoint/v1alpha1"
RESULT_STATUSES = {"RECONCILIATION_VERIFIED", "RECONCILIATION_NOOP_VERIFIED"}
CHECKPOINT_STATUSES = {"RECONCILIATION_ACCEPTED", "CASE_FEED_MATERIALIZED"}


class ConsumerError(ValueError):
    pass


def atomic_write_json(path, doc):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(path.name + f".tmp-{os.getpid()}")
    tmp.write_text(json.dumps(doc, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    os.replace(tmp, path)


def validate_result(payload):
    if payload.get("schema") != RESULT_SCHEMA:
        raise ConsumerError("RESULT_SCHEMA_INVALID")
    if payload.get("status") not in RESULT_STATUSES:
        raise ConsumerError("RESULT_STATUS_INVALID")
    for key in ("caseFeedSha256", "inventorySha256", "reconciliationRunKey", "reconciliationOutput"):
        value = payload.get(key)
        if not isinstance(value, str) or not value.strip():
            raise ConsumerError(f"RESULT_FIELD_INVALID:{key}")
    return payload


def validate_checkpoint(payload):
    if payload.get("schema") != CHECKPOINT_SCHEMA:
        raise ConsumerError("CHECKPOINT_SCHEMA_INVALID")
    if payload.get("status") not in CHECKPOINT_STATUSES:
        raise ConsumerError("CHECKPOINT_STATUS_INVALID")
    if payload["status"] == "RECONCILIATION_ACCEPTED":
        for key in ("reconciliationStatus", "caseFeedSha256", "inventorySha256", "reconciliationRunKey", "resultEnvelopeId"):
            value = payload.get(key)
            if not isinstance(value, str) or not value.strip():
                raise ConsumerError(f"CHECKPOINT_FIELD_INVALID:{key}")
        if payload["reconciliationStatus"] not in RESULT_STATUSES:
            raise ConsumerError("CHECKPOINT_RECONCILIATION_STATUS_INVALID")
    elif payload["status"] == "CASE_FEED_MATERIALIZED":
        for key in ("sourceEnvelopeId", "caseFeedSha256", "materializedFile"):
            value = payload.get(key)
            if not isinstance(value, str) or not value.strip():
                raise ConsumerError(f"CHECKPOINT_FIELD_INVALID:{key}")
    return payload


def validate_payload(envelope):
    payload = envmod.decode_and_validate(envelope)
    kind = envelope.get("kind")
    if kind == "RESULT":
        return kind, validate_result(payload)
    if kind == "CHECKPOINT":
        return kind, validate_checkpoint(payload)
    raise ConsumerError("INBOUND_KIND_UNSUPPORTED")


def persist_receipt(receipt_root, envelope, kind, payload):
    receipt_root = Path(receipt_root)
    subdir = receipt_root / kind.lower()
    subdir.mkdir(parents=True, exist_ok=True)
    target = subdir / f'{envelope["envelopeId"]}.json'
    doc = {
        "envelopeId": envelope["envelopeId"],
        "kind": kind,
        "payloadSha256": envelope["payloadSha256"],
        "payload": payload,
    }
    if target.exists():
        existing = json.loads(target.read_text(encoding="utf-8-sig"))
        if existing.get("payloadSha256") != envelope.get("payloadSha256"):
            raise ConsumerError("RECEIPT_ID_COLLISION")
        return {"status": "RECEIPT_NOOP", "path": str(target)}
    atomic_write_json(target, doc)
    return {"status": "RECEIPT_STORED", "path": str(target)}


def cross_check(receipt_root, kind, payload):
    root = Path(receipt_root)
    if kind == "CHECKPOINT" and payload.get("status") == "RECONCILIATION_ACCEPTED":
        result_id = payload["resultEnvelopeId"]
        result_path = root / "result" / f"{result_id}.json"
        if result_path.exists():
            result_doc = json.loads(result_path.read_text(encoding="utf-8-sig"))
            rp = result_doc.get("payload") or {}
            if rp.get("reconciliationRunKey") != payload.get("reconciliationRunKey"):
                raise ConsumerError("CHECKPOINT_RESULT_RUNKEY_MISMATCH")
            if rp.get("caseFeedSha256") != payload.get("caseFeedSha256"):
                raise ConsumerError("CHECKPOINT_RESULT_CASEFEED_MISMATCH")
            if rp.get("inventorySha256") != payload.get("inventorySha256"):
                raise ConsumerError("CHECKPOINT_RESULT_INVENTORY_MISMATCH")


def consume_one(spool_root, receipt_root):
    claim = spoolmod.claim_next(spool_root, "bigcircle-control")
    if claim["status"] == "EMPTY":
        return {"status": "EMPTY"}

    envelope_id = claim["envelopeId"]
    claimed_path = Path(claim["path"])
    try:
        envelope = spoolmod.load_envelope(claimed_path)
        kind, payload = validate_payload(envelope)
        cross_check(receipt_root, kind, payload)
        persisted = persist_receipt(receipt_root, envelope, kind, payload)
        done = spoolmod.complete_claim(spool_root, envelope_id, True)
        return {
            "status": persisted["status"],
            "kind": kind,
            "envelopeId": envelope_id,
            "receipt": persisted["path"],
            "claimState": done["status"],
        }
    except Exception:
        try:
            spoolmod.complete_claim(spool_root, envelope_id, False)
        except Exception:
            pass
        raise


def main():
    ap = argparse.ArgumentParser(description="Consume one Windows Agent RESULT/CHECKPOINT envelope")
    ap.add_argument("--spool-root", required=True)
    ap.add_argument("--receipt-root", required=True)
    args = ap.parse_args()
    try:
        result = consume_one(args.spool_root, args.receipt_root)
        print(json.dumps(result, ensure_ascii=False))
        return 0
    except Exception as exc:
        print(f"BIGCIRCLE_RESULT_CONSUMER_BLOCKED: {exc}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
