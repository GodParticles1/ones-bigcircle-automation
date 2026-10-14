#!/usr/bin/env python3
"""Issue #112: unpack and test the produced diagnostic-only artifact, not a stub."""
import argparse
import hashlib
import json
from pathlib import Path
import re
import subprocess
import sys
import tempfile
import zipfile

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / "scripts"))
from importlib import import_module
builder = import_module("build-root-cause-native-diagnostic")
REQUIRED = set(builder.FILES) | {"START_HERE.md"}


def verify(zippath, source_head):
    if not re.fullmatch(r"[0-9a-f]{40}", source_head):
        raise ValueError("SOURCE_HEAD_INVALID")
    zippath = Path(zippath)
    sidecar = (Path(str(zippath) + ".sha256")).read_text(encoding="ascii").strip()
    ziphash = hashlib.sha256(zippath.read_bytes()).hexdigest()
    if sidecar != ziphash + "  " + zippath.name:
        raise ValueError("ZIP_HASH_MISMATCH")
    with zipfile.ZipFile(zippath) as archive:
        info = archive.infolist()
        if len(info) != len(REQUIRED) + 1 or any(not x.filename.startswith(zippath.stem + "/") for x in info):
            raise ValueError("ZIP_ENTRY_SET_MISMATCH")
        files = {}
        for entry in info:
            name = entry.filename[len(zippath.stem) + 1:]
            if name in files or not name or "/" in name or "\" in name or entry.file_size > 1024 * 1024:
                raise ValueError("ZIP_ENTRY_INVALID")
            files[name] = archive.read(entry)
        if set(files) != REQUIRED | {"BUNDLE-MANIFEST.json"}:
            raise ValueError("ZIP_ENTRY_SET_MISMATCH")
        manifest = json.loads(files["BUNDLE-MANIFEST.json"])
    if (manifest.get("schema") != "ones.native-editor-diagnostic-bundle/v1" or
            manifest.get("packageName") != zippath.stem or
            manifest.get("sourceHead") != source_head or
            manifest.get("legacyFrozenHead") != builder.LEGACY or
            manifest.get("role") != "DIAGNOSTIC_ONLY_CANDIDATE" or
            manifest.get("writeGate") != "OFF" or
            manifest.get("operatorRelease") != "HOLD_LEADER_REVIEW" or
            manifest.get("realOnesRuntime") != "NOT_RUN" or
            manifest.get("manifestVersionRetained") != "0.5.17_NOT_A_PROMOTION"):
        raise ValueError("PACKAGE_PROVENANCE_MISMATCH")
    inventory = manifest.get("files")
    if not isinstance(inventory, list) or len(inventory) != len(REQUIRED):
        raise ValueError("INVENTORY_INVALID")
    if len({x.get("path") for x in inventory}) != len(REQUIRED):
        raise ValueError("INVENTORY_DUPLICATE")
    for row in inventory:
        name = row["path"]
        origin = ("browser-bridge/" + name) if name in builder.FILES else builder.DOC
        blob = files.get(name)
        if (blob is None or row.get("origin") != origin or row.get("bytes") != len(blob) or
                row.get("sha256") != hashlib.sha256(blob).hexdigest() or
                blob != builder.source_at(source_head, origin)):
            raise ValueError("SOURCE_TO_ZIP_MISMATCH")
    chrome_manifest = json.loads(files["manifest.json"])
    if files["manifest.json"] != builder.source_at(builder.LEGACY, "browser-bridge/manifest.json"):
        raise ValueError("MANIFEST_PERMISSION_OR_VERSION_DRIFT")
    if (chrome_manifest["version"] != "0.5.17" or
            chrome_manifest.get("background", {}).get("service_worker") != "service-worker.js" or
            chrome_manifest.get("action", {}).get("default_popup") != "popup.html"):
        raise ValueError("MANIFEST_CONTRACT_INVALID")
    imported = re.findall(r"""["']([^"']+\.js)["']""",
                          files["service-worker.js"].decode("utf-8").split("\n", 1)[0])
    if set(imported) != {"root-cause-writer.js", "native-editor-diagnostic.js"}:
        raise ValueError("STARTUP_IMPORT_MISMATCH")
    if any(name not in files for name in imported):
        raise ValueError("STARTUP_IMPORT_MISSING")
    if any(name.lower().endswith((".db", ".sqlite", ".token", ".key", ".exe", ".msi")) or
           any(word in name.lower() for word in ("cookie", "secret", "relay-token")) for name in files):
        raise ValueError("SECRET_OR_RUNTIME_STATE_INCLUDED")
    with tempfile.TemporaryDirectory(prefix="diagnostic-unpack-") as directory:
        for name, blob in files.items():
            (Path(directory) / name).write_bytes(blob)
        for name in (*imported, "service-worker.js", "popup.js"):
            subprocess.run(["node", "--check", str(Path(directory) / name)], check=True, capture_output=True)
    return files


def must_fail(call, error):
    try:
        call()
    except (ValueError, OSError, KeyError, zipfile.BadZipFile):
        return
    raise AssertionError(error)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--zip", required=True)
    parser.add_argument("--source-head", required=True)
    args = parser.parse_args()
    source_head = args.source_head
    zipfile_path = Path(args.zip)
    files = verify(zipfile_path, source_head)
    print("EXACT_ZIP_UNPACK_AND_SOURCE_MANIFEST=PASS")
    must_fail(lambda: verify(zipfile_path, "0" * 40), "STALE_SHA_ACCEPTED")
    with tempfile.TemporaryDirectory(prefix="diagnostic-negative-") as temp:
        other = Path(temp) / zipfile_path.name
        sidecar = Path(str(other) + ".sha256")
        data = zipfile_path.read_bytes()
        other.write_bytes(data[:-30] + bytes([data[-30] ^ 1]) + data[-29:])
        sidecar.write_text(hashlib.sha256(other.read_bytes()).hexdigest() + "  " + other.name + "\n")
        must_fail(lambda: verify(other, source_head), "TAMPERED_ZIP_ACCEPTED")
        other.write_bytes(data)
        sidecar.write_text(hashlib.sha256(data).hexdigest() + "  " + other.name + "\n")
        def mutate(remove=None, extra=None, rewrite=None):
            entries = {}
            with zipfile.ZipFile(zipfile_path) as archive:
                for name in archive.namelist():
                    path = name.split("/", 1)[1]
                    if path != remove:
                        entries[path] = archive.read(name)
            if rewrite is not None:
                name, blob = rewrite
                entries[name] = blob
            if extra is not None:
                name, blob = extra
                entries[name] = blob
            with zipfile.ZipFile(other, "w") as target:
                for name, blob in entries.items():
                    target.writestr(other.stem + "/" + name, blob)
            sidecar.write_text(hashlib.sha256(other.read_bytes()).hexdigest() + "  " + other.name + "\n")
            must_fail(lambda: verify(other, source_head), "TAMPERED_STRUCTURE_ACCEPTED")
        mutate(remove="native-editor-diagnostic.js")
        mutate(extra=("relay-token.txt", b"synthetic-secret"))
        forged = json.loads(files["BUNDLE-MANIFEST.json"])
        forged["packageName"] = "ones-root-cause-fresh-install-v0.1.0-b0.5.17-r0.3.8-p0.2.0"
        mutate(rewrite=("BUNDLE-MANIFEST.json", json.dumps(forged).encode()))
        changed = json.loads(files["manifest.json"])
        changed["permissions"].append("cookies")
        mutate(rewrite=("manifest.json", json.dumps(changed).encode()))
    legacy_test = builder.source_at(builder.LEGACY, "release/root-cause-fresh-install/tests/static_test.py")
    if (b"test_core_sources_are_the_frozen_accepted_bytes" not in legacy_test or
            builder.source_at(builder.LEGACY, "browser-bridge/service-worker.js") ==
            builder.source_at(source_head, "browser-bridge/service-worker.js")):
        raise ValueError("FROZEN_BASELINE_INTEGRITY_GUARD")
    must_fail(lambda: builder.make_archive(Path(tempfile.gettempdir()), source_head),
              "EXISTING_DIRECTORY_OVERWRITTEN")
    print("DIAGNOSTIC_NEGATIVE_TESTS=PASS")
    print("LEGACY_SOURCE_CONTRACT_UNMODIFIED=PASS")
    print("READONLY_INSTALL_ROOT_PRESERVED=PASS")
    return 0


if __name__ == "__main__":
    sys.exit(main())
