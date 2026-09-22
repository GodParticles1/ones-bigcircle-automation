#!/usr/bin/env python3
import argparse
import importlib.util
import json
import sys
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]

def load_module(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod

envmod = load_module("staging_env", ROOT / "transport-envelope" / "envelope.py")
spoolmod = load_module("staging_spool", ROOT / "transport-spool" / "spool.py")
client = load_module("staging_client", ROOT / "remote-transport" / "client.py")

def write_envelope(path, payload, *, direction, kind, producer, consumer):
    env = envmod.build_envelope(
        payload, direction=direction, kind=kind, producer=producer, consumer=consumer
    )
    Path(path).write_text(json.dumps(env, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return env

def exact_spool_bytes(root, envelope_id, state="outbox"):
    return (Path(root) / state / f"{envelope_id}.json").read_bytes()

def run_smoke(base_url, big_secret, win_secret, *, allow_http_loopback=False):
    with tempfile.TemporaryDirectory() as td:
        root = Path(td)
        big = root / "bigcircle"
        win = root / "windows"

        case_file = root / "case-envelope.json"
        case_env = write_envelope(
            case_file,
            {
                "schema": "bigcircle.confirmed-case-export/v1alpha1",
                "complete": True,
                "exportedCaseCount": 1,
                "source": "P4I_SYNTHETIC_STAGING_SMOKE",
                "cases": [{
                    "localCaseId": "P4I-SYNTHETIC-CASE-001",
                    "caseStatus": "CONFIRMED_REAL_CASE",
                    "date": "2026-09-22",
                    "handlerPersons": ["Synthetic-Engineer"],
                    "sourceTicketKey": "SYNTH-1",
                    "remarks": "Synthetic transport smoke only; no production evidence.",
                }],
            },
            direction="BIGCIRCLE_TO_WINDOWS",
            kind="CASE_FEED",
            producer="bigcircle-control",
            consumer="windows-agent",
        )
        spoolmod.emit_outbound(big, "bigcircle-control", case_file)
        forward_raw = exact_spool_bytes(big, case_env["envelopeId"])

        pushed = client.push_one(
            big, "bigcircle-control", base_url, big_secret,
            cleanup=True, allow_http_loopback=allow_http_loopback,
        )
        if pushed.get("status") not in {"PUSHED", "PUSH_NOOP"}:
            raise ValueError("FORWARD_PUSH_FAILED")

        pulled = client.pull_one(
            win, "windows-agent", base_url, win_secret,
            allow_http_loopback=allow_http_loopback,
        )
        if pulled.get("status") not in {"PULLED", "PULL_NOOP"}:
            raise ValueError("FORWARD_PULL_FAILED")
        if Path(pulled["spool"]).read_bytes() != forward_raw:
            raise ValueError("FORWARD_EXACT_BYTES_MISMATCH")

        reverse_ids = []
        for kind, payload in [
            ("RESULT", {
                "schema": "ones.bigcircle-transport-result/v1alpha1",
                "status": "RECONCILIATION_VERIFIED",
                "caseFeedSha256": case_env["payloadSha256"],
                "inventorySha256": "1" * 64,
                "reconciliationRunKey": "2" * 64,
                "reconciliationOutput": "P4I_SYNTHETIC_STAGING_SMOKE",
            }),
            ("CHECKPOINT", {
                "schema": "ones.bigcircle-transport-checkpoint/v1alpha1",
                "status": "RECONCILIATION_ACCEPTED",
                "reconciliationStatus": "RECONCILIATION_VERIFIED",
                "caseFeedSha256": case_env["payloadSha256"],
                "inventorySha256": "1" * 64,
                "reconciliationRunKey": "2" * 64,
                "resultEnvelopeId": "P4I-SYNTHETIC-RESULT-REFERENCE",
            }),
        ]:
            path = root / f"{kind.lower()}-envelope.json"
            env = write_envelope(
                path, payload, direction="WINDOWS_TO_BIGCIRCLE", kind=kind,
                producer="windows-agent", consumer="bigcircle-control",
            )
            spoolmod.emit_outbound(win, "windows-agent", path)
            reverse_ids.append(env["envelopeId"])

        reverse_received = []
        for _ in reverse_ids:
            pushed_reverse = client.push_one(
                win, "windows-agent", base_url, win_secret,
                cleanup=True, allow_http_loopback=allow_http_loopback,
            )
            if pushed_reverse.get("status") not in {"PUSHED", "PUSH_NOOP"}:
                raise ValueError("REVERSE_PUSH_FAILED")
            pulled_reverse = client.pull_one(
                big, "bigcircle-control", base_url, big_secret,
                allow_http_loopback=allow_http_loopback,
            )
            if pulled_reverse.get("status") not in {"PULLED", "PULL_NOOP"}:
                raise ValueError("REVERSE_PULL_FAILED")
            reverse_received.append(pulled_reverse["envelopeId"])

        if set(reverse_received) != set(reverse_ids):
            raise ValueError("REVERSE_ENVELOPE_SET_MISMATCH")

        return {
            "status": "CLOUDFLARE_STAGING_SYNTHETIC_SMOKE_PASS",
            "forwardEnvelopeId": case_env["envelopeId"],
            "forwardPayloadSha256": case_env["payloadSha256"],
            "reverseEnvelopeIds": reverse_received,
            "productionDataUsed": False,
            "browserRelayUsed": False,
            "onesMutationUsed": False,
        }

def main():
    ap = argparse.ArgumentParser(description="Synthetic Cloudflare transport staging smoke")
    ap.add_argument("--base-url", required=True)
    ap.add_argument("--bigcircle-secret-file", required=True)
    ap.add_argument("--windows-secret-file", required=True)
    ap.add_argument("--allow-http-loopback-test", action="store_true")
    args = ap.parse_args()
    try:
        result = run_smoke(
            args.base_url,
            client.read_secret(args.bigcircle_secret_file),
            client.read_secret(args.windows_secret_file),
            allow_http_loopback=args.allow_http_loopback_test,
        )
    except Exception as exc:
        print(f"CLOUDFLARE_STAGING_SMOKE_BLOCKED: {exc}", file=sys.stderr)
        return 2
    print(json.dumps(result, ensure_ascii=False))
    return 0

if __name__ == "__main__":
    raise SystemExit(main())
