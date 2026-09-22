#!/usr/bin/env python3
import argparse
import sys
import tomllib
from pathlib import Path

REQUIRED_DO_BINDING = "TRANSPORT_COORDINATOR"
REQUIRED_DO_CLASS = "TransportCoordinator"
REQUIRED_R2_BINDING = "ENVELOPE_BUCKET"
FORBIDDEN_SECRET_KEYS = {"BIGCIRCLE_HMAC_SECRET", "WINDOWS_HMAC_SECRET"}
PLACEHOLDER_MARKERS = {"REPLACE_WITH_PRIVATE_BUCKET", "CHANGEME", "PLACEHOLDER"}

def load_toml(path):
    with open(path, "rb") as f:
        return tomllib.load(f)

def fail(msg):
    raise ValueError(msg)

def validate(config, allow_template=False):
    name = config.get("name")
    main = config.get("main")
    if not isinstance(name, str) or not name.strip():
        fail("WORKER_NAME_MISSING")
    if main != "src/index.mjs":
        fail("WORKER_MAIN_INVALID")

    do_bindings = ((config.get("durable_objects") or {}).get("bindings") or [])
    if not any(x.get("name") == REQUIRED_DO_BINDING and x.get("class_name") == REQUIRED_DO_CLASS for x in do_bindings if isinstance(x, dict)):
        fail("DURABLE_OBJECT_BINDING_MISSING")

    migrations = config.get("migrations") or []
    if not any(REQUIRED_DO_CLASS in (x.get("new_sqlite_classes") or []) for x in migrations if isinstance(x, dict)):
        fail("SQLITE_MIGRATION_MISSING")

    r2 = config.get("r2_buckets") or []
    matches = [x for x in r2 if isinstance(x, dict) and x.get("binding") == REQUIRED_R2_BINDING]
    if len(matches) != 1:
        fail("R2_BINDING_INVALID")
    bucket = matches[0].get("bucket_name")
    if not isinstance(bucket, str) or not bucket.strip():
        fail("R2_BUCKET_MISSING")
    if not allow_template and any(marker in bucket.upper() for marker in PLACEHOLDER_MARKERS):
        fail("R2_BUCKET_PLACEHOLDER")

    vars_map = config.get("vars") or {}
    if not isinstance(vars_map, dict):
        fail("VARS_INVALID")
    leaked = sorted(FORBIDDEN_SECRET_KEYS.intersection(vars_map))
    if leaked:
        fail("SECRET_IN_PLAINTEXT_VARS:" + ",".join(leaked))

    skew = int(vars_map.get("AUTH_MAX_SKEW_SECONDS", "300"))
    lease = int(vars_map.get("CLAIM_LEASE_SECONDS", "60"))
    if not 30 <= skew <= 900:
        fail("AUTH_MAX_SKEW_OUT_OF_RANGE")
    if not 5 <= lease <= 300:
        fail("CLAIM_LEASE_OUT_OF_RANGE")

    return {
        "workerName": name,
        "bucketName": bucket,
        "durableObjectBinding": REQUIRED_DO_BINDING,
        "r2Binding": REQUIRED_R2_BINDING,
        "authMaxSkewSeconds": skew,
        "claimLeaseSeconds": lease,
        "templateMode": bool(allow_template),
    }

def main():
    ap = argparse.ArgumentParser(description="Preflight Cloudflare transport gateway config")
    ap.add_argument("--config", required=True)
    ap.add_argument("--allow-template", action="store_true")
    args = ap.parse_args()
    try:
        result = validate(load_toml(args.config), args.allow_template)
    except Exception as exc:
        print(f"CLOUDFLARE_STAGING_PREFLIGHT_BLOCKED: {exc}", file=sys.stderr)
        return 2
    print("CLOUDFLARE_STAGING_PREFLIGHT_PASS")
    for k, v in result.items():
        print(f"{k}={v}")
    return 0

if __name__ == "__main__":
    raise SystemExit(main())
