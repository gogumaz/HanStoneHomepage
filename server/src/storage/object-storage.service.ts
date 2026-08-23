import { randomUUID } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import { posix, relative, resolve, sep } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import {
  DeleteObjectsCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
  type HeadObjectCommandOutput,
  type S3ClientConfig,
} from "@aws-sdk/client-s3";
import { createPresignedPost } from "@aws-sdk/s3-presigned-post";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { HttpStatus, Injectable } from "@nestjs/common";
import { ApiError } from "../common/api-error.js";
import { loadAppConfig } from "../config/app-config.js";

const SAFE_OBJECT_KEY = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,1023}$/;
const VIDEO_CONTENT_TYPE = "video/mp4";
const HLS_MANIFEST_CONTENT_TYPES = new Set([
  "application/vnd.apple.mpegurl",
  "application/x-mpegurl",
  "audio/mpegurl",
  "audio/x-mpegurl",
  "application/octet-stream",
]);
const HLS_MANIFEST_MAX_BYTES = 1024 * 1024;

function hlsContentType(fileName: string): string {
  if (fileName.endsWith(".m3u8")) return "application/vnd.apple.mpegurl";
  if (fileName.endsWith(".m4s")) return "video/iso.segment";
  if (fileName.endsWith(".mp4")) return "video/mp4";
  throw new Error("HLS_OUTPUT_FILE_INVALID");
}

async function listFiles(root: string, directory = root): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) files.push(...await listFiles(root, path));
    else if (entry.isFile()) files.push(path);
    else throw new Error("HLS_OUTPUT_FILE_INVALID");
  }
  return files;
}

function contentDisposition(fileName: string, inline: boolean): string {
  const safeName = fileName.replace(/[\\\r\n"]/g, "_").trim() || "download";
  const asciiName = safeName.replace(/[^\x20-\x7e]/g, "_");
  const encodedName = encodeURIComponent(safeName)
    .replace(/[!'()*]/g, (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`);
  return `${inline ? "inline" : "attachment"}; filename="${asciiName}"; filename*=UTF-8''${encodedName}`;
}

@Injectable()
export class ObjectStorageService {
  private readonly bucket: string | null;
  private readonly ttlSeconds: number;
  private readonly uploadTtlSeconds: number;
  private readonly maxVideoBytes: number;
  private readonly maxLessonAssetBytes: number;
  private readonly client: S3Client | null;

  constructor() {
    const config = loadAppConfig();
    this.bucket = config.objectStorageBucket;
    this.ttlSeconds = config.playbackUrlTtlSeconds;
    this.uploadTtlSeconds = config.videoUploadUrlTtlSeconds;
    this.maxVideoBytes = config.videoUploadMaxBytes;
    this.maxLessonAssetBytes = config.lessonAssetMaxBytes;
    const clientConfig: S3ClientConfig = {
      region: config.objectStorageRegion,
      forcePathStyle: config.objectStorageForcePathStyle,
      ...(config.objectStorageEndpoint ? { endpoint: config.objectStorageEndpoint } : {}),
      ...(config.objectStorageAccessKeyId && config.objectStorageSecretAccessKey
        ? {
            credentials: {
              accessKeyId: config.objectStorageAccessKeyId,
              secretAccessKey: config.objectStorageSecretAccessKey,
            },
          }
        : {}),
    };
    this.client = this.bucket ? new S3Client(clientConfig) : null;
  }

  isConfigured(): boolean {
    return Boolean(this.client && this.bucket);
  }

  getVideoUploadMaxBytes(): number {
    return this.maxVideoBytes;
  }

  getLessonAssetMaxBytes(): number {
    return this.maxLessonAssetBytes;
  }

  getPlaybackExpiresAt(): Date {
    return new Date(Date.now() + this.ttlSeconds * 1000);
  }

  async createLessonAssetUpload(input: {
    assetId: string;
    lessonId: string;
    contentType: string;
    size: number;
    extension: string;
  }): Promise<{
    method: "POST";
    url: string;
    fields: Record<string, string>;
    objectKey: string;
    expiresAt: Date;
  }> {
    if (!this.client || !this.bucket) {
      throw new ApiError("OBJECT_STORAGE_NOT_CONFIGURED", "파일 저장소 연결이 필요합니다.", HttpStatus.SERVICE_UNAVAILABLE);
    }
    const objectKey = `lesson-assets/${input.assetId}/source.${input.extension}`;
    try {
      const signed = await createPresignedPost(this.client, {
        Bucket: this.bucket,
        Key: objectKey,
        Expires: this.uploadTtlSeconds,
        Fields: {
          "Content-Type": input.contentType,
          "x-amz-meta-asset-id": input.assetId,
          "x-amz-meta-lesson-id": input.lessonId,
          "x-amz-meta-expected-size": String(input.size),
        },
        Conditions: [
          ["content-length-range", 1, this.maxLessonAssetBytes],
          ["eq", "$Content-Type", input.contentType],
          ["eq", "$x-amz-meta-asset-id", input.assetId],
          ["eq", "$x-amz-meta-lesson-id", input.lessonId],
          ["eq", "$x-amz-meta-expected-size", String(input.size)],
        ],
      });
      return {
        method: "POST",
        url: signed.url,
        fields: signed.fields,
        objectKey,
        expiresAt: new Date(Date.now() + this.uploadTtlSeconds * 1000),
      };
    } catch {
      throw new ApiError("UPLOAD_URL_SIGNING_FAILED", "파일 업로드 URL을 발급하지 못했습니다.", HttpStatus.SERVICE_UNAVAILABLE);
    }
  }

  async inspectLessonAsset(input: {
    objectKey: string;
    assetId: string;
    lessonId: string;
    contentType: string;
    size: number;
  }): Promise<Uint8Array> {
    if (!this.client || !this.bucket) {
      throw new ApiError("OBJECT_STORAGE_NOT_CONFIGURED", "파일 저장소 연결이 필요합니다.", HttpStatus.SERVICE_UNAVAILABLE);
    }
    this.assertSafeKey(input.objectKey);
    if (!input.objectKey.startsWith(`lesson-assets/${input.assetId}/`)) {
      throw new ApiError("INVALID_LESSON_ASSET", "학습자료 저장 경로를 확인해 주세요.", HttpStatus.BAD_REQUEST);
    }
    let head: HeadObjectCommandOutput;
    try {
      head = await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: input.objectKey }));
    } catch {
      throw new ApiError("LESSON_ASSET_NOT_FOUND", "업로드된 학습자료를 찾을 수 없습니다.", HttpStatus.CONFLICT);
    }
    if (
      head.ContentType !== input.contentType
      || head.ContentLength !== input.size
      || head.Metadata?.["asset-id"] !== input.assetId
      || head.Metadata?.["lesson-id"] !== input.lessonId
      || head.Metadata?.["expected-size"] !== String(input.size)
      || input.size <= 0
      || input.size > this.maxLessonAssetBytes
    ) {
      throw new ApiError(
        "LESSON_ASSET_METADATA_INVALID",
        "업로드된 파일의 형식·크기·강의 정보가 요청과 일치하지 않습니다.",
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }
    try {
      const object = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: input.objectKey }));
      const bytes = object.Body ? await object.Body.transformToByteArray() : new Uint8Array();
      if (bytes.length !== input.size) throw new Error("size mismatch");
      return bytes;
    } catch {
      throw new ApiError(
        "LESSON_ASSET_INSPECTION_FAILED",
        "업로드된 파일을 검사하지 못해 격리 상태로 유지합니다.",
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
  }

  async createVideoUpload(
    lessonId: string,
    expectedSize: number,
  ): Promise<{
    method: "POST";
    url: string;
    fields: Record<string, string>;
    assetKey: string;
    expiresAt: Date;
  }> {
    if (!this.client || !this.bucket) {
      throw new ApiError(
        "OBJECT_STORAGE_NOT_CONFIGURED",
        "영상 저장소 연결이 필요합니다.",
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
    const assetKey = `lesson-videos/${randomUUID()}.mp4`;
    try {
      const signed = await createPresignedPost(this.client, {
        Bucket: this.bucket,
        Key: assetKey,
        Expires: this.uploadTtlSeconds,
        Fields: {
          "Content-Type": VIDEO_CONTENT_TYPE,
          "x-amz-meta-lesson-id": lessonId,
          "x-amz-meta-expected-size": String(expectedSize),
        },
        Conditions: [
          ["content-length-range", 1, this.maxVideoBytes],
          ["eq", "$Content-Type", VIDEO_CONTENT_TYPE],
          ["eq", "$x-amz-meta-lesson-id", lessonId],
          ["eq", "$x-amz-meta-expected-size", String(expectedSize)],
        ],
      });
      return {
        method: "POST",
        url: signed.url,
        fields: signed.fields,
        assetKey,
        expiresAt: new Date(Date.now() + this.uploadTtlSeconds * 1000),
      };
    } catch {
      throw new ApiError(
        "UPLOAD_URL_SIGNING_FAILED",
        "영상 업로드 URL을 발급하지 못했습니다.",
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
  }

  async inspectVideoUpload(
    assetKey: string,
    lessonId: string,
  ): Promise<{ assetKey: string; contentType: string; size: number }> {
    if (!this.client || !this.bucket) {
      throw new ApiError(
        "OBJECT_STORAGE_NOT_CONFIGURED",
        "영상 저장소 연결이 필요합니다.",
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
    this.assertSafeKey(assetKey);
    if (!assetKey.startsWith("lesson-videos/") || !assetKey.endsWith(".mp4")) {
      throw new ApiError("INVALID_VIDEO_ASSET", "영상 자산 설정을 확인해 주세요.", HttpStatus.BAD_REQUEST);
    }

    let head: HeadObjectCommandOutput;
    try {
      head = await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: assetKey }));
    } catch {
      throw new ApiError("VIDEO_UPLOAD_NOT_FOUND", "업로드된 영상을 찾을 수 없습니다.", HttpStatus.CONFLICT);
    }
    const size = head.ContentLength ?? 0;
    const expectedSize = Number(head.Metadata?.["expected-size"] ?? 0);
    if (
      head.ContentType !== VIDEO_CONTENT_TYPE
      || head.Metadata?.["lesson-id"] !== lessonId
      || !Number.isSafeInteger(size)
      || size <= 0
      || size > this.maxVideoBytes
      || !Number.isSafeInteger(expectedSize)
      || expectedSize !== size
    ) {
      throw new ApiError(
        "VIDEO_UPLOAD_METADATA_INVALID",
        "업로드된 영상의 형식 또는 크기가 요청과 일치하지 않습니다.",
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }

    let signature: Uint8Array;
    try {
      const object = await this.client.send(new GetObjectCommand({
        Bucket: this.bucket,
        Key: assetKey,
        Range: "bytes=0-11",
      }));
      signature = object.Body ? await object.Body.transformToByteArray() : new Uint8Array();
    } catch {
      throw new ApiError(
        "VIDEO_UPLOAD_INSPECTION_FAILED",
        "업로드된 영상 파일을 검사하지 못했습니다.",
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
    const firstBoxSize = signature.length >= 4
      ? new DataView(signature.buffer, signature.byteOffset, signature.byteLength).getUint32(0)
      : 0;
    const boxType = new TextDecoder("ascii").decode(signature.slice(4, 8));
    if (signature.length < 12 || firstBoxSize < 8 || boxType !== "ftyp") {
      throw new ApiError(
        "VIDEO_FILE_SIGNATURE_INVALID",
        "MP4 파일 시그니처를 확인할 수 없습니다.",
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }
    return { assetKey, contentType: VIDEO_CONTENT_TYPE, size };
  }

  async openVideoScanStream(objectKey: string): Promise<AsyncIterable<Uint8Array>> {
    if (!this.client || !this.bucket) {
      throw new ApiError(
        "OBJECT_STORAGE_NOT_CONFIGURED",
        "영상 저장소 연결이 필요합니다.",
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
    this.assertSafeKey(objectKey);
    if (!objectKey.startsWith("lesson-videos/") || !objectKey.endsWith(".mp4")) {
      throw new ApiError("INVALID_VIDEO_ASSET", "영상 자산 설정을 확인해 주세요.", HttpStatus.BAD_REQUEST);
    }
    try {
      const object = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: objectKey }));
      const body = object.Body;
      if (!body || !(Symbol.asyncIterator in Object(body))) throw new Error("stream unavailable");
      return body as AsyncIterable<Uint8Array>;
    } catch {
      throw new ApiError(
        "VIDEO_SCAN_STREAM_FAILED",
        "악성코드 검사용 영상 스트림을 열지 못했습니다.",
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
  }

  async downloadVideoToFile(objectKey: string, destination: string): Promise<void> {
    if (!this.client || !this.bucket) {
      throw new ApiError("OBJECT_STORAGE_NOT_CONFIGURED", "영상 저장소 연결이 필요합니다.", HttpStatus.SERVICE_UNAVAILABLE);
    }
    this.assertSafeKey(objectKey);
    if (!objectKey.startsWith("lesson-videos/") || !objectKey.endsWith(".mp4")) {
      throw new ApiError("INVALID_VIDEO_ASSET", "영상 자산 경로를 확인해 주세요.", HttpStatus.BAD_REQUEST);
    }
    try {
      const object = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: objectKey }));
      if (!object.Body || !(Symbol.asyncIterator in Object(object.Body))) throw new Error("stream unavailable");
      await pipeline(
        Readable.from(object.Body as AsyncIterable<Uint8Array>),
        createWriteStream(destination, { flags: "wx" }),
      );
    } catch {
      throw new ApiError(
        "VIDEO_DOWNLOAD_FAILED",
        "HLS 변환용 원본 영상을 내려받지 못했습니다.",
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
  }

  async uploadHlsPackage(directory: string, prefix: string): Promise<{ manifestKey: string; fileCount: number }> {
    if (!this.client || !this.bucket) {
      throw new ApiError("OBJECT_STORAGE_NOT_CONFIGURED", "HLS 저장소 연결이 필요합니다.", HttpStatus.SERVICE_UNAVAILABLE);
    }
    const normalizedPrefix = prefix.replace(/\/$/, "");
    this.assertHlsPrefix(normalizedPrefix);
    const root = resolve(directory);
    const uploaded: string[] = [];
    try {
      const files = await listFiles(root);
      const relativeNames = files.map((file) => relative(root, file).split(sep).join("/"));
      if (!relativeNames.includes("master.m3u8") || files.length < 3 || files.length > 10_000) {
        throw new Error("HLS_OUTPUT_INCOMPLETE");
      }
      for (let index = 0; index < files.length; index += 1) {
        const file = files[index];
        const relativeName = relativeNames[index];
        if (!file || !relativeName || relativeName.startsWith("../")) throw new Error("HLS_OUTPUT_FILE_INVALID");
        const objectKey = `${normalizedPrefix}/${relativeName}`;
        this.assertHlsKey(objectKey, relativeName.endsWith(".m3u8"));
        const metadata = await stat(file);
        if (!metadata.isFile() || metadata.size <= 0) throw new Error("HLS_OUTPUT_FILE_INVALID");
        await this.client.send(new PutObjectCommand({
          Bucket: this.bucket,
          Key: objectKey,
          Body: createReadStream(file),
          ContentLength: metadata.size,
          ContentType: hlsContentType(relativeName),
          CacheControl: relativeName.endsWith(".m3u8") ? "private, no-cache" : "public, max-age=31536000, immutable",
        }));
        uploaded.push(objectKey);
      }
      return { manifestKey: `${normalizedPrefix}/master.m3u8`, fileCount: uploaded.length };
    } catch {
      if (uploaded.length > 0) {
        try {
          for (let index = 0; index < uploaded.length; index += 1000) {
            await this.client.send(new DeleteObjectsCommand({
              Bucket: this.bucket,
              Delete: { Objects: uploaded.slice(index, index + 1000).map((Key) => ({ Key })), Quiet: true },
            }));
          }
        } catch {
          // The worker records the upload failure; lifecycle cleanup remains the final safety net.
        }
      }
      throw new ApiError("HLS_UPLOAD_FAILED", "HLS 패키지를 저장하지 못했습니다.", HttpStatus.SERVICE_UNAVAILABLE);
    }
  }

  async deleteHlsPackage(prefix: string): Promise<void> {
    if (!this.client || !this.bucket) {
      throw new ApiError("OBJECT_STORAGE_NOT_CONFIGURED", "HLS 저장소 연결이 필요합니다.", HttpStatus.SERVICE_UNAVAILABLE);
    }
    const normalizedPrefix = prefix.replace(/\/$/, "");
    this.assertHlsPrefix(normalizedPrefix);
    let continuationToken: string | undefined;
    try {
      do {
        const listed = await this.client.send(new ListObjectsV2Command({
          Bucket: this.bucket,
          Prefix: `${normalizedPrefix}/`,
          ContinuationToken: continuationToken,
        }));
        const objects = (listed.Contents ?? []).flatMap(({ Key }) => Key ? [{ Key }] : []);
        if (objects.length > 0) {
          await this.client.send(new DeleteObjectsCommand({
            Bucket: this.bucket,
            Delete: { Objects: objects, Quiet: true },
          }));
        }
        continuationToken = listed.IsTruncated ? listed.NextContinuationToken : undefined;
      } while (continuationToken);
    } catch {
      throw new ApiError("HLS_DELETE_FAILED", "HLS 패키지를 정리하지 못했습니다.", HttpStatus.SERVICE_UNAVAILABLE);
    }
  }

  async deleteVideoObject(objectKey: string): Promise<void> {
    if (!this.client || !this.bucket) {
      throw new ApiError(
        "OBJECT_STORAGE_NOT_CONFIGURED",
        "영상 저장소 연결이 필요합니다.",
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
    this.assertSafeKey(objectKey);
    if (!objectKey.startsWith("lesson-videos/") || !objectKey.endsWith(".mp4")) {
      throw new ApiError("INVALID_VIDEO_ASSET", "영상 자산 설정을 확인해 주세요.", HttpStatus.BAD_REQUEST);
    }
    try {
      await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: objectKey }));
    } catch {
      throw new ApiError(
        "VIDEO_OBJECT_DELETE_FAILED",
        "영상 객체를 정리하지 못했습니다.",
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
  }

  async verifyVideoStorageAccess(): Promise<void> {
    if (!this.client || !this.bucket) {
      throw new ApiError(
        "OBJECT_STORAGE_NOT_CONFIGURED",
        "영상 저장소 연결이 필요합니다.",
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
    const objectKey = `lesson-videos/preflight/${randomUUID()}.mp4`;
    const probe = Uint8Array.from([98, 97, 100, 117, 107, 45, 112, 114, 101, 102, 108, 105, 103, 104, 116]);
    let failed = false;
    try {
      await this.client.send(new PutObjectCommand({
        Bucket: this.bucket,
        Key: objectKey,
        Body: probe,
        ContentType: "application/octet-stream",
      }));
      const object = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: objectKey }));
      const received = object.Body ? await object.Body.transformToByteArray() : new Uint8Array();
      if (!Buffer.from(received).equals(Buffer.from(probe))) failed = true;
    } catch {
      failed = true;
    }
    try {
      await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: objectKey }));
    } catch {
      failed = true;
    }
    if (failed) {
      throw new ApiError(
        "OBJECT_STORAGE_PREFLIGHT_FAILED",
        "영상 저장소의 쓰기·읽기·삭제 권한을 확인하지 못했습니다.",
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
  }

  async verifyCdnDelivery(
    signUrl: (objectKey: string) => Promise<{ url: string }>,
  ): Promise<void> {
    if (!this.client || !this.bucket) {
      throw new ApiError(
        "OBJECT_STORAGE_NOT_CONFIGURED",
        "CDN 원본 저장소 연결이 필요합니다.",
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
    const objectKey = `lesson-hls/preflight/${randomUUID()}.m4s`;
    const probe = new TextEncoder().encode(`baduk-history-cdn-preflight-${randomUUID()}`);
    let failed = false;
    try {
      await this.client.send(new PutObjectCommand({
        Bucket: this.bucket,
        Key: objectKey,
        Body: probe,
        ContentType: "application/octet-stream",
        CacheControl: "no-store",
      }));
      const signed = await signUrl(objectKey);
      const response = await fetch(signed.url, {
        headers: { accept: "application/octet-stream" },
        signal: AbortSignal.timeout(10_000),
      });
      const received = new Uint8Array(await response.arrayBuffer());
      if (!response.ok || !Buffer.from(received).equals(Buffer.from(probe))) failed = true;
    } catch {
      failed = true;
    }
    try {
      await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: objectKey }));
    } catch {
      failed = true;
    }
    if (failed) {
      throw new ApiError(
        "CDN_PREFLIGHT_FAILED",
        "CDN 서명 URL을 통한 미디어 전달을 확인하지 못했습니다.",
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
  }

  async signPlaybackUrl(objectKey: string): Promise<{ url: string; expiresAt: Date }> {
    if (!this.client || !this.bucket) {
      throw new ApiError(
        "OBJECT_STORAGE_NOT_CONFIGURED",
        "영상 저장소 연결이 필요합니다.",
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
    this.assertSafeKey(objectKey);
    try {
      const url = await getSignedUrl(
        this.client,
        new GetObjectCommand({
          Bucket: this.bucket,
          Key: objectKey,
          ResponseCacheControl: "private, no-store",
          ResponseContentDisposition: "inline",
        }),
        { expiresIn: this.ttlSeconds },
      );
      return {
        url,
        expiresAt: new Date(Date.now() + this.ttlSeconds * 1000),
      };
    } catch {
      throw new ApiError(
        "PLAYBACK_URL_SIGNING_FAILED",
        "영상 재생 URL을 발급하지 못했습니다.",
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
  }

  async readHlsManifest(objectKey: string): Promise<string> {
    if (!this.client || !this.bucket) {
      throw new ApiError(
        "OBJECT_STORAGE_NOT_CONFIGURED",
        "HLS 재생목록 저장소 연결이 필요합니다.",
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
    this.assertHlsKey(objectKey, true);
    try {
      const head = await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: objectKey }));
      const size = head.ContentLength ?? 0;
      const contentType = head.ContentType?.toLowerCase() ?? "";
      if (size <= 0 || size > HLS_MANIFEST_MAX_BYTES || !HLS_MANIFEST_CONTENT_TYPES.has(contentType)) {
        throw new Error("manifest metadata invalid");
      }
      const object = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: objectKey }));
      const bytes = object.Body ? await object.Body.transformToByteArray() : new Uint8Array();
      if (bytes.length !== size || bytes.length > HLS_MANIFEST_MAX_BYTES) throw new Error("manifest size mismatch");
      return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new ApiError(
        "HLS_MANIFEST_UNAVAILABLE",
        "HLS 재생목록을 확인하지 못했습니다.",
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
  }

  async signHlsAssetUrl(objectKey: string): Promise<{ url: string; expiresAt: Date }> {
    if (!this.client || !this.bucket) {
      throw new ApiError(
        "OBJECT_STORAGE_NOT_CONFIGURED",
        "HLS 영상 저장소 연결이 필요합니다.",
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
    this.assertHlsKey(objectKey, false);
    try {
      const url = await getSignedUrl(
        this.client,
        new GetObjectCommand({
          Bucket: this.bucket,
          Key: objectKey,
          ResponseCacheControl: "private, no-store",
          ResponseContentDisposition: "inline",
        }),
        { expiresIn: this.ttlSeconds },
      );
      return { url, expiresAt: this.getPlaybackExpiresAt() };
    } catch {
      throw new ApiError(
        "PLAYBACK_URL_SIGNING_FAILED",
        "HLS 세그먼트 재생 URL을 발급하지 못했습니다.",
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
  }

  async signAssetUrl(
    objectKey: string,
    options: { contentType: string; fileName: string; inline: boolean },
  ): Promise<{ url: string; expiresAt: Date }> {
    if (!this.client || !this.bucket) {
      throw new ApiError(
        "OBJECT_STORAGE_NOT_CONFIGURED",
        "파일 저장소 연결이 필요합니다.",
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
    this.assertSafeKey(objectKey);
    try {
      const url = await getSignedUrl(
        this.client,
        new GetObjectCommand({
          Bucket: this.bucket,
          Key: objectKey,
          ResponseCacheControl: "private, no-store",
          ResponseContentType: options.contentType,
          ResponseContentDisposition: contentDisposition(options.fileName, options.inline),
        }),
        { expiresIn: this.ttlSeconds },
      );
      return { url, expiresAt: new Date(Date.now() + this.ttlSeconds * 1000) };
    } catch {
      throw new ApiError(
        "ASSET_URL_SIGNING_FAILED",
        "파일 다운로드 URL을 발급하지 못했습니다.",
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
  }

  private assertSafeKey(objectKey: string): void {
    const segments = objectKey.split("/");
    if (
      !SAFE_OBJECT_KEY.test(objectKey)
      || objectKey.startsWith("/")
      || segments.some((segment) => !segment || segment === "." || segment === "..")
    ) {
      throw new ApiError(
        "INVALID_VIDEO_ASSET",
        "영상 자산 설정을 확인해 주세요.",
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
  }

  private assertHlsKey(objectKey: string, manifest: boolean): void {
    this.assertSafeKey(objectKey);
    if (
      !objectKey.startsWith("lesson-hls/")
      || (manifest && !objectKey.toLowerCase().endsWith(".m3u8"))
      || (!manifest && objectKey.toLowerCase().endsWith(".m3u8"))
    ) {
      throw new ApiError(
        "INVALID_HLS_ASSET",
        "HLS 영상 자산 경로를 확인해 주세요.",
        HttpStatus.BAD_REQUEST,
      );
    }
  }

  private assertHlsPrefix(prefix: string): void {
    this.assertSafeKey(prefix);
    if (!prefix.startsWith("lesson-hls/") || prefix.split("/").length < 3) {
      throw new ApiError("INVALID_HLS_ASSET", "HLS 패키지 경로를 확인해 주세요.", HttpStatus.BAD_REQUEST);
    }
  }
}
