import { spawn } from "node:child_process";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

function run(command, args) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, { shell: false, stdio: "inherit", windowsHide: true });
    child.once("error", reject);
    child.once("close", (code) => code === 0 ? resolvePromise() : reject(new Error("SMOKE_COMMAND_FAILED")));
  });
}

async function collectFiles(directory, root = directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const names = [];
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) names.push(...await collectFiles(path, root));
    else if (entry.isFile()) names.push(path.slice(root.length + 1).replaceAll("\\", "/"));
  }
  return names;
}

process.env.DATABASE_URL ??= "postgresql://smoke:smoke@127.0.0.1:5432/smoke";
const temporaryRoot = await mkdtemp(join(tmpdir(), "baduk-hls-smoke-"));
const resolvedRoot = resolve(temporaryRoot);
const resolvedTemp = resolve(tmpdir());
if (!resolvedRoot.startsWith(resolvedTemp)) throw new Error("UNSAFE_SMOKE_PATH");

try {
  const inputPath = join(temporaryRoot, "source.mp4");
  const outputDirectory = join(temporaryRoot, "output");
  await run(process.env.FFMPEG_PATH || "ffmpeg", [
    "-nostdin", "-hide_banner", "-loglevel", "error",
    "-f", "lavfi", "-i", "testsrc=size=640x360:rate=24",
    "-f", "lavfi", "-i", "sine=frequency=1000:sample_rate=48000",
    "-t", "2", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-y", inputPath,
  ]);
  const { HlsTranscoderService } = await import("../dist/content/hls-transcoder.service.js");
  const service = new HlsTranscoderService();
  await service.verifyBinaries();
  const result = await service.transcode(inputPath, outputDirectory);
  const master = await readFile(join(outputDirectory, "master.m3u8"), "utf8");
  const files = await collectFiles(outputDirectory);
  if (
    result.renditionCount !== 1
    || !master.includes("360p/index.m3u8")
    || !files.includes("360p/init.mp4")
    || !files.some((file) => /^360p\/segment-\d{5}\.m4s$/.test(file))
  ) throw new Error("HLS_SMOKE_OUTPUT_INVALID");
  process.stdout.write(`${JSON.stringify({ ok: true, ...result, files: files.length })}\n`);
} finally {
  await rm(resolvedRoot, { recursive: true, force: true });
}
