import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("local video installer", () => {
  it("validates input before an explicit, atomic installation", async () => {
    const script = await readFile(resolve(process.cwd(), "../deploy/install-local-video.sh"), "utf8");
    expect(script).toContain("INSTALL_LOCAL_LESSON_VIDEO");
    expect(script).toContain("SOURCE_MP4_FTYP_NOT_FOUND");
    expect(script).toContain("! -L");
    expect(script).toContain("mktemp");
    expect(script).toContain("install -o root -g root -m 0644");
    expect(script).toContain("mv -f --");
    expect(script).not.toContain("rm -rf");
  });
});
