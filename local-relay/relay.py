#!/usr/bin/env python3
import argparse
import hmac
import json
import logging
import logging.handlers
import os
import secrets
import sqlite3
import sys
import threading
import time
import uuid
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse

VERSION = "0.2.1"
DEFAULT_PORT = 18731
MAX_BODY_BYTES = 256 * 1024
TOKEN_HEADER = "X-Relay-Token"
ALLOWED_JOB_TYPES = {"RELAY_PING", "ONES_INVENTORY_READ"}
STATIC_TERMINAL_STATES = {
    "RELAY_PING_OK",
    "INPUT_REJECTED",
    "EXECUTOR_ERROR",
    "ONES_TAB_UNAVAILABLE",
    "ONES_LOGIN_REQUIRED",
    "INVENTORY_PAGE_NOT_READY",
}
ERROR_LOG_MAX_BYTES = 128 * 1024
ERROR_LOG_BACKUPS = 1
ERROR_LOG_RETENTION_SECONDS = 7 * 24 * 60 * 60
ERROR_LOG_CLEAN_INTERVAL_SECONDS = 6 * 60 * 60


def terminal_status_allowed(status):
    return isinstance(status, str) and (
        status in STATIC_TERMINAL_STATES or status.startswith("INVENTORY_")
    )


def utc_now():
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def cleanup_error_logs(log_file: Path):
    now = time.time()
    for path in (log_file, Path(str(log_file) + ".1")):
        try:
            if not path.exists():
                continue
            if now - path.stat().st_mtime > ERROR_LOG_RETENTION_SECONDS:
                path.unlink()
        except OSError:
            pass


def build_error_logger(log_file: Path):
    log_file.parent.mkdir(parents=True, exist_ok=True)
    cleanup_error_logs(log_file)
    logger = logging.getLogger("ones-local-relay")
    logger.setLevel(logging.ERROR)
    logger.handlers.clear()
    handler = logging.handlers.RotatingFileHandler(
        log_file,
        maxBytes=ERROR_LOG_MAX_BYTES,
        backupCount=ERROR_LOG_BACKUPS,
        encoding="utf-8",
    )
    handler.setLevel(logging.ERROR)
    handler.setFormatter(logging.Formatter("%(asctime)sZ %(levelname)s %(message)s", "%Y-%m-%dT%H:%M:%S"))
    logger.addHandler(handler)
    logger.propagate = False
    return logger


class RelayStore:
    def __init__(self, db_path: Path):
        self.db_path = db_path
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        self._init_db()

    def _connect(self):
        conn = sqlite3.connect(self.db_path, timeout=10, isolation_level=None)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA journal_mode=WAL")
        conn.execute("PRAGMA foreign_keys=ON")
        conn.execute("PRAGMA busy_timeout=5000")
        return conn

    def _init_db(self):
        with self._connect() as conn:
            conn.executescript(
                """
                CREATE TABLE IF NOT EXISTS jobs (
                    job_id TEXT PRIMARY KEY,
                    job_type TEXT NOT NULL,
                    idempotency_key TEXT NOT NULL UNIQUE,
                    payload_json TEXT NOT NULL,
                    state TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL,
                    claimed_at TEXT,
                    executor_id TEXT,
                    result_json TEXT
                );
                CREATE INDEX IF NOT EXISTS idx_jobs_state_created
                    ON jobs(state, created_at);
                CREATE TABLE IF NOT EXISTS executor_heartbeats (
                    executor_id TEXT PRIMARY KEY,
                    extension_version TEXT,
                    capabilities_json TEXT NOT NULL,
                    ones_tab_count INTEGER NOT NULL DEFAULT 0,
                    last_seen_at TEXT NOT NULL
                );
                """
            )

    @staticmethod
    def _job_dict(row):
        if row is None:
            return None
        return {
            "jobId": row["job_id"],
            "jobType": row["job_type"],
            "idempotencyKey": row["idempotency_key"],
            "payload": json.loads(row["payload_json"]),
            "state": row["state"],
            "createdAt": row["created_at"],
            "updatedAt": row["updated_at"],
            "claimedAt": row["claimed_at"],
            "executorId": row["executor_id"],
            "result": json.loads(row["result_json"]) if row["result_json"] else None,
        }

    def enqueue(self, job_type, idempotency_key, payload, requested_job_id=None):
        if job_type not in ALLOWED_JOB_TYPES:
            raise ValueError("unsupported jobType")
        if not isinstance(idempotency_key, str) or not idempotency_key.strip() or len(idempotency_key) > 200:
            raise ValueError("idempotencyKey must be 1-200 characters")
        if not isinstance(payload, dict):
            raise ValueError("payload must be an object")
        job_id = requested_job_id or str(uuid.uuid4())
        now = utc_now()
        payload_json = json.dumps(payload, ensure_ascii=False, separators=(",", ":"))
        with self._connect() as conn:
            try:
                conn.execute(
                    """INSERT INTO jobs(job_id, job_type, idempotency_key, payload_json, state, created_at, updated_at)
                       VALUES(?,?,?,?,?,?,?)""",
                    (job_id, job_type, idempotency_key.strip(), payload_json, "PENDING", now, now),
                )
                row = conn.execute("SELECT * FROM jobs WHERE job_id=?", (job_id,)).fetchone()
                return self._job_dict(row), False
            except sqlite3.IntegrityError:
                row = conn.execute("SELECT * FROM jobs WHERE idempotency_key=?", (idempotency_key.strip(),)).fetchone()
                if row is None:
                    raise
                return self._job_dict(row), True

    def claim(self, executor_id, capabilities):
        if not isinstance(executor_id, str) or not executor_id.strip() or len(executor_id) > 200:
            raise ValueError("executorId required")
        accepted = sorted(set(capabilities or []) & ALLOWED_JOB_TYPES)
        if not accepted:
            return None
        placeholders = ",".join("?" for _ in accepted)
        now = utc_now()
        with self._connect() as conn:
            conn.execute("BEGIN IMMEDIATE")
            row = conn.execute(
                f"SELECT * FROM jobs WHERE state='PENDING' AND job_type IN ({placeholders}) ORDER BY created_at, job_id LIMIT 1",
                accepted,
            ).fetchone()
            if row is None:
                conn.execute("COMMIT")
                return None
            updated = conn.execute(
                """UPDATE jobs SET state='CLAIMED', claimed_at=?, updated_at=?, executor_id=?
                   WHERE job_id=? AND state='PENDING'""",
                (now, now, executor_id.strip(), row["job_id"]),
            )
            if updated.rowcount != 1:
                conn.execute("ROLLBACK")
                return None
            row = conn.execute("SELECT * FROM jobs WHERE job_id=?", (row["job_id"],)).fetchone()
            conn.execute("COMMIT")
            return self._job_dict(row)

    def submit_result(self, job_id, executor_id, status, result):
        if not terminal_status_allowed(status):
            raise ValueError("unsupported result status")
        if not isinstance(result, dict):
            raise ValueError("result must be an object")
        now = utc_now()
        result_json = json.dumps(result, ensure_ascii=False, separators=(",", ":"))
        with self._connect() as conn:
            conn.execute("BEGIN IMMEDIATE")
            row = conn.execute("SELECT * FROM jobs WHERE job_id=?", (job_id,)).fetchone()
            if row is None:
                conn.execute("ROLLBACK")
                return None, "NOT_FOUND"
            if row["state"] != "CLAIMED":
                conn.execute("ROLLBACK")
                return self._job_dict(row), "NOT_CLAIMED"
            if row["executor_id"] != executor_id:
                conn.execute("ROLLBACK")
                return self._job_dict(row), "EXECUTOR_MISMATCH"
            conn.execute(
                "UPDATE jobs SET state=?, result_json=?, updated_at=? WHERE job_id=?",
                (status, result_json, now, job_id),
            )
            row = conn.execute("SELECT * FROM jobs WHERE job_id=?", (job_id,)).fetchone()
            conn.execute("COMMIT")
            return self._job_dict(row), None

    def get_job(self, job_id):
        with self._connect() as conn:
            row = conn.execute("SELECT * FROM jobs WHERE job_id=?", (job_id,)).fetchone()
            return self._job_dict(row)

    def heartbeat(self, executor_id, extension_version, capabilities, ones_tab_count):
        if not isinstance(executor_id, str) or not executor_id.strip():
            raise ValueError("executorId required")
        now = utc_now()
        caps_json = json.dumps(sorted(set(capabilities or [])), separators=(",", ":"))
        with self._connect() as conn:
            conn.execute(
                """INSERT INTO executor_heartbeats(executor_id, extension_version, capabilities_json, ones_tab_count, last_seen_at)
                   VALUES(?,?,?,?,?)
                   ON CONFLICT(executor_id) DO UPDATE SET
                     extension_version=excluded.extension_version,
                     capabilities_json=excluded.capabilities_json,
                     ones_tab_count=excluded.ones_tab_count,
                     last_seen_at=excluded.last_seen_at""",
                (executor_id.strip(), extension_version, caps_json, int(ones_tab_count or 0), now),
            )
        return {"executorId": executor_id.strip(), "lastSeenAt": now}

    def stats(self):
        with self._connect() as conn:
            counts = {row["state"]: row["n"] for row in conn.execute("SELECT state, COUNT(*) n FROM jobs GROUP BY state")}
            heartbeats = [
                {
                    "executorId": row["executor_id"],
                    "extensionVersion": row["extension_version"],
                    "capabilities": json.loads(row["capabilities_json"]),
                    "onesTabCount": row["ones_tab_count"],
                    "lastSeenAt": row["last_seen_at"],
                }
                for row in conn.execute("SELECT * FROM executor_heartbeats ORDER BY last_seen_at DESC LIMIT 10")
            ]
        return {"version": VERSION, "jobsByState": counts, "executors": heartbeats}


class RelayApp:
    def __init__(self, data_dir: Path, port: int, logger, error_log_path: Path):
        self.data_dir = data_dir
        self.port = port
        self.logger = logger
        self.error_log_path = error_log_path
        self.data_dir.mkdir(parents=True, exist_ok=True)
        self.token_path = self.data_dir / "relay-token.txt"
        self.db_path = self.data_dir / "relay.db"
        self.pid_path = self.data_dir / "relay.pid"
        self.token = self._load_or_create_token()
        self.store = RelayStore(self.db_path)
        self.pid_path.write_text(str(os.getpid()), encoding="utf-8")
        self._stop_cleaner = threading.Event()
        self._cleaner = threading.Thread(target=self._cleanup_loop, name="relay-log-cleaner", daemon=True)
        self._cleaner.start()

    def _load_or_create_token(self):
        if self.token_path.exists():
            token = self.token_path.read_text(encoding="utf-8").strip()
            if len(token) >= 32:
                return token
            raise RuntimeError(f"invalid token file: {self.token_path}")
        token = secrets.token_urlsafe(32)
        self.token_path.write_text(token + "\n", encoding="utf-8")
        try:
            os.chmod(self.token_path, 0o600)
        except OSError:
            pass
        return token

    def token_matches(self, supplied):
        return isinstance(supplied, str) and hmac.compare_digest(supplied, self.token)

    def _cleanup_loop(self):
        while not self._stop_cleaner.wait(ERROR_LOG_CLEAN_INTERVAL_SECONDS):
            cleanup_error_logs(self.error_log_path)

    def cleanup(self):
        self._stop_cleaner.set()
        try:
            if self.pid_path.exists() and self.pid_path.read_text(encoding="utf-8").strip() == str(os.getpid()):
                self.pid_path.unlink()
        except OSError:
            pass


class RelayHandler(BaseHTTPRequestHandler):
    server_version = "ONESLocalRelay/0.2.1"

    @property
    def app(self):
        return self.server.app

    def log_message(self, fmt, *args):
        # Deliberately no routine HTTP access log. Relay keeps only necessary errors.
        return

    def _cors(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", f"Content-Type, {TOKEN_HEADER}")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Cache-Control", "no-store")

    def _json(self, status, payload):
        raw = json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
        self.send_response(status)
        self._cors()
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)

    def _empty(self, status=204):
        self.send_response(status)
        self._cors()
        self.send_header("Content-Length", "0")
        self.end_headers()

    def _authorized(self):
        token = self.headers.get(TOKEN_HEADER)
        if self.app.token_matches(token):
            return True
        self._json(401, {"ok": False, "error": "UNAUTHORIZED"})
        return False

    def _body_json(self):
        length = int(self.headers.get("Content-Length", "0") or 0)
        if length <= 0 or length > MAX_BODY_BYTES:
            raise ValueError("invalid content length")
        raw = self.rfile.read(length)
        obj = json.loads(raw.decode("utf-8"))
        if not isinstance(obj, dict):
            raise ValueError("JSON body must be an object")
        return obj

    def do_OPTIONS(self):
        self._empty(204)

    def do_GET(self):
        path = urlparse(self.path).path
        if path == "/health":
            self._json(200, {
                "ok": True,
                "service": "ones-local-relay",
                "version": VERSION,
                "pid": os.getpid(),
                "bind": f"127.0.0.1:{self.app.port}",
                "allowedJobTypes": sorted(ALLOWED_JOB_TYPES),
            })
            return
        if not self._authorized():
            return
        if path == "/v1/stats":
            self._json(200, {"ok": True, **self.app.store.stats()})
            return
        prefix = "/v1/jobs/"
        if path.startswith(prefix) and len(path) > len(prefix):
            job = self.app.store.get_job(path[len(prefix):])
            self._json(404, {"ok":False, "error":"NOT_FOUND"}) if job is None else self._json(200, {"ok":True, "job":job})
            return
        self._json(404, {"ok": False, "error": "NOT_FOUND"})

    def do_POST(self):
        path = urlparse(self.path).path
        if not self._authorized():
            return
        try:
            body = self._body_json()
        except Exception as exc:
            self._json(400, {"ok":False, "error":"INVALID_JSON", "detail":str(exc)})
            return
        try:
            if path == "/v1/jobs":
                job, dedup = self.app.store.enqueue(body.get("jobType"), body.get("idempotencyKey"), body.get("payload", {}), body.get("jobId"))
                self._json(200 if dedup else 201, {"ok":True, "deduplicated":dedup, "job":job})
                return
            if path == "/v1/extension/claim":
                job = self.app.store.claim(body.get("executorId"), body.get("capabilities", []))
                self._empty(204) if job is None else self._json(200, {"ok":True, "job":job})
                return
            if path == "/v1/extension/result":
                job, error = self.app.store.submit_result(body.get("jobId"), body.get("executorId"), body.get("status"), body.get("result", {}))
                if error == "NOT_FOUND":
                    self._json(404, {"ok":False, "error":error})
                elif error:
                    self._json(409, {"ok":False, "error":error, "job":job})
                else:
                    self._json(200, {"ok":True, "job":job})
                return
            if path == "/v1/extension/heartbeat":
                hb = self.app.store.heartbeat(body.get("executorId"), body.get("extensionVersion"), body.get("capabilities", []), body.get("onesTabCount", 0))
                self._json(200, {"ok":True, "heartbeat":hb, "stats":self.app.store.stats()})
                return
            self._json(404, {"ok":False, "error":"NOT_FOUND"})
        except ValueError as exc:
            self._json(400, {"ok":False, "error":"INPUT_REJECTED", "detail":str(exc)})
        except Exception as exc:
            self.app.logger.exception("request failed")
            self._json(500, {"ok":False, "error":"INTERNAL_ERROR", "detail":str(exc)})


class RelayHTTPServer(ThreadingHTTPServer):
    daemon_threads = True
    allow_reuse_address = True

    def __init__(self, server_address, handler_cls, app):
        self.app = app
        super().__init__(server_address, handler_cls)


def main():
    parser = argparse.ArgumentParser(description="ONES local relay v0.2.1")
    parser.add_argument("--port", type=int, default=DEFAULT_PORT)
    parser.add_argument("--data-dir", default=str(Path(__file__).resolve().parent / "data"))
    parser.add_argument("--error-log", default="")
    parser.add_argument("--foreground", action="store_true")
    args = parser.parse_args()
    if not (1024 <= args.port <= 65535):
        raise SystemExit("port must be between 1024 and 65535")
    data_dir = Path(args.data_dir).resolve()
    error_log = Path(args.error_log).resolve() if args.error_log else data_dir / "relay-error.log"
    logger = build_error_logger(error_log)
    app = RelayApp(data_dir, args.port, logger, error_log)
    server = RelayHTTPServer(("127.0.0.1", args.port), RelayHandler, app)
    if args.foreground:
        print(f"ONES Local Relay v{VERSION}")
        print(f"LISTEN=http://127.0.0.1:{args.port}")
        print(f"DB={app.db_path}")
        print(f"TOKEN_FILE={app.token_path}")
        print(f"ERROR_LOG={error_log}")
        print("Press Ctrl+C to stop.")
    try:
        server.serve_forever(poll_interval=0.25)
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
        app.cleanup()


if __name__ == "__main__":
    main()
