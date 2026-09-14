import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const templatePath = resolve(process.cwd(), "../deploy/aws-object-storage.yaml");
const provisionerPath = resolve(process.cwd(), "../deploy/provision-aws-object-storage.sh");

describe("AWS object storage infrastructure", () => {
  it("retains a private, encrypted, versioned bucket with bounded lifecycle and CORS", async () => {
    const template = await readFile(templatePath, "utf8");

    expect(template).toContain("DeletionPolicy: Retain");
    expect(template).toContain("UpdateReplacePolicy: Retain");
    expect(template).toContain("SSEAlgorithm: AES256");
    expect(template).toContain("ObjectOwnership: BucketOwnerEnforced");
    for (const setting of ["BlockPublicAcls", "BlockPublicPolicy", "IgnorePublicAcls", "RestrictPublicBuckets"]) {
      expect(template).toContain(`${setting}: true`);
    }
    expect(template).toMatch(/VersioningConfiguration:\s+Status: Enabled/u);
    expect(template).toContain("NoncurrentDays: !Ref NoncurrentVersionRetentionDays");
    expect(template).toContain("NewerNoncurrentVersions: 3");
    expect(template).toContain("DaysAfterInitiation: 7");
    for (const method of ["GET", "HEAD", "POST"]) expect(template).toContain(`- ${method}`);
    expect(template).toContain("https://handol-edu.com,https://www.handol-edu.com");
  });

  it("denies insecure transport and grants only the application S3 operations", async () => {
    const template = await readFile(templatePath, "utf8");

    expect(template).toContain("aws:SecureTransport: \"false\"");
    for (const action of [
      "s3:GetBucketVersioning",
      "s3:ListBucket",
      "s3:GetObject",
      "s3:PutObject",
      "s3:DeleteObject",
    ]) expect(template).toContain(`- ${action}`);
    expect(template).not.toContain("AWS::IAM::AccessKey");
    expect(template).not.toMatch(/Effect: Allow[\s\S]{0,200}Action: ["']?s3:\*/u);
  });

  it("requires explicit confirmation and never creates or prints a credential", async () => {
    const provisioner = await readFile(provisionerPath, "utf8");

    expect(provisioner).toContain("--confirm CREATE_HANSTONE_STORAGE");
    expect(provisioner).toContain("--capabilities CAPABILITY_NAMED_IAM");
    expect(provisioner).not.toContain("create-access-key");
    expect(provisioner).not.toContain("SecretAccessKey");
  });
});
