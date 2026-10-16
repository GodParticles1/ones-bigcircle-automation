#!/usr/bin/env python3
"""Issue #112: build a source-bound diagnostic-only unpacked Chrome extension ZIP.

Deliberately separate from the immutable 0.5.17 fresh-install builder.
Produces no installation changes, tokens, databases, jobs or ONES requests.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import uuid
import zipfile

REPO = Path(__file__).resolve().parents[1]
LEGACY = "ec1c6ede144c255ebd8b9918e5a5bca9f907cc7f"
FILES = (
    "manifest.json",
    "service-worker.js",
    "root-cause-writer.js",
    "native-editor-diagnostic.js",
    "popup.html",
    "popup.js",
    "popup.css",
    "README.md",
)
DOC = "release/root-cause-native-diagnostic/START_HERE.md"
FIXED_TIME = (2020, 1, 1, 0, 0, 0)


def git(*args):
    result = subprocess.run(["git", "-C", str(REPO), *args], capture_output=True)
    if result.returncode:
        raise ValueError("SOURCE_GIT_UNAVAILABLE")
    return result.stdout


def source_at(sha, path):
    if not re.fullmatch(r"[0-9a-f]{40}", sha) or ".." in path or path.startswith("/"):
        raise ValueError("SOURCE_PATH_INVALID")
    return git("show", sha + ":" + path)


def read_sources(expected_head):
    actual = git("rev-parse", "HEAD").decode("ascii").strip()
    if actual != expected_head or not re.fullmatch(r"[0-9a-f]{40}", actual):
        raise ValueError("SOURCE_HEAD_MISMATCH")
    # Exact commit objects, not arbitrary working-tree files. Never ship a dirty override.
    source_paths = ["browser-bridge/" + path for path in FILES] + [DOC]
    git("diff", "--exit-code", "HEAD", "--", *source_paths)
    git("diff", "--cached", "--exit-code", "--", *source_paths)
    files = {path: source_at(actual, "browser-bridge/" + path) for path in FILES}
    files["START_HERE.md"] = source_at(actual, DOC)
    legacy_manifest = source_at(LEGACY, "browser-bridge/manifest.json")
    if files["manifest.json"] != legacy_manifest:
        raise ValueError("MANIFEST_PERMISSION_OR_VERSION_DRIFT")
    manifest = json.loads(files["manifest.json"])
    if (manifest.get("manifest_version") != 3 or manifest.get("version") != "0.5.17" or
            manifest.get("background", {}).get("service_worker") != "service-worker.js" or
            manifest.get("action", {}).get("default_popup") != "popup.html"):
        raise ValueError("MANIFEST_CONTRACT_INVALID")
    worker = files["service-worker.js"].decode("utf-8")
    imports = re.findall(r"\bimportScripts\s*\(([^)]*)\)", worker)
    if len(imports) != 1:
        raise ValueError("IMPORT_CONTRACT_INVALID")
    names = re.findall(r"""["']([^"']+)["']""", imports[0])
    if set(names) != {"root-cause-writer.js", "native-editor-diagnostic.js"} or len(names) != 2:
        raise ValueError("IMPORT_CONTRACT_INVALID")
    if any(name not in files for name in names):
        raise ValueError("STARTUP_DEPENDENCY_MISSING")
    popup = files["popup.html"].decode("utf-8")
    if not re.search(r'<script\s+src="popup\.js"', popup) or not re.search(r'href="popup\.css"', popup):
        raise ValueError("POPUP_DEPENDENCY_MISSING")
    if not all(0 < len(value) <= 1024 * 1024 for value in files.values()):
        raise ValueError("SOURCE_FILE_SIZE_INVALID")
    if ('current.writeEnabled = false' not in worker or
            'if (config.writeEnabled !== false)' not in worker or
            'Input.insertText' not in files["native-editor-diagnostic.js"].decode("utf-8")):
        raise ValueError("DIAGNOSTIC_READONLY_GATE_INVARIANT_FAILED")
    return actual, files


def make_archive(output_dir, expected_head):
    if not re.fullmatch(r"[0-9a-f]{40}", expected_head):
        raise ValueError("EXPECTED_HEAD_REQUIRED")
    # Refuse an existing destination of any kind, including the user's installed Relay root.
    destination = Path(output_dir).expanduser().resolve()
    if destination.exists() or destination == REPO or REPO in destination.parents:
        raise ValueError("OUTPUT_ALREADY_EXISTS_OR_IN_SOURCE")
    actual, files = read_sources(expected_head)
    package = "ones-native-editor-diagnostic-CANDIDATE-c" + actual[:12]
    if "b0.5.17" in package or "v0.5.18" in package:
        raise ValueError("MISLEADING_LEGACY_PACKAGE_NAME")
    inventory = [
        {
            "path": path,
            "origin": ("browser-bridge/" + path) if path in FILES else DOC,
            "bytes": len(blob),
            "sha256": hashlib.sha256(blob).hexdigest(),
        }
        for path, blob in sorted(files.items())
    ]
    envelope = {
        "schema": "ones.native-editor-diagnostic-bundle/v1",
        "packageName": package,
        "sourceHead": actual,
        "legacyFrozenHead": LEGACY,
        "role": "DIAGNOSTIC_ONLY_CANDIDATE",
        "operatorRelease": "HOLD_LEADER_REVIEW",
        "realOnesRuntime": "NOT_RUN",
        "writeGate": "OFF",
        "manifestVersionRetained": "0.5.17_NOT_A_PROMOTION",
        "files": inventory,
    }
    files["BUNDLE-MANIFEST.json"] = (json.dumps(envelope, ensure_ascii=False, sort_keys=True,
                                                separators=(",", ":")) + "\n").encode("utf-8")
    destination.parent.mkdir(parents=True, exist_ok=True)
    stage = destination.parent / (".native-diagnostic-stage-" + uuid.uuid4().hex)
    stage.mkdir()
    try:
        target = stage / (package + ".zip")
        with zipfile.ZipFile(target, "w", compression=zipfile.ZIP_DEFLATED,
                             compresslevel=9, allowZip64=False) as archive:
            for path, blob in sorted(files.items()):
                entry = zipfile.ZipInfo(package + "/" + path, FIXED_TIME)
                entry.create_system = 3
                entry.external_attr = 0o100644 << 16
                entry.compress_type = zipfile.ZIP_DEFLATED
                archive.writestr(entry, blob, compress_type=zipfile.ZIP_DEFLATED, compresslevel=9)
        sha = hashlib.sha256(target.read_bytes()).hexdigest()
        (stage / (target.name + ".sha256")).write_text(
            sha + "  " + target.name + "\n", encoding="ascii")
        # Atomic destination creation only; never overwrite or delete prior installations.
        os.rename(stage, destination)
    finally:
        if stage.exists():
            shutil.rmtree(stage)
    print("DIAGNOSTIC_CANDIDATE_BUILD=PASS")
    print("SOURCE_HEAD=" + actual)
    print("PACKAGE=" + str(destination / (package + ".zip")))
    print("SHA256=" + sha)
    print("INVENTORY_FILES=" + str(len(inventory)))
    print("WRITE_GATE=OFF; OPERATOR_RELEASE=HOLD_LEADER_REVIEW")
    return destination / (package + ".zip")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--source-head", required=True)
    parser.add_argument("--output-dir", required=True)
    args = parser.parse_args()
    try:
        make_archive(args.output_dir, args.source_head)
    except (ValueError, OSError, json.JSONDecodeError, UnicodeDecodeError) as error:
        print("DIAGNOSTIC_CANDIDATE_BUILD=BLOCKED " + str(error), file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
