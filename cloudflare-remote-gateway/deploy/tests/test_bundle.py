import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[4]
PREFLIGHT = ROOT / "cloudflare-remote-gateway" / "deploy" / "preflight.py"
TEMPLATE = ROOT / "cloudflare-remote-gateway" / "deploy" / "wrangler.staging.example.toml"

def run(args):
    return subprocess.run(args, cwd=ROOT, text=True, capture_output=True)

def main():
    p = run([sys.executable, str(PREFLIGHT), "--config", str(TEMPLATE)])
    assert p.returncode == 2
    assert "R2_BUCKET_PLACEHOLDER" in p.stderr

    p = run([sys.executable, str(PREFLIGHT), "--config", str(TEMPLATE), "--allow-template"])
    assert p.returncode == 0
    assert "CLOUDFLARE_STAGING_PREFLIGHT_PASS" in p.stdout

    valid = TEMPLATE.read_text(encoding="utf-8").replace(
        "REPLACE_WITH_PRIVATE_BUCKET", "ones-bigcircle-transport-staging-test"
    )
    with tempfile.TemporaryDirectory() as td:
        cfg = Path(td) / "wrangler.toml"
        cfg.write_text(valid, encoding="utf-8")
        p = run([sys.executable, str(PREFLIGHT), "--config", str(cfg)])
        assert p.returncode == 0

        leaked = valid.replace(
            'CLAIM_LEASE_SECONDS = "60"',
            'CLAIM_LEASE_SECONDS = "60"\nBIGCIRCLE_HMAC_SECRET = "not-allowed"',
        )
        cfg.write_text(leaked, encoding="utf-8")
        p = run([sys.executable, str(PREFLIGHT), "--config", str(cfg)])
        assert p.returncode == 2
        assert "SECRET_IN_PLAINTEXT_VARS" in p.stderr

    print("CLOUDFLARE_STAGING_BUNDLE_P4I_TEST_PASS")
    return 0

if __name__ == "__main__":
    raise SystemExit(main())
