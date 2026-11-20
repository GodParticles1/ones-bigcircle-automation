"""Verify the actual Windows candidate archive and its external reconciliation pairing."""
import argparse
from contextlib import nullcontext
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import zipfile

REPO = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(REPO / "periodic-alignment/tests"))
from test_launch import LAUNCH, snapshot, cases, write_json

RELEASE = "release/windows-agent-v0.1.1"
PACKAGE_SOURCES = {name: f"{RELEASE}/{name}" for name in (
    "config.example.ps1", "setup.ps1", "run-once.ps1", "show-status.ps1", "README.md", "VERSION.json")}
PACKAGE_SOURCES["periodic-alignment/run-once.ps1"] = "periodic-alignment/run-once.ps1"
PAIRED = {"run-stage.ps1", "pipeline.py", "reconcile.py", "observe_inventory.py"}


def sha(data):
    return hashlib.sha256(data).hexdigest()


def git(*args):
    return subprocess.check_output(["git", "-c", f"safe.directory={REPO.as_posix()}", "-C", str(REPO), *args],
                                   text=True).strip()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--zip", type=Path, required=True)
    args = parser.parse_args()
    archive = args.zip.resolve()
    head = git("rev-parse", "HEAD")
    name = f"ones-bigcircle-windows-agent-CANDIDATE-c{head[:12]}"
    assert archive.name == f"{name}.zip"
    digest = sha(archive.read_bytes())
    assert archive.with_suffix(".zip.sha256").read_text().strip() == f"{digest}  {archive.name}"

    with zipfile.ZipFile(archive) as bundle:
        entries = {entry.filename.replace("\\", "/"): entry for entry in bundle.infolist()
                   if not entry.filename.endswith(("/", "\\"))}
        expected = {f"{name}/{path}" for path in PACKAGE_SOURCES} | {f"{name}/BUILD.json"}
        assert set(entries) == expected and len(entries) == len(expected)
        assert sum(not e.filename.endswith(("/", "\\")) for e in bundle.infolist()) == len(expected)
        payloads = {path: bundle.read(entry) for path, entry in entries.items()}
    for relative, source in PACKAGE_SOURCES.items():
        assert payloads[f"{name}/{relative}"] == (REPO / source).read_bytes()
    build = json.loads(payloads[f"{name}/BUILD.json"].decode("utf-8-sig"))
    assert build["releaseStatus"] == "CANDIDATE" and build["candidateName"] == name
    assert build["packageCandidateSha"] == head and build["onesMutation"] is False
    assert build["version"] == "0.1.1" and build["mode"] == "LOCAL_PROVIDER_NEUTRAL"
    assert all(build[key] is False for key in ("remoteBaseUrlRequired", "cloudflareApiKeyRequired", "httpsTransportRequired"))
    pair = {entry["file"]: entry for entry in build["pairedReconciliation"]}
    assert set(pair) == PAIRED and len(build["pairedReconciliation"]) == len(PAIRED)
    for file, record in pair.items():
        assert record["sha256"] == sha((REPO / "reconciliation" / file).read_bytes())
        assert record["gitBlob"] == git("rev-parse", f"{head}:reconciliation/{file}")

    env = {k: v for k, v in os.environ.items() if k.upper() != "PSMODULEPATH"}
    env.update(GIT_CONFIG_COUNT="1", GIT_CONFIG_KEY_0="safe.directory", GIT_CONFIG_VALUE_0=REPO.as_posix())
    retry = subprocess.run(["powershell.exe", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File",
                            str(REPO / "scripts/build-windows-local-agent-package.ps1"), "-OutputDir", str(archive.parent)],
                           env=env, capture_output=True, timeout=35)
    assert retry.returncode != 0 and b"CANDIDATE_OUTPUT_EXISTS" in retry.stderr
    assert sha(archive.read_bytes()) == digest

    reuse = os.environ.get("QT_ONES_SYNTHETIC_DIR")
    with (nullcontext(reuse) if reuse else tempfile.TemporaryDirectory()) as temp:
        fixture = Path(temp).resolve()
        fixture.mkdir(parents=True, exist_ok=True)
        marker = fixture / ".synthetic-periodic-fixture-v1"
        assert not any(fixture.iterdir()) or marker.is_file()
        marker.touch(exist_ok=True)
        token = fixture / "relay/data/relay-token.txt"
        token.parent.mkdir(parents=True, exist_ok=True)
        if not token.exists():
            token.write_text("synthetic", encoding="ascii")
        assert token.read_text().strip() == "synthetic"
        (fixture / "feed").mkdir(exist_ok=True)
        feed = cases()
        feed.update(schema="bigcircle.confirmed-case-export/v1alpha1", complete=True,
                    exportedCaseCount=len(feed["cases"]))
        for row in feed["cases"]:
            row["caseStatus"] = "CONFIRMED_REAL_CASE"
        write_json(fixture / "feed/feed.json", feed)
        write_json(fixture / "input.json", snapshot("candidate-synthetic"))

        run_dir = Path(tempfile.mkdtemp(prefix="bundle-launch-", dir=fixture))
        for path, payload in payloads.items():
            target = run_dir / path
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(payload)
        stage = run_dir / name
        help_result = subprocess.run(["powershell.exe", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File",
                                      str(stage / "show-status.ps1")], env=env, capture_output=True, timeout=20)
        assert help_result.returncode == 2 and head.encode() in help_result.stdout
        assert b"PACKAGE_STATUS=CANDIDATE" in help_result.stdout
        (stage / "config.ps1").write_text("$CaseFeedDir = './feed'\n$RelayDir = './relay'\n$RuntimeDir = './runtime'\n",
                                         encoding="ascii")
        mock = run_dir / "mock.ps1"
        launch = LAUNCH.replace("launch-harness/", stage.relative_to(fixture).as_posix() + "/").replace(
            "(Split-Path $Reconciliation -Leaf) -eq 'legacy-reconciliation'",
            "(Split-Path $Reconciliation -Leaf) -eq 'wrong-pair'")
        mock.write_text(launch, encoding="utf-8-sig")
        wrong = run_dir / "wrong-pair"
        wrong.mkdir()
        for file in PAIRED:
            shutil.copyfile(REPO / "reconciliation" / file, wrong / file)
        # The wrong helper still supports the same options, so a CLI compatibility probe alone would pass.
        with (wrong / "observe_inventory.py").open("ab") as handle:
            handle.write(b"\n# synthetic identity mismatch\n")
        runtime = fixture / "runtime"
        observation = runtime / "uuid-observation.json"
        receipts = []

        def launch_run(label, reconciliation, assignee=None):
            command = ["powershell.exe", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", str(mock),
                       str(stage / "periodic-alignment/run-once.ps1"), str(fixture), str(reconciliation)]
            proc = subprocess.run(command + ([assignee] if assignee else []), env=env, capture_output=True, timeout=35)
            result = json.loads(proc.stdout.decode("utf-8-sig").splitlines()[-1])
            receipts.append({"label": label, "exit": proc.returncode, "result": result})
            return proc.returncode, result

        def full_files():
            return {p.relative_to(runtime): p.read_bytes() for p in runtime.rglob("*") if p.is_file()
                    and p.name not in ("uuid-observation.json", "uuid-observation.lock")}

        old = observation.read_bytes() if observation.exists() else None
        code, default = launch_run("default", REPO / "reconciliation")
        assert code == 0 and default["status"] in ("RECONCILIATION_VERIFIED", "RECONCILIATION_NOOP_VERIFIED")
        assert (observation.read_bytes() if observation.exists() else None) == old
        before = full_files()
        code, observed = launch_run("observe", REPO / "reconciliation", "bundle-user")
        assert code == 0 and observed["status"] == "READONLY_UUID_OBSERVATION"
        assert full_files() == before
        prior = observation.read_bytes()
        code, blocked = launch_run("wrong-pair", wrong, "bundle-user")
        assert code == 2 and blocked["reason"] == "RECONCILIATION_PAIR_MISMATCH"
        assert blocked["requiredFile"] == "observe_inventory.py" and blocked["packageCandidateSha"] == head
        assert full_files() == before and observation.read_bytes() == prior

    assert sha(archive.read_bytes()) == digest
    print(json.dumps({"sourceHead": head, "name": name, "sha256": digest, "zipFiles": len(expected),
                      "pairedFiles": len(pair), "overwriteBlockedExit": retry.returncode,
                      "showStatusExitWithoutConfig": help_result.returncode, "launchReceipts": receipts}))


if __name__ == "__main__":
    main()
