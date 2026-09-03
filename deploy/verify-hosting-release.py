#!/usr/bin/env python3
"""Verify an installed Hanstone static release against its live HTTPS origin."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import runpy
import ssl
import sys
from datetime import datetime, timezone
from urllib.error import HTTPError, URLError
from urllib.parse import urljoin, urlparse
from urllib.request import HTTPRedirectHandler, HTTPSHandler, Request, build_opener


MAX_RESPONSE_BYTES = 50 * 1024 * 1024
SECURITY_HEADERS = {
    "x-content-type-options": "nosniff",
    "x-frame-options": "deny",
    "referrer-policy": "strict-origin-when-cross-origin",
}

installer = runpy.run_path(str(Path(__file__).with_name("install-hosting-release.py")))
InstallError = installer["InstallError"]
COMMIT = installer["COMMIT"]


class VerificationError(Exception):
    def __init__(self, code: str):
        super().__init__(code)
        self.code = code


def fail(code: str) -> None:
    raise VerificationError(code)


def normalized_header(value: str | None) -> str:
    return "".join((value or "").lower().split())


def content_type_matches(actual: str, expected: str) -> bool:
    if actual == expected:
        return True
    javascript_types = {"application/javascript", "text/javascript"}
    return actual in javascript_types and expected in javascript_types


def validate_base_url(value: str) -> str:
    parsed = urlparse(value)
    if (
        parsed.scheme != "https"
        or not parsed.hostname
        or parsed.username is not None
        or parsed.password is not None
        or parsed.query
        or parsed.fragment
        or parsed.path not in {"", "/"}
    ):
        fail("HOSTING_VERIFY_HTTPS_BASE_URL_REQUIRED")
    return f"https://{parsed.netloc}/"


def load_local_release(target_root: Path, expected_commit: str) -> tuple[str, dict[str, dict], dict[str, dict]]:
    installer["validate_target_root"](target_root)
    releases_root = target_root / "releases"
    manifests_root = target_root / "manifests"
    installer["require_directory"](target_root)
    installer["require_directory"](releases_root)
    installer["require_directory"](manifests_root)
    current_commit, _ = installer["current_release"](target_root / "current", releases_root)
    if current_commit is None or current_commit != expected_commit.lower():
        fail("HOSTING_VERIFY_CURRENT_COMMIT_MISMATCH")

    stored_manifest_path = manifests_root / f"{current_commit}.json"
    stored_manifest, bundle_entries = installer["validate_manifest"](
        installer["read_manifest"](stored_manifest_path), current_commit
    )
    release_root = releases_root / current_commit
    installer["verify_web_copy"](release_root, bundle_entries)

    web_manifest_path = release_root / "web-deployment-manifest.json"
    try:
        web_manifest = json.loads(web_manifest_path.read_text(encoding="utf-8"))
    except (OSError, UnicodeDecodeError, json.JSONDecodeError):
        fail("HOSTING_VERIFY_WEB_MANIFEST_INVALID")
    if (
        not isinstance(web_manifest, dict)
        or web_manifest.get("schemaVersion") != 1
        or web_manifest.get("ok") is not True
        or web_manifest.get("commitSha") != current_commit
        or not isinstance(web_manifest.get("files"), list)
    ):
        fail("HOSTING_VERIFY_WEB_MANIFEST_INVALID")

    web_entries: dict[str, dict] = {}
    for entry in web_manifest["files"]:
        if not isinstance(entry, dict):
            fail("HOSTING_VERIFY_WEB_MANIFEST_INVALID")
        name = installer["safe_relative_name"](entry.get("path"))
        if (
            name in web_entries
            or not isinstance(entry.get("sha256"), str)
            or installer["HASH"].fullmatch(entry["sha256"]) is None
            or not isinstance(entry.get("bytes"), int)
            or isinstance(entry.get("bytes"), bool)
            or entry["bytes"] < 0
            or not isinstance(entry.get("contentType"), str)
            or not isinstance(entry.get("cacheControl"), str)
        ):
            fail("HOSTING_VERIFY_WEB_MANIFEST_INVALID")
        web_entries[name] = entry

    required = {"index.html", "app.html", "config.js", "payment/success.html", "payment/fail.html"}
    if not required.issubset(web_entries) or not any(name.startswith("assets/") for name in web_entries):
        fail("HOSTING_VERIFY_WEB_MANIFEST_INVALID")
    bundle_web_manifest = bundle_entries.get("web/web-deployment-manifest.json")
    if bundle_web_manifest is None or stored_manifest.get("commitSha") != current_commit:
        fail("HOSTING_VERIFY_WEB_MANIFEST_INVALID")
    return current_commit, web_entries, bundle_web_manifest


def response_bytes(response, expected_bytes: int) -> bytes:
    limit = min(MAX_RESPONSE_BYTES, expected_bytes + 1)
    contents = response.read(limit)
    if len(contents) > expected_bytes:
        fail("HOSTING_VERIFY_RESPONSE_SIZE_MISMATCH")
    return contents


def verify_route(opener, base_url: str, route: str, entry: dict, timeout: float) -> dict:
    url = urljoin(base_url, route.lstrip("/"))
    request = Request(url, headers={"Accept-Encoding": "identity", "User-Agent": "hanstone-hosting-verifier/1"})
    try:
        with opener.open(request, timeout=timeout) as response:
            final = urlparse(response.geturl())
            expected_origin = urlparse(base_url)
            if final.scheme != "https" or final.netloc != expected_origin.netloc:
                fail("HOSTING_VERIFY_CROSS_ORIGIN_REDIRECT")
            if response.status != 200:
                fail("HOSTING_VERIFY_HTTP_STATUS_INVALID")
            contents = response_bytes(response, entry["bytes"])
            if len(contents) != entry["bytes"] or hashlib.sha256(contents).hexdigest() != entry["sha256"]:
                fail("HOSTING_VERIFY_RESPONSE_HASH_MISMATCH")
            actual_type = (response.headers.get("Content-Type") or "").split(";", 1)[0].strip().lower()
            expected_type = entry["contentType"].split(";", 1)[0].strip().lower()
            if not content_type_matches(actual_type, expected_type):
                fail("HOSTING_VERIFY_CONTENT_TYPE_MISMATCH")
            if normalized_header(response.headers.get("Cache-Control")) != normalized_header(entry["cacheControl"]):
                fail("HOSTING_VERIFY_CACHE_CONTROL_MISMATCH")
            for name, expected in SECURITY_HEADERS.items():
                if normalized_header(response.headers.get(name)) != normalized_header(expected):
                    fail("HOSTING_VERIFY_SECURITY_HEADER_MISMATCH")
            hsts = normalized_header(response.headers.get("Strict-Transport-Security"))
            if "max-age=31536000" not in hsts:
                fail("HOSTING_VERIFY_HSTS_MISSING")
            if not response.headers.get("Content-Security-Policy"):
                fail("HOSTING_VERIFY_CSP_MISSING")
    except VerificationError:
        raise
    except (HTTPError, URLError, TimeoutError, ssl.SSLError, OSError):
        fail("HOSTING_VERIFY_REQUEST_FAILED")
    return {"code": f"live:{route}", "ok": True}


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, request, file_pointer, code, message, headers, new_url):
        return None


def verify_http_redirect(base_url: str, timeout: float) -> dict:
    parsed = urlparse(base_url)
    http_url = f"http://{parsed.hostname}/"
    opener = build_opener(NoRedirect())
    try:
        opener.open(Request(http_url, method="GET"), timeout=timeout)
        fail("HOSTING_VERIFY_HTTP_REDIRECT_MISSING")
    except HTTPError as error:
        location = urlparse(error.headers.get("Location", ""))
        if error.code not in {301, 308} or location.scheme != "https" or location.hostname != parsed.hostname:
            fail("HOSTING_VERIFY_HTTP_REDIRECT_INVALID")
    except VerificationError:
        raise
    except (URLError, TimeoutError, OSError):
        fail("HOSTING_VERIFY_HTTP_REQUEST_FAILED")
    return {"code": "http:https-redirect", "ok": True}


def build_routes(web_entries: dict[str, dict], bundle_web_manifest: dict) -> list[tuple[str, dict]]:
    asset_name = sorted(name for name in web_entries if name.startswith("assets/"))[0]
    manifest_entry = {
        "bytes": bundle_web_manifest["bytes"],
        "sha256": bundle_web_manifest["sha256"],
        "contentType": "application/json; charset=utf-8",
        "cacheControl": "public,max-age=0,must-revalidate",
    }
    return [
        ("/", web_entries["index.html"]),
        ("/app.html", web_entries["app.html"]),
        ("/config.js", web_entries["config.js"]),
        ("/payment/success.html", web_entries["payment/success.html"]),
        ("/payment/fail.html", web_entries["payment/fail.html"]),
        ("/dashboard", web_entries["app.html"]),
        ("/web-deployment-manifest.json", manifest_entry),
        (f"/{asset_name}", web_entries[asset_name]),
    ]


def write_report(path: Path | None, report: dict) -> None:
    encoded = f"{json.dumps(report, ensure_ascii=False, separators=(',', ':'))}\n"
    if path is not None:
        if path.suffix.lower() != ".json":
            fail("HOSTING_VERIFY_OUTPUT_PATH_INVALID")
        path.parent.mkdir(parents=True, exist_ok=True)
        with path.open("x", encoding="utf-8") as destination:
            destination.write(encoded)
        path.chmod(0o600)
    print(encoded, end="")


def parse_arguments() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Verify the installed static release and its live HTTPS responses.")
    parser.add_argument("--base-url", required=True, help="production HTTPS origin, for example https://uzdream.com")
    parser.add_argument("--expected-commit", required=True, help="expected 40-character Git commit SHA")
    parser.add_argument("--target-root", type=Path, default=Path("/var/www/hanstone"))
    parser.add_argument("--timeout-seconds", type=float, default=10.0)
    parser.add_argument("--ca-file", type=Path, help="optional trusted CA bundle for a private test environment")
    parser.add_argument("--output", type=Path, help="write a new JSON report without overwriting an existing file")
    return parser.parse_args()


def main() -> None:
    arguments = parse_arguments()
    base_url = validate_base_url(arguments.base_url)
    if COMMIT.fullmatch(arguments.expected_commit.lower()) is None:
        fail("HOSTING_VERIFY_EXPECTED_COMMIT_INVALID")
    if not 1 <= arguments.timeout_seconds <= 60:
        fail("HOSTING_VERIFY_TIMEOUT_INVALID")
    target_root = Path(os.path.abspath(arguments.target_root))
    commit_sha, web_entries, bundle_web_manifest = load_local_release(target_root, arguments.expected_commit)
    context = ssl.create_default_context(cafile=str(arguments.ca_file) if arguments.ca_file else None)
    context.minimum_version = ssl.TLSVersion.TLSv1_2
    opener = build_opener(HTTPSHandler(context=context))

    checks = [{"code": "local:installed-release", "ok": True}]
    failures = []
    for route, entry in build_routes(web_entries, bundle_web_manifest):
        try:
            checks.append(verify_route(opener, base_url, route, entry, arguments.timeout_seconds))
        except VerificationError as error:
            check = {"code": f"live:{route}", "ok": False, "errorType": error.code}
            checks.append(check)
            failures.append(check)
    try:
        checks.append(verify_http_redirect(base_url, arguments.timeout_seconds))
    except VerificationError as error:
        check = {"code": "http:https-redirect", "ok": False, "errorType": error.code}
        checks.append(check)
        failures.append(check)

    report = {
        "schemaVersion": 1,
        "kind": "hanstone-static-hosting-verification",
        "ok": not failures,
        "rollbackRecommended": bool(failures),
        "checkedAt": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "commitSha": commit_sha,
        "baseOrigin": base_url.rstrip("/"),
        "checks": checks,
        "failures": failures,
    }
    write_report(arguments.output, report)
    if failures:
        raise SystemExit(1)


if __name__ == "__main__":
    try:
        main()
    except (VerificationError, InstallError) as error:
        error_type = error.code if hasattr(error, "code") else "HOSTING_VERIFY_FAILED"
        print(json.dumps({"ok": False, "rollbackRecommended": True, "errorType": error_type}, separators=(",", ":")), file=sys.stderr)
        raise SystemExit(1) from None
    except (OSError, ValueError):
        print(json.dumps({"ok": False, "rollbackRecommended": True, "errorType": "HOSTING_VERIFY_IO_FAILED"}, separators=(",", ":")), file=sys.stderr)
        raise SystemExit(1) from None
