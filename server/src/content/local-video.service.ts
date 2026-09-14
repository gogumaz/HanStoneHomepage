import { constants, createReadStream } from "node:fs";
import { access, lstat, readdir, statfs } from "node:fs/promises";
import { resolve } from "node:path";
import { HttpStatus, Injectable } from "@nestjs/common";
import { ApiError } from "../common/api-error.js";
import { loadAppConfig } from "../config/app-config.js";

const SAFE_LESSON_ID = /^[A-Z0-9][A-Z0-9-]{2,39}$/u;

export type LocalVideoFile = {
  fileName: string;
  path: string;
  size: number;
  stream: ReturnType<typeof createReadStream>;
};

export type LocalVideoStorageHealth = {
  enabled: boolean;
  status: "disabled" | "healthy" | "attention" | "critical";
  fileCount: number;
  totalVideoBytes: number;
  capacityBytes: number | null;
  availableBytes: number | null;
  usedPercent: number | null;
  invalidEntries: number;
  warningFreeBytes: number;
  criticalFreeBytes: number;
};

@Injectable()
export class LocalVideoService {
  private readonly mode: "object-storage" | "local-download";
  private readonly root: string | null;
  private readonly maxBytes: number;
  private readonly warningFreeBytes: number;
  private readonly criticalFreeBytes: number;

  constructor() {
    const config = loadAppConfig();
    this.mode = config.mediaDeliveryMode;
    this.root = config.localVideoRoot;
    this.maxBytes = config.localVideoMaxBytes;
    this.warningFreeBytes = config.localVideoWarningFreeBytes;
    this.criticalFreeBytes = config.localVideoCriticalFreeBytes;
  }

  isEnabled(): boolean {
    return this.mode === "local-download";
  }

  async verifyRoot(): Promise<void> {
    if (!this.isEnabled() || !this.root) throw new Error("LOCAL_VIDEO_MODE_NOT_CONFIGURED");
    const metadata = await lstat(this.root);
    if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
      throw new Error("LOCAL_VIDEO_ROOT_INVALID");
    }
    await access(this.root, constants.R_OK);
  }

  async hasVideo(lessonId: string): Promise<boolean> {
    return Boolean(await this.findVideo(lessonId));
  }

  async inspectStorage(): Promise<LocalVideoStorageHealth> {
    const base = {
      fileCount: 0,
      totalVideoBytes: 0,
      capacityBytes: null,
      availableBytes: null,
      usedPercent: null,
      invalidEntries: 0,
      warningFreeBytes: this.warningFreeBytes,
      criticalFreeBytes: this.criticalFreeBytes,
    };
    if (!this.isEnabled() || !this.root) {
      return { enabled: false, status: "disabled", ...base };
    }
    try {
      await this.verifyRoot();
      const [filesystem, entries] = await Promise.all([
        statfs(this.root, { bigint: true }),
        readdir(this.root, { withFileTypes: true }),
      ]);
      let fileCount = 0;
      let totalVideoBytes = 0;
      let invalidEntries = 0;
      for (const entry of entries) {
        if (!entry.name.toLowerCase().endsWith(".mp4")) continue;
        const lessonId = entry.name.slice(0, -4);
        if (!SAFE_LESSON_ID.test(lessonId) || !entry.isFile() || entry.isSymbolicLink()) {
          invalidEntries += 1;
          continue;
        }
        const metadata = await lstat(resolve(this.root, entry.name));
        if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.size <= 0 || metadata.size > this.maxBytes) {
          invalidEntries += 1;
          continue;
        }
        fileCount += 1;
        totalVideoBytes += metadata.size;
      }
      const capacityBytes = Number(filesystem.blocks * filesystem.bsize);
      const availableBytes = Number(filesystem.bavail * filesystem.bsize);
      const usedPercent = capacityBytes > 0
        ? Math.round(((capacityBytes - availableBytes) / capacityBytes) * 1_000) / 10
        : 100;
      const status = invalidEntries > 0 || availableBytes <= this.criticalFreeBytes
        ? "critical"
        : availableBytes <= this.warningFreeBytes ? "attention" : "healthy";
      return {
        enabled: true,
        status,
        fileCount,
        totalVideoBytes,
        capacityBytes,
        availableBytes,
        usedPercent,
        invalidEntries,
        warningFreeBytes: this.warningFreeBytes,
        criticalFreeBytes: this.criticalFreeBytes,
      };
    } catch {
      return { enabled: true, status: "critical", ...base, invalidEntries: 1 };
    }
  }

  async openVideo(lessonId: string): Promise<LocalVideoFile> {
    const video = await this.findVideo(lessonId);
    if (!video) {
      throw new ApiError(
        "LOCAL_VIDEO_NOT_AVAILABLE",
        "현재 내려받을 수 있는 강의 영상이 없습니다.",
        HttpStatus.NOT_FOUND,
      );
    }
    return { ...video, stream: createReadStream(video.path) };
  }

  private async findVideo(lessonId: string): Promise<Omit<LocalVideoFile, "stream"> | null> {
    if (!this.isEnabled() || !this.root) return null;
    if (!SAFE_LESSON_ID.test(lessonId)) {
      throw new ApiError("INVALID_LESSON_ID", "강의 ID 형식을 확인해 주세요.", HttpStatus.BAD_REQUEST);
    }
    try {
      // Never construct a filesystem path from request data. Select an exact,
      // regular entry from the configured directory and use its filesystem-provided
      // name for all subsequent path operations.
      const requestedFileName = `${lessonId}.mp4`;
      const entries = await readdir(this.root, { withFileTypes: true });
      const entry = entries.find((candidate) => (
        candidate.name === requestedFileName
        && candidate.isFile()
        && !candidate.isSymbolicLink()
      ));
      if (!entry) return null;

      const path = resolve(this.root, entry.name);
      const metadata = await lstat(path);
      if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.size <= 0) return null;
      if (metadata.size > this.maxBytes) {
        throw new ApiError(
          "LOCAL_VIDEO_TOO_LARGE",
          "브라우저 다운로드 재생 한도를 초과한 영상입니다.",
          HttpStatus.PAYLOAD_TOO_LARGE,
        );
      }
      return { fileName: entry.name, path, size: metadata.size };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
  }
}
