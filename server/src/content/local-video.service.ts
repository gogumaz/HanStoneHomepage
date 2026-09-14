import { constants, createReadStream } from "node:fs";
import { access, lstat } from "node:fs/promises";
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

@Injectable()
export class LocalVideoService {
  private readonly mode: "object-storage" | "local-download";
  private readonly root: string | null;
  private readonly maxBytes: number;

  constructor() {
    const config = loadAppConfig();
    this.mode = config.mediaDeliveryMode;
    this.root = config.localVideoRoot;
    this.maxBytes = config.localVideoMaxBytes;
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
    const fileName = `${lessonId}.mp4`;
    const path = resolve(this.root, fileName);
    try {
      const metadata = await lstat(path);
      if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.size <= 0) return null;
      if (metadata.size > this.maxBytes) {
        throw new ApiError(
          "LOCAL_VIDEO_TOO_LARGE",
          "브라우저 다운로드 재생 한도를 초과한 영상입니다.",
          HttpStatus.PAYLOAD_TOO_LARGE,
        );
      }
      return { fileName, path, size: metadata.size };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
  }
}
