"""Loopback-only, synthetic real-DOM harness for the accepted page-control core.

No ONES/Relay requests, credentials, installation or mutation transport is used.
The three served assets are snapshotted at startup so the displayed source digest
identifies exactly the native-editor-diagnostic.js bytes executed by the page.
"""

from __future__ import annotations

import argparse
import hashlib
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path
from urllib.parse import urlsplit


def create_server(port: int = 18739) -> HTTPServer:
    tests = Path(__file__).resolve().parent
    source = (tests.parent / "native-editor-diagnostic.js").read_bytes()
    digest = hashlib.sha256(source).hexdigest()
    page = (tests / "fixtures" / "native_editor_local.html").read_bytes()
    page = page.replace(b"{{SOURCE_SHA256}}", digest.encode("ascii"))
    assets = {
        "/project/": ("text/html; charset=utf-8", page),
        "/fixture.js": (
            "application/javascript; charset=utf-8",
            (tests / "fixtures" / "native_editor_local.js").read_bytes(),
        ),
        "/native-editor-diagnostic.js": (
            "application/javascript; charset=utf-8", source
        ),
    }

    class Handler(BaseHTTPRequestHandler):
        server_version = "SyntheticEditorFixture/1"

        def do_GET(self) -> None:
            # A literal loopback Host check also excludes DNS-rebinding names.
            expected_host = f"127.0.0.1:{self.server.server_port}"
            route = urlsplit(self.path)
            if self.headers.get("Host") != expected_host:
                self.send_error(403, "Loopback host required")
                return
            if route.query or route.path not in assets:
                self.send_error(404, "Fixture asset not found")
                return
            content_type, data = assets[route.path]
            self.send_response(200)
            self.send_header("Content-Type", content_type)
            self.send_header("Content-Length", str(len(data)))
            self.send_header("Cache-Control", "no-store")
            self.send_header("X-Content-Type-Options", "nosniff")
            self.send_header("Referrer-Policy", "no-referrer")
            self.send_header("Cross-Origin-Resource-Policy", "same-origin")
            self.send_header(
                "Content-Security-Policy",
                "default-src 'none'; script-src 'self'; style-src 'unsafe-inline'; "
                "connect-src 'none'; img-src 'none'; object-src 'none'; "
                "base-uri 'none'; frame-ancestors 'none'; form-action 'none'",
            )
            self.end_headers()
            self.wfile.write(data)

        def log_request(self, code="-", size="-") -> None:
            # Do not echo arbitrary request paths, headers or query text.
            print(f"fixture {self.command} {code}", flush=True)

    server = HTTPServer(("127.0.0.1", port), Handler)
    server.native_source_sha256 = digest
    return server


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--port", type=int, default=18739)
    args = parser.parse_args()
    if not 0 <= args.port <= 65535:
        parser.error("port must be between 0 and 65535")
    server = create_server(args.port)
    route = (
        f"http://127.0.0.1:{server.server_port}/project/"
        "#/team/synthetic-team/project/synthetic-project/issue/SYN-1"
    )
    print("LOCAL SYNTHETIC — NOT ONES ACCEPTANCE", flush=True)
    print(route, flush=True)
    print(f"native source SHA256 {server.native_source_sha256}", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
