#!/usr/bin/env python3
"""Validate, back up, verify, and restore local lesson MP4 files."""

from __future__ import annotations

import argparse
import contextlib
import datetime as dt
import hashlib
import json
import os
import re
import shutil
import stat
import sys
import tempfile
from pathlib import Path
from typing import Iterator


LESSON_ID = re.compile(r"^[A-Z0-9][A-Z0-9-]{2,39}$")
SHA256 = re.compile(r"^[a-f0-9]{64}$")
DEFAULT_SOURCE = "/var/www/hanstone/media/lessons"
DEFAULT_BACKUP_ROOT = "/var/backups/hanstone/local-videos"
DEFAULT_MAX_BYTES = 268_435_456
DEFAULT_WARNING_FREE_BYTES = 5_368_709_120
DEFAULT_CRITICAL_FREE_BYTES = 1_073_741_824


class MaintenanceError(RuntimeError):
    pass


def emit(payload: dict[str, object]) -> None:
    print(json.dumps(payload, ensure_ascii=False, sort_keys=True, separators=(",", ":")))


def utc_now() -> dt.datetime:
    return dt.datetime.now(dt.timezone.utc)


def is_within(path: Path, parent: Path) -> bool:
    try:
        path.relative_to(parent)
        return True
    except ValueError:
        return False


def absolute_path(value: str, label: str) -> Path:
    path = Path(value)
    if not path.is_absolute():
        raise MaintenanceError(f"{label}_MUST_BE_ABSOLUTE")
    return path


def checked_directory(path: Path, label: str, create: bool = False, mode: int = 0o700) -> Path:
    if create and not path.exists():
        parent = path.parent.resolve(strict=True)
        if not parent.is_dir() or parent.is_symlink():
            raise MaintenanceError(f"{label}_PARENT_INVALID")
        path.mkdir(mode=mode)
    resolved = path.resolve(strict=True)
    metadata = resolved.lstat()
    if not stat.S_ISDIR(metadata.st_mode) or path.is_symlink():
        raise MaintenanceError(f"{label}_INVALID")
    return resolved


def validate_roots(source_value: str, backup_value: str, create_backup: bool = False) -> tuple[Path, Path]:
    source = checked_directory(absolute_path(source_value, "SOURCE"), "SOURCE")
    backup_path = absolute_path(backup_value, "BACKUP_ROOT")
    backup = checked_directory(backup_path, "BACKUP_ROOT", create=create_backup)
    if source == backup or is_within(source, backup) or is_within(backup, source):
        raise MaintenanceError("SOURCE_AND_BACKUP_ROOT_OVERLAP")
    return source, backup


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def scan_source(source: Path, max_bytes: int) -> tuple[list[dict[str, object]], int]:
    files: list[dict[str, object]] = []
    invalid = 0
    for path in sorted(source.iterdir(), key=lambda item: item.name):
        if path.suffix.lower() != ".mp4":
            continue
        lesson_id = path.name[:-4]
        metadata = path.lstat()
        if (
            not LESSON_ID.fullmatch(lesson_id)
            or path.is_symlink()
            or not stat.S_ISREG(metadata.st_mode)
            or metadata.st_size <= 0
            or metadata.st_size > max_bytes
        ):
            invalid += 1
            continue
        with path.open("rb") as stream:
            if b"ftyp" not in stream.read(64):
                invalid += 1
                continue
        files.append({
            "name": path.name,
            "size": metadata.st_size,
            "sha256": sha256_file(path),
        })
    return files, invalid


def disk_snapshot(path: Path, warning: int, critical: int) -> dict[str, object]:
    usage = shutil.disk_usage(path)
    status = "critical" if usage.free <= critical else "attention" if usage.free <= warning else "healthy"
    return {
        "status": status,
        "capacityBytes": usage.total,
        "availableBytes": usage.free,
        "usedPercent": round((usage.used / usage.total) * 100, 1) if usage.total else 100,
    }


def validate_limits(args: argparse.Namespace) -> None:
    if args.max_bytes <= 0 or args.max_bytes > 1_073_741_824:
        raise MaintenanceError("MAX_BYTES_INVALID")
    if args.critical_free_bytes <= 0 or args.warning_free_bytes <= args.critical_free_bytes:
        raise MaintenanceError("FREE_SPACE_THRESHOLDS_INVALID")


def atomic_json(path: Path, payload: dict[str, object], mode: int = 0o600) -> None:
    descriptor, temporary_name = tempfile.mkstemp(prefix=f".{path.name}.", dir=path.parent)
    temporary = Path(temporary_name)
    try:
        with os.fdopen(descriptor, "w", encoding="utf-8") as output:
            json.dump(payload, output, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
            output.write("\n")
            output.flush()
            os.fsync(output.fileno())
        os.chmod(temporary, mode)
        os.replace(temporary, path)
    finally:
        temporary.unlink(missing_ok=True)


@contextlib.contextmanager
def backup_lock(root: Path) -> Iterator[None]:
    lock_path = root / ".maintenance.lock"
    with lock_path.open("a+b") as lock:
        os.chmod(lock_path, 0o600)
        if os.name == "posix":
            import fcntl
            fcntl.flock(lock.fileno(), fcntl.LOCK_EX)
        yield


def ensure_backup_layout(root: Path) -> tuple[Path, Path]:
    objects = root / "objects"
    manifests = root / "manifests"
    for directory in (objects, manifests):
        if directory.exists():
            checked_directory(directory, "BACKUP_SUBDIRECTORY")
        else:
            directory.mkdir(mode=0o700)
    return objects, manifests


def copy_object(source: Path, destination: Path, expected_size: int, expected_hash: str) -> bool:
    if destination.exists():
        metadata = destination.lstat()
        if destination.is_symlink() or not stat.S_ISREG(metadata.st_mode):
            raise MaintenanceError("BACKUP_OBJECT_INVALID")
        if metadata.st_size != expected_size or sha256_file(destination) != expected_hash:
            raise MaintenanceError("BACKUP_OBJECT_HASH_MISMATCH")
        return False
    descriptor, temporary_name = tempfile.mkstemp(prefix=".object.", dir=destination.parent)
    temporary = Path(temporary_name)
    try:
        with source.open("rb") as input_stream, os.fdopen(descriptor, "wb") as output_stream:
            shutil.copyfileobj(input_stream, output_stream, 1024 * 1024)
            output_stream.flush()
            os.fsync(output_stream.fileno())
        if temporary.stat().st_size != expected_size or sha256_file(temporary) != expected_hash:
            raise MaintenanceError("BACKUP_COPY_VERIFICATION_FAILED")
        os.chmod(temporary, 0o400)
        os.replace(temporary, destination)
        return True
    finally:
        temporary.unlink(missing_ok=True)


def read_manifest(root: Path, manifest_name: str = "latest.json") -> dict[str, object]:
    if manifest_name != "latest.json" and not re.fullmatch(r"[0-9]{8}T[0-9]{6}\.[0-9]{6}Z\.json", manifest_name):
        raise MaintenanceError("MANIFEST_NAME_INVALID")
    path = root / manifest_name if manifest_name == "latest.json" else root / "manifests" / manifest_name
    if not path.exists() or path.is_symlink() or not path.is_file():
        raise MaintenanceError("MANIFEST_NOT_FOUND")
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise MaintenanceError("MANIFEST_INVALID") from error
    if not isinstance(payload, dict) or payload.get("schema") != 1 or not isinstance(payload.get("files"), list):
        raise MaintenanceError("MANIFEST_INVALID")
    return payload


def validate_manifest_files(payload: dict[str, object]) -> list[dict[str, object]]:
    validated: list[dict[str, object]] = []
    names: set[str] = set()
    for raw in payload["files"]:
        if not isinstance(raw, dict):
            raise MaintenanceError("MANIFEST_ENTRY_INVALID")
        name, size, digest = raw.get("name"), raw.get("size"), raw.get("sha256")
        if (
            not isinstance(name, str)
            or not name.endswith(".mp4")
            or not LESSON_ID.fullmatch(name[:-4])
            or name in names
            or not isinstance(size, int)
            or size <= 0
            or not isinstance(digest, str)
            or not SHA256.fullmatch(digest)
        ):
            raise MaintenanceError("MANIFEST_ENTRY_INVALID")
        names.add(name)
        validated.append({"name": name, "size": size, "sha256": digest})
    return validated


def verify_objects(root: Path, files: list[dict[str, object]]) -> None:
    objects = checked_directory(root / "objects", "BACKUP_OBJECTS")
    for entry in files:
        path = objects / f"{entry['sha256']}.mp4"
        if not path.exists() or path.is_symlink() or not path.is_file():
            raise MaintenanceError("BACKUP_OBJECT_MISSING")
        if path.stat().st_size != entry["size"] or sha256_file(path) != entry["sha256"]:
            raise MaintenanceError("BACKUP_OBJECT_HASH_MISMATCH")


def command_check(args: argparse.Namespace) -> int:
    validate_limits(args)
    source_path = checked_directory(absolute_path(args.source, "SOURCE"), "SOURCE")
    files, invalid = scan_source(source_path, args.max_bytes)
    disk = disk_snapshot(source_path, args.warning_free_bytes, args.critical_free_bytes)
    status = "critical" if invalid else str(disk["status"])
    backup_status = "not-required" if not files else "missing"
    backup_age_hours: float | None = None
    backup_path = absolute_path(args.backup_root, "BACKUP_ROOT")
    if backup_path.exists():
        backup = checked_directory(backup_path, "BACKUP_ROOT")
        try:
            manifest = read_manifest(backup)
            created = dt.datetime.fromisoformat(str(manifest["createdAt"]).replace("Z", "+00:00"))
            backup_age_hours = round((utc_now() - created).total_seconds() / 3600, 1)
            backup_status = "current" if backup_age_hours <= args.max_backup_age_hours else "stale"
        except (MaintenanceError, KeyError, ValueError):
            backup_status = "invalid"
    if files and backup_status in {"missing", "invalid"}:
        status = "critical"
    elif files and backup_status == "stale" and status == "healthy":
        status = "attention"
    emit({
        **disk, "operation": "check", "status": status, "fileCount": len(files),
        "totalVideoBytes": sum(int(item["size"]) for item in files), "invalidEntries": invalid,
        "backupStatus": backup_status, "backupAgeHours": backup_age_hours,
    })
    return 2 if status == "critical" else 0


def command_backup(args: argparse.Namespace) -> int:
    validate_limits(args)
    backup_arg = absolute_path(args.backup_root, "BACKUP_ROOT")
    if not backup_arg.exists():
        checked_directory(backup_arg.parent, "BACKUP_PARENT")
        backup_arg.mkdir(mode=0o700)
    source, backup = validate_roots(args.source, args.backup_root)
    files, invalid = scan_source(source, args.max_bytes)
    if invalid:
        raise MaintenanceError("SOURCE_CONTAINS_INVALID_MP4")
    backup_disk = disk_snapshot(backup, args.warning_free_bytes, args.critical_free_bytes)
    if backup_disk["status"] == "critical":
        raise MaintenanceError("BACKUP_DISK_CRITICAL")
    with backup_lock(backup):
        objects, manifests = ensure_backup_layout(backup)
        copied = 0
        for entry in files:
            if copy_object(
                source / str(entry["name"]), objects / f"{entry['sha256']}.mp4",
                int(entry["size"]), str(entry["sha256"]),
            ):
                copied += 1
        created = utc_now()
        manifest = {"schema": 1, "createdAt": created.isoformat().replace("+00:00", "Z"), "files": files}
        manifest_name = created.strftime("%Y%m%dT%H%M%S.%fZ.json")
        atomic_json(manifests / manifest_name, manifest)
        atomic_json(backup / "latest.json", manifest)
    emit({
        "operation": "backup", "status": "healthy", "fileCount": len(files),
        "copiedObjects": copied, "reusedObjects": len(files) - copied,
        "totalVideoBytes": sum(int(item["size"]) for item in files), "manifest": manifest_name,
    })
    return 0


def command_verify(args: argparse.Namespace) -> int:
    _, backup = validate_roots(args.source, args.backup_root)
    payload = read_manifest(backup, args.manifest)
    files = validate_manifest_files(payload)
    verify_objects(backup, files)
    emit({
        "operation": "verify", "status": "healthy", "fileCount": len(files),
        "totalVideoBytes": sum(int(item["size"]) for item in files), "manifest": args.manifest,
    })
    return 0


def command_restore(args: argparse.Namespace) -> int:
    source, backup = validate_roots(args.source, args.backup_root)
    payload = read_manifest(backup, args.manifest)
    files = validate_manifest_files(payload)
    verify_objects(backup, files)
    if not args.apply:
        emit({"operation": "restore", "mode": "dry-run", "status": "ready", "fileCount": len(files)})
        return 0
    if args.confirm != "RESTORE_LOCAL_LESSON_VIDEOS":
        raise MaintenanceError("CONFIRMATION_REQUIRED")
    objects = backup / "objects"
    restored = 0
    for entry in files:
        destination = source / str(entry["name"])
        descriptor, temporary_name = tempfile.mkstemp(prefix=f".{entry['name']}.", dir=source)
        temporary = Path(temporary_name)
        try:
            with (objects / f"{entry['sha256']}.mp4").open("rb") as input_stream, os.fdopen(descriptor, "wb") as output_stream:
                shutil.copyfileobj(input_stream, output_stream, 1024 * 1024)
                output_stream.flush()
                os.fsync(output_stream.fileno())
            if temporary.stat().st_size != entry["size"] or sha256_file(temporary) != entry["sha256"]:
                raise MaintenanceError("RESTORE_COPY_VERIFICATION_FAILED")
            os.chmod(temporary, 0o644)
            os.replace(temporary, destination)
            restored += 1
        finally:
            temporary.unlink(missing_ok=True)
    emit({"operation": "restore", "mode": "applied", "status": "healthy", "restoredFiles": restored})
    return 0


def command_prune(args: argparse.Namespace) -> int:
    if args.retention_days < 1 or args.retention_days > 3650:
        raise MaintenanceError("RETENTION_DAYS_INVALID")
    _, backup = validate_roots(args.source, args.backup_root)
    with backup_lock(backup):
        objects, manifests = ensure_backup_layout(backup)
        latest = validate_manifest_files(read_manifest(backup))
        verify_objects(backup, latest)
        referenced = {str(entry["sha256"]) for entry in latest}
        cutoff = utc_now() - dt.timedelta(days=args.retention_days)
        expired_manifests: list[Path] = []
        retained_manifests = 0
        for path in sorted(manifests.iterdir(), key=lambda item: item.name):
            if path.is_symlink() or not path.is_file() or not re.fullmatch(
                r"[0-9]{8}T[0-9]{6}\.[0-9]{6}Z\.json", path.name
            ):
                raise MaintenanceError("BACKUP_MANIFEST_ENTRY_INVALID")
            created = dt.datetime.strptime(path.name, "%Y%m%dT%H%M%S.%fZ.json").replace(tzinfo=dt.timezone.utc)
            if created > utc_now() + dt.timedelta(minutes=5):
                raise MaintenanceError("BACKUP_MANIFEST_TIMESTAMP_FUTURE")
            files = validate_manifest_files(read_manifest(backup, path.name))
            if created < cutoff:
                expired_manifests.append(path)
            else:
                retained_manifests += 1
                referenced.update(str(entry["sha256"]) for entry in files)

        expired_objects: list[Path] = []
        reclaimed_bytes = 0
        for path in sorted(objects.iterdir(), key=lambda item: item.name):
            metadata = path.lstat()
            match = re.fullmatch(r"([a-f0-9]{64})\.mp4", path.name)
            if path.is_symlink() or not stat.S_ISREG(metadata.st_mode) or match is None:
                raise MaintenanceError("BACKUP_OBJECT_ENTRY_INVALID")
            if match.group(1) not in referenced:
                expired_objects.append(path)
                reclaimed_bytes += metadata.st_size

        if args.apply and args.confirm != "PRUNE_LOCAL_VIDEO_BACKUPS":
            raise MaintenanceError("CONFIRMATION_REQUIRED")
        if args.apply:
            for path in expired_manifests:
                path.unlink()
            for path in expired_objects:
                os.chmod(path, 0o600)
                path.unlink()
        emit({
            "operation": "prune", "mode": "applied" if args.apply else "dry-run", "status": "healthy",
            "retentionDays": args.retention_days, "retainedManifests": retained_manifests,
            "expiredManifests": len(expired_manifests), "expiredObjects": len(expired_objects),
            "reclaimedBytes": reclaimed_bytes if args.apply else 0,
            "reclaimableBytes": reclaimed_bytes,
        })
    return 0


def parser() -> argparse.ArgumentParser:
    result = argparse.ArgumentParser(description=__doc__)
    result.add_argument("command", choices=("check", "backup", "verify", "restore", "prune"))
    result.add_argument("--source", default=DEFAULT_SOURCE)
    result.add_argument("--backup-root", default=DEFAULT_BACKUP_ROOT)
    result.add_argument("--max-bytes", type=int, default=DEFAULT_MAX_BYTES)
    result.add_argument("--warning-free-bytes", type=int, default=DEFAULT_WARNING_FREE_BYTES)
    result.add_argument("--critical-free-bytes", type=int, default=DEFAULT_CRITICAL_FREE_BYTES)
    result.add_argument("--max-backup-age-hours", type=int, default=36)
    result.add_argument("--retention-days", type=int, default=30)
    result.add_argument("--manifest", default="latest.json")
    result.add_argument("--apply", action="store_true")
    result.add_argument("--confirm", default="")
    return result


def main() -> int:
    args = parser().parse_args()
    try:
        return {
            "check": command_check,
            "backup": command_backup,
            "verify": command_verify,
            "restore": command_restore,
            "prune": command_prune,
        }[args.command](args)
    except (MaintenanceError, OSError) as error:
        emit({"operation": args.command, "status": "critical", "error": str(error)})
        return 2


if __name__ == "__main__":
    sys.exit(main())
