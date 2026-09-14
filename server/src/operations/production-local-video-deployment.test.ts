import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const composePath = resolve(process.cwd(), "../deploy/compose.production.yaml");
const overlayPath = resolve(process.cwd(), "../deploy/compose.production.local-download.yaml");
const transitionOverlayPath = resolve(process.cwd(), "../deploy/compose.transition.local-download.yaml");
const environmentPath = resolve(process.cwd(), "../deploy/production.env.example");

describe("production local video download deployment", () => {
  it("defaults production media delivery to a bounded local download mode", async () => {
    const [compose, environment] = await Promise.all([
      readFile(composePath, "utf8"),
      readFile(environmentPath, "utf8"),
    ]);
    expect(compose).toContain("MEDIA_DELIVERY_MODE: ${MEDIA_DELIVERY_MODE:-local-download}");
    expect(compose).toContain("LOCAL_VIDEO_MAX_BYTES: ${LOCAL_VIDEO_MAX_BYTES:-268435456}");
    expect(environment).toContain("MEDIA_DELIVERY_MODE=local-download");
    expect(environment).toContain("LOCAL_VIDEO_ROOT_HOST=/var/www/hanstone/media/lessons");
    expect(environment).toMatch(/^OBJECT_STORAGE_BUCKET=\r?$/mu);
    expect(environment).toContain("PREFLIGHT_REQUIRE_CDN=false");
  });

  it("mounts the host videos read-only and keeps managed media services profiled out", async () => {
    const overlay = await readFile(overlayPath, "utf8");
    expect(overlay).toContain("/var/lib/hanstone/media/lessons:ro");
    expect(overlay.match(/profiles: \["managed-media"\]/gu)).toHaveLength(4);
    expect(overlay).toContain('MALWARE_SCANNER_HOST: ""');
  });

  it("provides the same read-only mount for the current transitional host", async () => {
    const overlay = await readFile(transitionOverlayPath, "utf8");
    expect(overlay).toContain("MEDIA_DELIVERY_MODE: local-download");
    expect(overlay).toContain("/var/lib/hanstone/media/lessons:ro");
    expect(overlay).toContain("COMPACT_API_MEMORY_LIMIT:-384m");
  });
});
