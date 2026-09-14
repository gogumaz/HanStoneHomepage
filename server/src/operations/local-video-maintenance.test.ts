import { mkdtemp, mkdir, readFile, rm, unlink, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";

const temporaryRoots: string[] = [];
const script = resolve(process.cwd(), "../deploy/local-video-maintenance.py");
const python = process.platform === "win32" ? "python" : "python3";

function run(command: string, source: string, backup: string, extra: string[] = []) {
  return spawnSync(python, [
    script, command,
    "--source", source,
    "--backup-root", backup,
    "--max-bytes", "1024",
    "--warning-free-bytes", "2",
    "--critical-free-bytes", "1",
    ...extra,
  ], { encoding: "utf8" });
}

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("local video maintenance", () => {
  it("creates a content-addressed backup, verifies it, and requires confirmed restore", async () => {
    const root = await mkdtemp(join(tmpdir(), "hanstone-video-maintenance-"));
    temporaryRoots.push(root);
    const source = join(root, "source");
    const backup = join(root, "backup");
    await mkdir(source);
    await mkdir(backup);
    const video = Buffer.concat([Buffer.from([0, 0, 0, 20]), Buffer.from("ftypisomvideo")]);
    await writeFile(join(source, "LESSON-01.mp4"), video);

    const first = run("backup", source, backup);
    expect(first.status, first.stderr || first.stdout).toBe(0);
    expect(JSON.parse(first.stdout)).toMatchObject({ copiedObjects: 1, reusedObjects: 0 });
    const second = run("backup", source, backup);
    expect(second.status, second.stderr || second.stdout).toBe(0);
    expect(JSON.parse(second.stdout)).toMatchObject({ copiedObjects: 0, reusedObjects: 1 });
    expect(run("verify", source, backup).status).toBe(0);
    const check = run("check", source, backup);
    expect(check.status, check.stderr || check.stdout).toBe(0);
    expect(JSON.parse(check.stdout)).toMatchObject({ status: "healthy", backupStatus: "current" });

    await unlink(join(source, "LESSON-01.mp4"));
    expect(run("restore", source, backup, ["--apply"]).status).toBe(2);
    const restored = run("restore", source, backup, [
      "--apply", "--confirm", "RESTORE_LOCAL_LESSON_VIDEOS",
    ]);
    expect(restored.status, restored.stderr || restored.stdout).toBe(0);
    expect(await readFile(join(source, "LESSON-01.mp4"))).toEqual(video);
  });

  it("ships hardened timers and an explicit apply confirmation", async () => {
    const [installer, backupService, checkService, backupTimer] = await Promise.all([
      readFile(resolve(process.cwd(), "../deploy/configure-local-video-maintenance.sh"), "utf8"),
      readFile(resolve(process.cwd(), "../deploy/systemd/hanstone-local-video-backup.service"), "utf8"),
      readFile(resolve(process.cwd(), "../deploy/systemd/hanstone-local-video-check.service"), "utf8"),
      readFile(resolve(process.cwd(), "../deploy/systemd/hanstone-local-video-backup.timer"), "utf8"),
    ]);
    expect(installer).toContain("CONFIGURE_LOCAL_VIDEO_MAINTENANCE");
    expect(installer).toContain("systemctl enable --now");
    expect(backupService).toContain("ProtectSystem=strict");
    expect(backupService).toContain("ReadOnlyPaths=/var/www/hanstone/media/lessons");
    expect(checkService).toContain("local-video-maintenance.py check");
    expect(backupTimer).toContain("Persistent=true");
    expect([installer, backupService, checkService].join("\n")).not.toContain("rm -rf");
  });
});
