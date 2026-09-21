#!/usr/bin/env python3
import pathlib, re, sys

ROOT = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else ".").resolve()
blocked_names = [
    re.compile(r"ones-external-ticket-inventory-.*\.json$", re.I),
    re.compile(r"bigcircle-.*confirmed-cases-.*\.json$", re.I),
    re.compile(r".*reconciliation-\d{8}.*\.json$", re.I),
    re.compile(r"relay-token\.txt$", re.I),
]
blocked_text = [
    re.compile(r"Authorization:\s*Bearer\s+\S+", re.I),
    re.compile(r"Cookie:\s*\S+", re.I),
    re.compile(r"BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY"),
]
failures=[]
for p in ROOT.rglob("*"):
    if not p.is_file() or ".git" in p.parts:
        continue
    rel=p.relative_to(ROOT)
    if rel.as_posix() == "scripts/repo_guard.py":
        continue
    if any(rx.match(p.name) for rx in blocked_names):
        failures.append(f"blocked file name: {rel}")
        continue
    if p.stat().st_size > 2_000_000:
        continue
    try:
        text=p.read_text(encoding="utf-8")
    except Exception:
        continue
    for rx in blocked_text:
        if rx.search(text): failures.append(f"blocked secret-like text: {rel}")
if failures:
    print("PUBLIC_REPO_GUARD=FAIL")
    for f in failures: print(f)
    raise SystemExit(1)
print("PUBLIC_REPO_GUARD=PASS")
