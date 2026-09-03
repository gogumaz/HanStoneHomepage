#!/usr/bin/env python3
"""Verify and atomically install a Hanstone static hosting bundle."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import re
import shutil
import stat
import sys


HASH = re.compile(r"^[a-f0-9]{64}$")
COMMIT = re.compile(r"^[a-f0-9]{40}$")
MAX_FILES = 50_000
MAX_TOTAL_BYTES = 2 * 1024 * 1024 * 1024
MANIFEST_NAME = "DEPLOYMENT_BUNDLE_MANIFEST.json"
REQUIRED_WEB_FILES = {
    "web/index.html",
    "web/app.html",
    "web/config.js",
    "web/payment/success.html",
    "web/payment/fail.html",
    "web/web-deployment-manifest.json",
}
FORBIDDEN_NAMES = {".env", ".env.local", ".npmrc", "id_rsa", "id_ed25519"}
FORBIDDEN_SUFFIXES = (".pem", ".key", ".p12", ".pfx")


class InstallError(Exception):
    """A safe, public installer error code."""

    def __init__(self, code: str):
        super().__init__(code)
        self.code = code


def fail(code: str) -> None:
    raise InstallError(code)


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def safe_relative_name(value: object) -> str:
    if not isinstance(value, str) or not value or "\\" in value:
        fail("HOSTING_INSTALL_PATH_INVALID")
    path = PurePosixPath(value)
    if path.is_absolute() or any(part in {"", ".", ".."} for part in path.parts):
        fail("HOSTING_INSTALL_PATH_INVALID")
    filename = path.name.lower()
    if filename in FORBIDDEN_NAMES or filename.endswith(FORBIDDEN_SUFFIXES):
        fail("HOSTING_INSTALL_SECRET_FILE_FORBIDDEN")
    return value


def regular_files(root: Path) -> dict[str, Path]:
    files: dict[str, Path] = {}
    for directory, directory_names, file_names in os.walk(root, followlinks=False):
        directory_path = Path(directory)
        for name in [*directory_names, *file_names]:
            path = directory_path / name
            if path.is_symlink():
                fail("HOSTING_INSTALL_SYMBOLIC_LINK_FORBIDDEN")
        for name in file_names:
            path = directory_path / name
            mode = path.stat(follow_symlinks=False).st_mode
            if not stat.S_ISREG(mode):
                fail("HOSTING_INSTALL_SPECIAL_FILE_FORBIDDEN")
            relative_name = path.relative_to(root).as_posix()
            safe_relative_name(relative_name)
            files[relative_name] = path
            if len(files) > MAX_FILES:
                fail("HOSTING_INSTALL_FILE_LIMIT_EXCEEDED")
    return files


def validate_manifest(manifest: object, expected_commit: str | None) -> tuple[dict, dict[str, dict]]:
    if not isinstance(manifest, dict):
        fail("HOSTING_INSTALL_MANIFEST_INVALID")
    commit_sha = manifest.get("commitSha")
    entries = manifest.get("files")
    totals = manifest.get("totals")
    if (
        manifest.get("schemaVersion") != 1
        or manifest.get("kind") != "hanstone-hosting-deployment-bundle"
        or manifest.get("ok") is not True
        or manifest.get("containsSecrets") is not False
        or not isinstance(commit_sha, str)
        or COMMIT.fullmatch(commit_sha) is None
        or not isinstance(entries, list)
        or not isinstance(totals, dict)
    ):
        fail("HOSTING_INSTALL_MANIFEST_INVALID")
    if expected_commit is not None and commit_sha != expected_commit.lower():
        fail("HOSTING_INSTALL_COMMIT_MISMATCH")

    indexed: dict[str, dict] = {}
    total_bytes = 0
    for entry in entries:
        if not isinstance(entry, dict):
            fail("HOSTING_INSTALL_MANIFEST_INVALID")
        name = safe_relative_name(entry.get("path"))
        size = entry.get("bytes")
        digest = entry.get("sha256")
        if (
            name in indexed
            or not isinstance(size, int)
            or isinstance(size, bool)
            or size < 0
            or not isinstance(digest, str)
            or HASH.fullmatch(digest) is None
        ):
            fail("HOSTING_INSTALL_MANIFEST_INVALID")
        indexed[name] = entry
        total_bytes += size
        if total_bytes > MAX_TOTAL_BYTES:
            fail("HOSTING_INSTALL_SIZE_LIMIT_EXCEEDED")

    if not REQUIRED_WEB_FILES.issubset(set(indexed)):
        fail("HOSTING_INSTALL_FILE_SET_MISMATCH")
    total_files_value = totals.get("files")
    total_bytes_value = totals.get("bytes")
    if (
        not isinstance(total_files_value, int)
        or isinstance(total_files_value, bool)
        or not isinstance(total_bytes_value, int)
        or isinstance(total_bytes_value, bool)
        or total_files_value != len(indexed)
        or total_bytes_value != total_bytes
    ):
        fail("HOSTING_INSTALL_TOTALS_MISMATCH")
    return manifest, indexed


def read_manifest(path: Path) -> object:
    if path.is_symlink() or not path.is_file():
        fail("HOSTING_INSTALL_MANIFEST_MISSING")
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeDecodeError, json.JSONDecodeError):
        fail("HOSTING_INSTALL_MANIFEST_INVALID")


def verify_bundle(bundle_root: Path, expected_commit: str | None) -> tuple[dict, dict[str, dict]]:
    if not bundle_root.is_dir() or bundle_root.is_symlink():
        fail("HOSTING_INSTALL_BUNDLE_ROOT_INVALID")
    files = regular_files(bundle_root)
    manifest_path = files.get(MANIFEST_NAME)
    if manifest_path is None:
        fail("HOSTING_INSTALL_MANIFEST_MISSING")
    manifest, indexed = validate_manifest(read_manifest(manifest_path), expected_commit)

    actual_names = set(files) - {MANIFEST_NAME}
    if set(indexed) != actual_names or not REQUIRED_WEB_FILES.issubset(actual_names):
        fail("HOSTING_INSTALL_FILE_SET_MISMATCH")

    for name, entry in indexed.items():
        path = files[name]
        if path.stat().st_size != entry["bytes"] or sha256_file(path) != entry["sha256"]:
            fail("HOSTING_INSTALL_FILE_MISMATCH")
    return manifest, indexed


def verify_web_copy(web_root: Path, entries: dict[str, dict]) -> None:
    expected = {name.removeprefix("web/"): entry for name, entry in entries.items() if name.startswith("web/")}
    actual = regular_files(web_root)
    if set(actual) != set(expected):
        fail("HOSTING_INSTALL_WEB_COPY_MISMATCH")
    for name, entry in expected.items():
        path = actual[name]
        if path.stat().st_size != entry["bytes"] or sha256_file(path) != entry["sha256"]:
            fail("HOSTING_INSTALL_WEB_COPY_MISMATCH")


def validate_target_root(target_root: Path) -> None:
    if not target_root.is_absolute():
        fail("HOSTING_INSTALL_TARGET_INVALID")
    normalized = Path(os.path.abspath(target_root))
    forbidden = {Path("/"), Path("/var"), Path("/var/www")}
    if normalized in forbidden or len(normalized.parts) < 3:
        fail("HOSTING_INSTALL_TARGET_INVALID")
    candidate = Path(normalized.anchor)
    for part in normalized.parts[1:]:
        candidate /= part
        if os.path.lexists(candidate) and candidate.is_symlink():
            fail("HOSTING_INSTALL_TARGET_SYMLINK_FORBIDDEN")


def ensure_directory(path: Path) -> None:
    if os.path.lexists(path):
        if path.is_symlink() or not path.is_dir():
            fail("HOSTING_INSTALL_DIRECTORY_UNSAFE")
        return
    path.mkdir(parents=True, mode=0o755)


def require_directory(path: Path) -> None:
    if path.is_symlink() or not path.is_dir():
        fail("HOSTING_INSTALL_DIRECTORY_MISSING")


def atomic_symlink(link: Path, target: str) -> None:
    if os.path.lexists(link) and not link.is_symlink():
        fail("HOSTING_INSTALL_LINK_PATH_UNSAFE")
    temporary = link.with_name(f".{link.name}.next-{os.getpid()}")
    if os.path.lexists(temporary):
        if not temporary.is_symlink():
            fail("HOSTING_INSTALL_TEMPORARY_PATH_UNSAFE")
        temporary.unlink()
    temporary.symlink_to(target, target_is_directory=True)
    os.replace(temporary, link)


def current_release(link: Path, releases_root: Path) -> tuple[str | None, str | None]:
    if not os.path.lexists(link):
        return None, None
    if not link.is_symlink():
        fail("HOSTING_INSTALL_CURRENT_NOT_SYMLINK")
    raw_target = os.readlink(link)
    resolved = (link.parent / raw_target).resolve()
    try:
        relative = resolved.relative_to(releases_root.resolve())
    except ValueError:
        fail("HOSTING_INSTALL_CURRENT_OUTSIDE_RELEASES")
    if len(relative.parts) != 1 or not resolved.is_dir() or COMMIT.fullmatch(relative.name) is None:
        fail("HOSTING_INSTALL_CURRENT_INVALID")
    return relative.name, raw_target


def apply_release(bundle_root: Path, target_root: Path, manifest: dict, entries: dict[str, dict]) -> dict:
    validate_target_root(target_root)
    commit_sha = manifest["commitSha"]
    releases_root = target_root / "releases"
    manifests_root = target_root / "manifests"
    ensure_directory(target_root)
    ensure_directory(releases_root)
    ensure_directory(manifests_root)

    release = releases_root / commit_sha
    installed_now = False
    staging = releases_root / f".staging-{commit_sha}-{os.getpid()}"
    try:
        if os.path.lexists(release):
            if release.is_symlink() or not release.is_dir():
                fail("HOSTING_INSTALL_RELEASE_PATH_UNSAFE")
            verify_web_copy(release, entries)
        else:
            if os.path.lexists(staging):
                fail("HOSTING_INSTALL_STAGING_EXISTS")
            shutil.copytree(bundle_root / "web", staging, copy_function=shutil.copyfile)
            for directory, _, file_names in os.walk(staging):
                Path(directory).chmod(0o755)
                for name in file_names:
                    (Path(directory) / name).chmod(0o644)
            verify_web_copy(staging, entries)
            staging.rename(release)
            installed_now = True
    finally:
        if os.path.lexists(staging):
            if staging.is_symlink() or not staging.is_dir():
                fail("HOSTING_INSTALL_STAGING_UNSAFE")
            shutil.rmtree(staging)

    manifest_source = bundle_root / MANIFEST_NAME
    manifest_destination = manifests_root / f"{commit_sha}.json"
    manifest_bytes = manifest_source.read_bytes()
    if os.path.lexists(manifest_destination):
        if (
            manifest_destination.is_symlink()
            or not manifest_destination.is_file()
            or manifest_destination.read_bytes() != manifest_bytes
        ):
            fail("HOSTING_INSTALL_STORED_MANIFEST_MISMATCH")
    else:
        temporary_manifest = manifests_root / f".{commit_sha}.json.next-{os.getpid()}"
        if os.path.lexists(temporary_manifest):
            fail("HOSTING_INSTALL_TEMPORARY_PATH_UNSAFE")
        temporary_manifest.write_bytes(manifest_bytes)
        temporary_manifest.chmod(0o644)
        os.replace(temporary_manifest, manifest_destination)

    current = target_root / "current"
    previous = target_root / "previous"
    previous_commit, previous_target = current_release(current, releases_root)
    if previous_commit != commit_sha:
        if previous_target is not None:
            atomic_symlink(previous, previous_target)
        atomic_symlink(current, f"releases/{commit_sha}")

    return {
        "ok": True,
        "mode": "apply",
        "commitSha": commit_sha,
        "previousCommitSha": previous_commit,
        "installedNow": installed_now,
        "current": str(current),
    }


def rollback_release(
    target_root: Path,
    expected_current: str,
    expected_previous: str,
) -> dict:
    validate_target_root(target_root)
    releases_root = target_root / "releases"
    manifests_root = target_root / "manifests"
    require_directory(target_root)
    require_directory(releases_root)
    require_directory(manifests_root)

    current = target_root / "current"
    previous = target_root / "previous"
    current_commit, current_target = current_release(current, releases_root)
    previous_commit, previous_target = current_release(previous, releases_root)
    if current_commit is None or current_target is None or previous_commit is None or previous_target is None:
        fail("HOSTING_INSTALL_ROLLBACK_UNAVAILABLE")
    if current_commit == previous_commit:
        fail("HOSTING_INSTALL_ROLLBACK_TARGET_INVALID")
    if current_commit != expected_current.lower() or previous_commit != expected_previous.lower():
        fail("HOSTING_INSTALL_ROLLBACK_CONFIRMATION_MISMATCH")

    stored_manifest = manifests_root / f"{previous_commit}.json"
    _, entries = validate_manifest(read_manifest(stored_manifest), previous_commit)
    verify_web_copy(releases_root / previous_commit, entries)

    atomic_symlink(current, previous_target)
    atomic_symlink(previous, current_target)
    return {
        "ok": True,
        "mode": "rollback",
        "commitSha": previous_commit,
        "rolledBackFromCommitSha": current_commit,
        "current": str(current),
    }


def parse_arguments() -> argparse.Namespace:
    default_bundle = Path(__file__).resolve().parent.parent
    parser = argparse.ArgumentParser(
        description="Verify a Hanstone hosting bundle and atomically install its static web release."
    )
    action = parser.add_mutually_exclusive_group()
    action.add_argument("--check", action="store_true", help="verify only (default; makes no changes)")
    action.add_argument("--apply", action="store_true", help="install and switch the current release")
    action.add_argument("--rollback", action="store_true", help="switch back to the verified previous release")
    parser.add_argument("--bundle-root", type=Path, default=default_bundle)
    parser.add_argument("--target-root", type=Path, default=Path("/var/www/hanstone"))
    parser.add_argument("--expected-commit", help="require this exact 40-character Git commit SHA")
    parser.add_argument("--expected-current", help="confirm the current commit before rollback")
    parser.add_argument("--expected-previous", help="confirm the previous commit before rollback")
    return parser.parse_args()


def main() -> None:
    arguments = parse_arguments()
    target_root = Path(os.path.abspath(arguments.target_root))
    if arguments.rollback:
        if arguments.expected_commit is not None:
            fail("HOSTING_INSTALL_ARGUMENTS_INVALID")
        if arguments.expected_current is None or arguments.expected_previous is None:
            fail("HOSTING_INSTALL_ROLLBACK_CONFIRMATION_REQUIRED")
        if (
            COMMIT.fullmatch(arguments.expected_current.lower()) is None
            or COMMIT.fullmatch(arguments.expected_previous.lower()) is None
        ):
            fail("HOSTING_INSTALL_ROLLBACK_CONFIRMATION_INVALID")
        result = rollback_release(target_root, arguments.expected_current, arguments.expected_previous)
    else:
        if arguments.expected_current is not None or arguments.expected_previous is not None:
            fail("HOSTING_INSTALL_ARGUMENTS_INVALID")
        if arguments.expected_commit is not None and COMMIT.fullmatch(arguments.expected_commit.lower()) is None:
            fail("HOSTING_INSTALL_EXPECTED_COMMIT_INVALID")
        bundle_root = Path(os.path.abspath(arguments.bundle_root))
        manifest, entries = verify_bundle(bundle_root, arguments.expected_commit)
        if arguments.apply:
            result = apply_release(bundle_root, target_root, manifest, entries)
        else:
            result = {
                "ok": True,
                "mode": "check",
                "commitSha": manifest["commitSha"],
                "fileCount": len(entries),
                "totalBytes": manifest["totals"]["bytes"],
            }
    print(json.dumps(result, ensure_ascii=False, separators=(",", ":")))


if __name__ == "__main__":
    try:
        main()
    except InstallError as error:
        print(json.dumps({"ok": False, "errorType": error.code}, separators=(",", ":")), file=sys.stderr)
        raise SystemExit(1) from None
    except (OSError, shutil.Error):
        print(json.dumps({"ok": False, "errorType": "HOSTING_INSTALL_IO_FAILED"}, separators=(",", ":")), file=sys.stderr)
        raise SystemExit(1) from None
