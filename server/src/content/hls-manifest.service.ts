import { posix } from "node:path";
import { HttpStatus, Injectable } from "@nestjs/common";
import { ApiError } from "../common/api-error.js";
import { ObjectStorageService } from "../storage/object-storage.service.js";
import { MediaDeliveryService } from "../storage/media-delivery.service.js";

const SAFE_HLS_KEY = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,1023}$/;
const URI_ATTRIBUTE = /URI="([^"]+)"/g;

type RewriteContext = {
  lessonId: string;
  masterKey: string;
  currentKey: string;
};

function invalidManifest(): ApiError {
  return new ApiError(
    "HLS_MANIFEST_INVALID",
    "HLS 재생목록의 형식 또는 내부 경로가 올바르지 않습니다.",
    HttpStatus.UNPROCESSABLE_ENTITY,
  );
}

function rootPrefix(masterKey: string): string {
  return `${posix.dirname(masterKey)}/`;
}

function resolveReference(context: RewriteContext, reference: string): string {
  const value = reference.trim();
  if (
    !value
    || value.includes("\\")
    || value.includes("\0")
    || value.includes("?")
    || value.includes("#")
    || /^[a-z][a-z0-9+.-]*:/i.test(value)
    || value.startsWith("//")
    || value.startsWith("/")
  ) throw invalidManifest();
  const resolved = posix.normalize(posix.join(posix.dirname(context.currentKey), value));
  const prefix = rootPrefix(context.masterKey);
  if (!SAFE_HLS_KEY.test(resolved) || !resolved.startsWith(prefix) || resolved.endsWith("/")) {
    throw invalidManifest();
  }
  return resolved;
}

async function replaceUriAttributes(
  line: string,
  rewrite: (uri: string) => Promise<string>,
): Promise<string> {
  const matches = Array.from(line.matchAll(URI_ATTRIBUTE));
  if (matches.length === 0) return line;
  let output = "";
  let cursor = 0;
  for (const match of matches) {
    const index = match.index;
    const uri = match[1];
    if (index === undefined || uri === undefined) throw invalidManifest();
    output += line.slice(cursor, index);
    output += `URI="${await rewrite(uri)}"`;
    cursor = index + match[0].length;
  }
  return output + line.slice(cursor);
}

@Injectable()
export class HlsManifestService {
  constructor(
    private readonly storage: ObjectStorageService,
    private readonly delivery: MediaDeliveryService,
  ) {}

  isHlsKey(objectKey: string): boolean {
    return objectKey.startsWith("lesson-hls/") && objectKey.toLowerCase().endsWith(".m3u8");
  }

  assertMasterKey(lessonId: string, objectKey: string): void {
    if (
      !SAFE_HLS_KEY.test(objectKey)
      || !objectKey.startsWith(`lesson-hls/${lessonId}/`)
      || !objectKey.toLowerCase().endsWith(".m3u8")
    ) throw invalidManifest();
  }

  async validateMaster(lessonId: string, masterKey: string): Promise<void> {
    this.assertMasterKey(lessonId, masterKey);
    const manifest = await this.storage.readHlsManifest(masterKey);
    await this.rewrite(lessonId, masterKey, masterKey, manifest);
  }

  async render(lessonId: string, masterKey: string, relativePath?: string): Promise<string> {
    this.assertMasterKey(lessonId, masterKey);
    const prefix = rootPrefix(masterKey);
    const currentKey = relativePath
      ? posix.normalize(posix.join(prefix, relativePath))
      : masterKey;
    if (
      !SAFE_HLS_KEY.test(currentKey)
      || !currentKey.startsWith(prefix)
      || !currentKey.toLowerCase().endsWith(".m3u8")
    ) throw invalidManifest();
    const manifest = await this.storage.readHlsManifest(currentKey);
    return this.rewrite(lessonId, masterKey, currentKey, manifest);
  }

  private async rewrite(
    lessonId: string,
    masterKey: string,
    currentKey: string,
    manifest: string,
  ): Promise<string> {
    const normalized = manifest.replace(/^\uFEFF/, "");
    if (!normalized.startsWith("#EXTM3U") || normalized.length > 1024 * 1024) throw invalidManifest();
    const context = { lessonId, masterKey, currentKey };
    const prefix = rootPrefix(masterKey);
    const signedUrls = new Map<string, Promise<string>>();
    const rewriteReference = async (uri: string) => {
      const objectKey = resolveReference(context, uri);
      if (objectKey.toLowerCase().endsWith(".m3u8")) {
        const relative = objectKey.slice(prefix.length);
        return `/api/v1/lessons/${encodeURIComponent(lessonId)}/hls-manifest?path=${encodeURIComponent(relative)}`;
      }
      let pending = signedUrls.get(objectKey);
      if (!pending) {
        pending = this.delivery.signHlsAssetUrl(objectKey).then((signed) => signed.url);
        signedUrls.set(objectKey, pending);
      }
      return pending;
    };

    const lines = normalized.split(/\r?\n/);
    const rewritten: string[] = [];
    for (const line of lines) {
      if (line.startsWith("#")) {
        rewritten.push(await replaceUriAttributes(line, rewriteReference));
      } else if (line.trim()) {
        rewritten.push(await rewriteReference(line));
      } else {
        rewritten.push(line);
      }
    }
    return rewritten.join("\n");
  }
}
