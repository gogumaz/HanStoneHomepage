import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Injectable } from "@nestjs/common";
import { loadAppConfig } from "../config/app-config.js";

type ProbeStream = { codec_type?: string; width?: number; height?: number };
type VideoProbe = { width: number; height: number; hasAudio: boolean };
type Rendition = { name: string; width: number; height: number; videoBitrate: number; audioBitrate: number };

class TranscodeError extends Error {
  constructor(code: string) {
    super(code);
    this.name = code;
  }
}

function bitrateFor(height: number): { video: number; audio: number } {
  if (height <= 360) return { video: 800_000, audio: 96_000 };
  return { video: 2_800_000, audio: 128_000 };
}

function renditionsFor(probe: VideoProbe): Rendition[] {
  const maximum = Math.min(720, probe.height);
  const heights = [360, 720].filter((height) => height <= maximum);
  if (!heights.includes(maximum)) heights.push(maximum);
  return [...new Set(heights)].sort((left, right) => left - right).map((height) => {
    const width = Math.max(2, Math.floor((probe.width * height / probe.height) / 2) * 2);
    const bitrate = bitrateFor(height);
    return {
      name: `${height}p`,
      width,
      height,
      videoBitrate: bitrate.video,
      audioBitrate: bitrate.audio,
    };
  });
}

@Injectable()
export class HlsTranscoderService {
  private readonly ffmpegPath: string;
  private readonly ffprobePath: string;
  private readonly segmentDuration: number;
  private readonly processTimeoutMs: number;

  constructor() {
    const config = loadAppConfig();
    this.ffmpegPath = config.ffmpegPath;
    this.ffprobePath = config.ffprobePath;
    this.segmentDuration = config.hlsSegmentDurationSeconds;
    this.processTimeoutMs = Math.max(60_000, config.hlsTranscodeLockTimeoutMs - 60_000);
  }

  async verifyBinaries(): Promise<void> {
    await this.run(this.ffmpegPath, ["-version"], "FFMPEG_NOT_AVAILABLE");
    await this.run(this.ffprobePath, ["-version"], "FFPROBE_NOT_AVAILABLE");
  }

  async transcode(inputPath: string, outputDirectory: string): Promise<{ renditionCount: number }> {
    const probe = await this.probe(inputPath);
    const renditions = renditionsFor(probe);
    await mkdir(outputDirectory, { recursive: true });
    for (const rendition of renditions) {
      const directory = join(outputDirectory, rendition.name);
      await mkdir(directory, { recursive: true });
      await this.run(this.ffmpegPath, [
        "-nostdin",
        "-hide_banner",
        "-loglevel", "error",
        "-y",
        "-i", inputPath,
        "-map", "0:v:0",
        "-map", "0:a:0?",
        "-vf", `scale=-2:${rendition.height}`,
        "-c:v", "libx264",
        "-preset", "medium",
        "-profile:v", "main",
        "-pix_fmt", "yuv420p",
        "-b:v", String(rendition.videoBitrate),
        "-maxrate", String(Math.round(rendition.videoBitrate * 1.07)),
        "-bufsize", String(rendition.videoBitrate * 2),
        "-force_key_frames", `expr:gte(t,n_forced*${this.segmentDuration})`,
        "-c:a", "aac",
        "-b:a", String(rendition.audioBitrate),
        "-ac", "2",
        "-ar", "48000",
        "-f", "hls",
        "-hls_time", String(this.segmentDuration),
        "-hls_playlist_type", "vod",
        "-hls_list_size", "0",
        "-hls_segment_type", "fmp4",
        "-hls_fmp4_init_filename", "init.mp4",
        "-hls_segment_filename", "segment-%05d.m4s",
        "index.m3u8",
      ], "HLS_TRANSCODE_FAILED", false, directory);
    }
    const master = ["#EXTM3U", "#EXT-X-VERSION:7"];
    for (const rendition of renditions) {
      const bandwidth = rendition.videoBitrate + (probe.hasAudio ? rendition.audioBitrate : 0);
      const codecs = probe.hasAudio ? 'CODECS="avc1.4d401f,mp4a.40.2",' : 'CODECS="avc1.4d401f",';
      master.push(
        `#EXT-X-STREAM-INF:BANDWIDTH=${bandwidth},AVERAGE-BANDWIDTH=${bandwidth},${codecs}RESOLUTION=${rendition.width}x${rendition.height}`,
        `${rendition.name}/index.m3u8`,
      );
    }
    await writeFile(join(outputDirectory, "master.m3u8"), `${master.join("\n")}\n`, { encoding: "utf8", flag: "wx" });
    return { renditionCount: renditions.length };
  }

  private async probe(inputPath: string): Promise<VideoProbe> {
    const output = await this.run(this.ffprobePath, [
      "-v", "error",
      "-show_entries", "stream=codec_type,width,height",
      "-of", "json",
      inputPath,
    ], "FFPROBE_FAILED", true);
    try {
      const parsed = JSON.parse(output) as { streams?: ProbeStream[] };
      const streams = parsed.streams ?? [];
      const video = streams.find((stream) => stream.codec_type === "video");
      if (
        !video
        || !Number.isInteger(video.width)
        || !Number.isInteger(video.height)
        || (video.width as number) <= 0
        || (video.height as number) <= 0
        || (video.width as number) > 16_384
        || (video.height as number) > 16_384
      ) throw new Error("invalid dimensions");
      return {
        width: video.width as number,
        height: video.height as number,
        hasAudio: streams.some((stream) => stream.codec_type === "audio"),
      };
    } catch {
      throw new TranscodeError("VIDEO_PROBE_INVALID");
    }
  }

  private run(
    command: string,
    args: string[],
    failureCode: string,
    captureStdout = false,
    cwd?: string,
  ): Promise<string> {
    return new Promise((resolvePromise, reject) => {
      const child = spawn(command, args, {
        shell: false,
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
        timeout: this.processTimeoutMs,
        ...(cwd ? { cwd } : {}),
      });
      const stdout: Buffer[] = [];
      let stdoutBytes = 0;
      let settled = false;
      const fail = () => {
        if (settled) return;
        settled = true;
        reject(new TranscodeError(failureCode));
      };
      child.stdout.on("data", (chunk: Buffer) => {
        if (!captureStdout) return;
        stdoutBytes += chunk.length;
        if (stdoutBytes > 1024 * 1024) {
          child.kill("SIGTERM");
          fail();
        } else stdout.push(chunk);
      });
      child.stderr.resume();
      child.once("error", fail);
      child.once("close", (code) => {
        if (settled) return;
        settled = true;
        if (code !== 0) return reject(new TranscodeError(failureCode));
        resolvePromise(captureStdout ? Buffer.concat(stdout).toString("utf8") : "");
      });
    });
  }
}
