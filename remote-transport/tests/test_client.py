import hashlib
import hmac
import importlib.util
import json
import sys
import tempfile
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.error import HTTPError
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parents[2]


def load_module(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


client = load_module("remote_client_test", ROOT / "remote-transport" / "client.py")
envmod = load_module("remote_env_test", ROOT / "transport-envelope" / "envelope.py")
spoolmod = load_module("remote_spool_test", ROOT / "transport-spool" / "spool.py")

SECRETS = {
    "bigcircle-control": b"B" * 48,
    "windows-agent": b"W" * 48,
}

PUSH = {
    "bigcircle-control": "BIGCIRCLE_TO_WINDOWS",
    "windows-agent": "WINDOWS_TO_BIGCIRCLE",
}
PULL = {
    "bigcircle-control": "WINDOWS_TO_BIGCIRCLE",
    "windows-agent": "BIGCIRCLE_TO_WINDOWS",
}


def sha256(data):
    return hashlib.sha256(data).hexdigest()


class State:
    def __init__(self):
        self.objects = {}
        self.order = {
            "BIGCIRCLE_TO_WINDOWS": [],
            "WINDOWS_TO_BIGCIRCLE": [],
        }
        self.acked = set()
        self.leases = {}
        self.nonces = set()
        self.lock = threading.Lock()


class Handler(BaseHTTPRequestHandler):
    state = State()

    def log_message(self, fmt, *args):
        return

    def reply(self, status, body=b"", headers=None):
        self.send_response(status)
        for k, v in (headers or {}).items():
            self.send_header(k, v)
        self.send_header("Content-Length", str(len(body)))
        if body:
            self.send_header("Content-Type", "application/json")
        self.end_headers()
        if body:
            self.wfile.write(body)

    def json_reply(self, status, doc):
        self.reply(status, json.dumps(doc, separators=(",", ":")).encode("utf-8"))

    def read_body(self):
        n = int(self.headers.get("Content-Length", "0"))
        return self.rfile.read(n)

    def authenticate(self, body):
        role = self.headers.get(client.HEADER_ROLE)
        timestamp = self.headers.get(client.HEADER_TIMESTAMP)
        nonce = self.headers.get(client.HEADER_NONCE)
        body_sha = self.headers.get(client.HEADER_BODY_SHA)
        signature = self.headers.get(client.HEADER_SIGNATURE)
        if role not in SECRETS or not timestamp or not nonce or not body_sha or not signature:
            self.json_reply(401, {"error": "AUTH_HEADERS_MISSING"})
            return None
        if body_sha != sha256(body):
            self.json_reply(400, {"error": "BODY_SHA_MISMATCH"})
            return None
        try:
            ts = int(timestamp)
        except ValueError:
            self.json_reply(401, {"error": "TIMESTAMP_INVALID"})
            return None
        if abs(int(time.time()) - ts) > 300:
            self.json_reply(401, {"error": "TIMESTAMP_STALE"})
            return None
        canonical = client.canonical_signing_bytes(
            self.command, self.path, role, timestamp, nonce, body_sha
        )
        expected = hmac.new(SECRETS[role], canonical, hashlib.sha256).hexdigest()
        if not hmac.compare_digest(expected, signature):
            self.json_reply(401, {"error": "SIGNATURE_INVALID"})
            return None
        replay_key = (role, nonce)
        with self.state.lock:
            if replay_key in self.state.nonces:
                self.json_reply(409, {"error": "NONCE_REPLAY"})
                return None
            self.state.nonces.add(replay_key)
        return role

    def do_PUT(self):
        body = self.read_body()
        role = self.authenticate(body)
        if role is None:
            return
        parts = self.path.split("/")
        if len(parts) != 5 or parts[1:3] != ["v1", "envelopes"]:
            self.json_reply(404, {"error": "NOT_FOUND"})
            return
        direction, envelope_id = parts[3], parts[4]
        if PUSH.get(role) != direction:
            self.json_reply(403, {"error": "ROLE_DIRECTION_FORBIDDEN"})
            return
        try:
            envelope = json.loads(body.decode("utf-8-sig"))
            envmod.decode_payload_bytes(envelope)
        except Exception:
            self.json_reply(400, {"error": "ENVELOPE_INVALID"})
            return
        if envelope.get("direction") != direction or envelope.get("envelopeId") != envelope_id:
            self.json_reply(400, {"error": "ROUTE_MISMATCH"})
            return

        raw_sha = sha256(body)
        key = (direction, envelope_id)
        with self.state.lock:
            if key in self.state.objects:
                if self.state.objects[key] != body:
                    self.json_reply(409, {"error": "ENVELOPE_ID_COLLISION"})
                    return
                status = "NOOP"
            else:
                self.state.objects[key] = body
                self.state.order[direction].append(envelope_id)
                status = "STORED"
        self.json_reply(200, {
            "status": status,
            "envelopeId": envelope_id,
            "rawSha256": raw_sha,
        })

    def do_POST(self):
        body = self.read_body()
        role = self.authenticate(body)
        if role is None:
            return
        parts = self.path.split("/")
        if len(parts) == 4 and parts[1:3] == ["v1", "claims"]:
            direction = parts[3]
            if PULL.get(role) != direction:
                self.json_reply(403, {"error": "ROLE_DIRECTION_FORBIDDEN"})
                return
            with self.state.lock:
                envelope_id = next(
                    (eid for eid in self.state.order.get(direction, [])
                     if (direction, eid) not in self.state.acked),
                    None,
                )
                if envelope_id is None:
                    self.reply(204)
                    return
                key = (direction, envelope_id)
                raw = self.state.objects[key]
                lease_id = "lease-" + envelope_id[4:20]
                self.state.leases[key] = lease_id
            self.reply(200, raw, {
                client.HEADER_ENVELOPE_ID: envelope_id,
                client.HEADER_RAW_SHA: sha256(raw),
                client.HEADER_LEASE_ID: lease_id,
                "Content-Type": "application/octet-stream",
            })
            return

        if len(parts) == 5 and parts[1:3] == ["v1", "acks"]:
            direction, envelope_id = parts[3], parts[4]
            if PULL.get(role) != direction:
                self.json_reply(403, {"error": "ROLE_DIRECTION_FORBIDDEN"})
                return
            try:
                doc = json.loads(body.decode("utf-8"))
            except Exception:
                self.json_reply(400, {"error": "ACK_INVALID"})
                return
            key = (direction, envelope_id)
            with self.state.lock:
                raw = self.state.objects.get(key)
                lease = self.state.leases.get(key)
                if raw is None:
                    self.json_reply(404, {"error": "NOT_FOUND"})
                    return
                if doc.get("leaseId") != lease:
                    self.json_reply(409, {"error": "LEASE_MISMATCH"})
                    return
                if doc.get("rawSha256") != sha256(raw):
                    self.json_reply(409, {"error": "RAW_SHA_MISMATCH"})
                    return
                self.state.acked.add(key)
            self.json_reply(200, {
                "status": "ACKED",
                "envelopeId": envelope_id,
                "rawSha256": sha256(raw),
            })
            return

        self.json_reply(404, {"error": "NOT_FOUND"})


def write_envelope(path, payload, direction, kind, producer, consumer):
    env = envmod.build_envelope(
        payload,
        direction=direction,
        kind=kind,
        producer=producer,
        consumer=consumer,
        created_at="2026-09-22T00:00:00Z",
    )
    Path(path).write_text(
        json.dumps(env, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    return env


def expect_http_error(fn, token):
    try:
        fn()
    except client.RemoteTransportError as exc:
        assert token in str(exc), str(exc)
    else:
        raise AssertionError("expected RemoteTransportError")


def main():
    Handler.state = State()
    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    base_url = f"http://127.0.0.1:{server.server_port}"

    try:
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            big = root / "big"
            win = root / "win"

            # Big-circle -> Windows exact CASE_FEED.
            source = root / "case.json"
            case_env = write_envelope(
                source,
                {
                    "schema": "bigcircle.confirmed-case-export/v1alpha1",
                    "complete": True,
                    "exportedCaseCount": 0,
                    "cases": [],
                },
                "BIGCIRCLE_TO_WINDOWS",
                "CASE_FEED",
                "bigcircle-control",
                "windows-agent",
            )
            emitted = spoolmod.emit_outbound(big, "bigcircle-control", source)
            outbox = Path(emitted["path"])
            exact_forward = outbox.read_bytes()
            forward_sha = sha256(exact_forward)

            first = client.push_one(
                big, "bigcircle-control", base_url, SECRETS["bigcircle-control"],
                allow_http_loopback=True,
            )
            assert first["status"] == "PUSHED"
            assert first["rawSha256"] == forward_sha

            duplicate = client.push_one(
                big, "bigcircle-control", base_url, SECRETS["bigcircle-control"],
                allow_http_loopback=True,
            )
            assert duplicate["status"] == "PUSH_NOOP"

            pulled = client.pull_one(
                win, "windows-agent", base_url, SECRETS["windows-agent"],
                allow_http_loopback=True,
            )
            assert pulled["status"] == "PULLED"
            assert pulled["envelopeId"] == case_env["envelopeId"]
            assert Path(pulled["spool"]).read_bytes() == exact_forward

            empty = client.pull_one(
                win, "windows-agent", base_url, SECRETS["windows-agent"],
                allow_http_loopback=True,
            )
            assert empty["status"] == "EMPTY"

            # Windows -> Big-circle exact RESULT.
            reverse_source = root / "result.json"
            result_env = write_envelope(
                reverse_source,
                {
                    "schema": "ones.bigcircle-transport-result/v1alpha1",
                    "status": "RECONCILIATION_VERIFIED",
                    "caseFeedSha256": "a" * 64,
                    "inventorySha256": "b" * 64,
                    "reconciliationRunKey": "c" * 64,
                    "reconciliationOutput": "synthetic.json",
                },
                "WINDOWS_TO_BIGCIRCLE",
                "RESULT",
                "windows-agent",
                "bigcircle-control",
            )
            reverse_emitted = spoolmod.emit_outbound(win, "windows-agent", reverse_source)
            reverse_raw = Path(reverse_emitted["path"]).read_bytes()

            pushed_reverse = client.push_one(
                win, "windows-agent", base_url, SECRETS["windows-agent"],
                cleanup=True,
                allow_http_loopback=True,
            )
            assert pushed_reverse["status"] == "PUSHED"
            assert pushed_reverse["sourceRemoved"] is True

            pulled_reverse = client.pull_one(
                big, "bigcircle-control", base_url, SECRETS["bigcircle-control"],
                allow_http_loopback=True,
            )
            assert pulled_reverse["status"] == "PULLED"
            assert pulled_reverse["envelopeId"] == result_env["envelopeId"]
            assert Path(pulled_reverse["spool"]).read_bytes() == reverse_raw

            # Role boundary must fail closed.
            expect_http_error(
                lambda: client.request_bytes(
                    base_url,
                    SECRETS["windows-agent"],
                    "windows-agent",
                    "PUT",
                    f'/v1/envelopes/BIGCIRCLE_TO_WINDOWS/{case_env["envelopeId"]}',
                    exact_forward,
                    allow_http_loopback=True,
                ),
                "HTTP_403",
            )

            # Replay of an otherwise valid signed request must fail closed.
            replay_nonce = "fixed-replay-nonce-0123456789"
            replay_ts = int(time.time())
            status, _, _ = client.request_bytes(
                base_url,
                SECRETS["windows-agent"],
                "windows-agent",
                "POST",
                "/v1/claims/BIGCIRCLE_TO_WINDOWS",
                b"{}",
                allow_http_loopback=True,
                nonce=replay_nonce,
                timestamp=replay_ts,
            )
            assert status == 204
            expect_http_error(
                lambda: client.request_bytes(
                    base_url,
                    SECRETS["windows-agent"],
                    "windows-agent",
                    "POST",
                    "/v1/claims/BIGCIRCLE_TO_WINDOWS",
                    b"{}",
                    allow_http_loopback=True,
                    nonce=replay_nonce,
                    timestamp=replay_ts,
                ),
                "HTTP_409",
            )

            # Wrong signature must fail closed.
            path = "/v1/claims/BIGCIRCLE_TO_WINDOWS"
            body = b"{}"
            headers = client.sign_request(
                SECRETS["windows-agent"],
                "POST", path, "windows-agent",
                int(time.time()), "bad-signature-nonce-012345", body,
            )
            headers[client.HEADER_SIGNATURE] = "0" * 64
            req = Request(base_url + path, data=body, method="POST", headers=headers)
            try:
                urlopen(req)
            except HTTPError as exc:
                assert exc.code == 401
            else:
                raise AssertionError("invalid signature must fail")

            # Local semantic duplicate with different raw bytes must not be ACKed.
            conflict_source = root / "conflict.json"
            conflict_env = write_envelope(
                conflict_source,
                {"schema": "bigcircle.confirmed-case-export/v1alpha1", "complete": True,
                 "exportedCaseCount": 0, "cases": []},
                "BIGCIRCLE_TO_WINDOWS", "CASE_FEED",
                "bigcircle-control", "windows-agent",
            )
            # Same payload => same immutable envelope id as first CASE_FEED.
            assert conflict_env["envelopeId"] == case_env["envelopeId"]
            # The provider object is already ACKed, so re-PUT exact-different bytes collides.
            different_raw = json.dumps(
                json.loads(exact_forward.decode("utf-8")),
                separators=(",", ":"),
            ).encode("utf-8")
            assert different_raw != exact_forward
            expect_http_error(
                lambda: client.request_bytes(
                    base_url,
                    SECRETS["bigcircle-control"],
                    "bigcircle-control",
                    "PUT",
                    f'/v1/envelopes/BIGCIRCLE_TO_WINDOWS/{case_env["envelopeId"]}',
                    different_raw,
                    allow_http_loopback=True,
                ),
                "HTTP_409",
            )

            assert Handler.state.objects[
                ("BIGCIRCLE_TO_WINDOWS", case_env["envelopeId"])
            ] == exact_forward

        print("REMOTE_TRANSPORT_P4G_TEST_PASS")
        return 0
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=5)


if __name__ == "__main__":
    raise SystemExit(main())
