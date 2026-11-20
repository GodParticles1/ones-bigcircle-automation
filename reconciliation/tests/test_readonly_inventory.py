import json
import subprocess
import sys
import tempfile
import unittest
from copy import deepcopy
from pathlib import Path

from test_pipeline import ROOT, cases, inv, run_pipeline, write_json
from pipeline import make_run_key, sha256_file


def snapshot(*uuids):
    doc = inv()
    doc.update(readOnly=True, scope=dict(teamUuid="team", projectUuid="project",
               issueTypeUuid="type", assigneeDepartmentUuid="dept"))
    doc["schemaVersion"] = "ones.external-ticket-inventory/v1alpha1"
    doc["tickets"] = [dict(doc["tickets"][0], onesTaskUuid=uid) for uid in uuids]
    doc["ticketCount"] = doc["serverTotalCount"] = doc["visiblePageTotal"] = len(uuids)
    doc["pages"] = [dict(pageNumber=i + 1, startPos=i, endPos=i + 1, pageCount=1,
                         totalCount=len(uuids), hasNextPage=i + 1 < len(uuids),
                         cursorIn=f"p{i}" if i else None, endCursor=f"p{i+1}")
                    for i in range(len(uuids))]
    if not uuids:
        doc["pages"].append(dict(pageNumber=1, startPos=0, endPos=0, pageCount=0,
                                 totalCount=0, hasNextPage=False, cursorIn=None, endCursor=None))
    doc["pageCount"] = len(doc["pages"])
    return doc


class ReadOnlyInventory(unittest.TestCase):
    def setUp(self):
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        self.root = Path(temp.name)
        self.feed = self.root / "cases.json"
        self.inventory = self.root / "inventory.json"
        self.state = self.root / "state"
        self.output = self.root / "output"
        write_json(self.feed, cases())
        self.align(snapshot("original"))
        self.before = self.saved()

    def align(self, doc):
        write_json(self.inventory, doc)
        return run_pipeline(self.feed, self.inventory, self.state, self.output)

    def saved(self):
        return {p: p.read_bytes() for d in (self.state, self.output) for p in d.iterdir()}

    def test_duplicate_with_matching_counts(self):
        with self.assertRaisesRegex(ValueError, "inventory gate failed"):
            self.align(snapshot("same", "same"))
        self.assertEqual(self.saved(), self.before)

    def test_missing_middle_page_with_matching_counts(self):
        doc = snapshot("a", "b", "c")
        del doc["pages"][1]
        doc["pageCount"] = 2
        with self.assertRaisesRegex(ValueError, "inventory gate failed"):
            self.align(doc)
        self.assertEqual(self.saved(), self.before)

    def observe(self, doc, previous=None, assignee="user-a", ok=True):
        write_json(self.inventory, doc)
        command = [sys.executable, "-B", str(ROOT / "observe_inventory.py"),
                   "--inventory", str(self.inventory), "--assignee", assignee]
        if previous is not None:
            prior = self.root / "previous.json"
            write_json(prior, previous)
            command.extend(["--previous", str(prior)])
        proc = subprocess.run(command, capture_output=True, text=True)
        self.assertEqual(proc.returncode, 0 if ok else 2, proc.stderr)
        self.assertEqual(self.saved(), self.before)
        if ok:
            return json.loads(proc.stdout)
        self.assertEqual(proc.stdout, "")
        self.assertIn("inventory", proc.stderr.lower())

    def test_scope_baseline_and_uuid_history(self):
        base = self.observe(snapshot("b", "a"))
        self.assertTrue(base["baseline"])
        self.assertEqual(base["newTaskUuids"], [])
        self.assertEqual(base["seenTaskUuids"], ["a", "b"])
        next_seen = self.observe(snapshot("c", "a"), base)
        self.assertEqual(next_seen["newTaskUuids"], ["c"])
        self.assertEqual(self.observe(snapshot("b", "c", "a"), next_seen)["newTaskUuids"], [])
        self.assertEqual(self.observe(snapshot(), base)["seenTaskUuids"], ["a", "b"])
        for key in ("teamUuid", "projectUuid", "issueTypeUuid", "assigneeDepartmentUuid"):
            changed = snapshot("different")
            changed["scope"][key] = "another"
            with self.subTest(key=key):
                fresh = self.observe(changed, base)
                self.assertTrue(fresh["baseline"])
                self.assertEqual(fresh["newTaskUuids"], [])
                self.assertEqual(fresh["seenTaskUuids"], ["different"])
        changed = self.observe(snapshot("b"), base, "another-user")
        self.assertTrue(changed["baseline"])
        self.assertEqual(changed["seenTaskUuids"], [])
        with self.assertRaisesRegex(ValueError, "inventory gate failed"):
            self.align(next_seen)
        self.assertEqual(self.saved(), self.before)

    def test_native_receipts_and_legacy_inventory(self):
        legacy = inv()
        legacy["schemaVersion"] = "ones.external-ticket-inventory/v1alpha1"
        self.assertEqual(self.align(legacy)["status"], "RECONCILIATION_VERIFIED")
        native = snapshot("a")
        native.update(queryMode="page_native_cursor_pagination_limit_10000_50", pageSize=50, httpStatuses=[200])
        native["pages"][0]["httpStatus"] = 200
        self.assertEqual(self.align(native)["status"], "RECONCILIATION_VERIFIED")
        self.before = self.saved()
        self.assertEqual(self.observe(native)["seenTaskUuids"], ["a"])
        for field, value in (("queryMode", "unknown"), ("pageSize", 100), ("httpStatuses", [503]),
                             ("httpStatuses", None), ("readOnly", "false")):
            with self.subTest(field=field, value=value):
                bad = dict(native, **{field: value})
                with self.assertRaisesRegex(ValueError, "inventory gate failed"):
                    self.align(bad)
                self.observe(bad, ok=False)
        failed_page = deepcopy(native)
        failed_page["pages"][0]["httpStatus"] = 503
        failed_page["httpStatuses"] = [503]
        with self.assertRaisesRegex(ValueError, "inventory gate failed"):
            self.align(failed_page)
        for hint in ("queryMode", "pageSize", "httpStatuses"):
            without_pages = dict(legacy, **{hint: native[hint]})
            with self.subTest(missing_pages=hint), self.assertRaisesRegex(ValueError, "inventory gate failed"):
                self.align(without_pages)
        self.assertEqual(self.saved(), self.before)

    def test_conflicting_project_and_unknown_assignee(self):
        doc = snapshot("a", "b")
        doc["tickets"][1]["assignee"] = None
        self.assertEqual(self.observe(doc)["seenTaskUuids"], ["a"])
        doc["tickets"][1]["assignee"] = {"name": "Engineer-B", "uuid": None}
        self.observe(doc, ok=False)
        doc = snapshot("a")
        doc["tickets"][0]["project"] = {"uuid": "outside"}
        self.observe(doc, ok=False)
        with self.assertRaisesRegex(ValueError, "inventory gate failed"):
            self.align(doc)
        self.assertEqual(self.saved(), self.before)

    def test_old_checkpoint_cannot_bypass_new_inventory_gate(self):
        bad = snapshot("a", "a")
        write_json(self.inventory, bad)
        checkpoint_path = self.state / "reconciliation-checkpoint.json"
        checkpoint = json.loads(checkpoint_path.read_text(encoding="utf-8"))
        checkpoint["runKey"] = make_run_key(sha256_file(self.feed), sha256_file(self.inventory), None)
        write_json(checkpoint_path, checkpoint)
        old_state = self.saved()
        with self.assertRaisesRegex(ValueError, "duplicate task UUID"):
            self.align(bad)
        self.assertEqual(self.saved(), old_state)

    def test_incomplete_reads_never_advance(self):
        base = self.observe(snapshot("a"))
        partial = snapshot("b")
        partial["inventoryComplete"] = False
        gap = snapshot("b", "c")
        gap["pages"].pop()
        for bad in (partial, gap, snapshot("b", "b")):
            self.observe(bad, base, ok=False)
        self.assertEqual(self.observe(snapshot("a", "b"), base)["newTaskUuids"], ["b"])


if __name__ == "__main__":
    unittest.main()
