import { describe, expect, it, vi } from "vitest";
import type { CurrentUser } from "../auth/auth.types.js";
import type { PrismaService } from "../database/prisma.service.js";
import { InquiryAttachmentStatus } from "../generated/prisma/enums.js";
import type { MalwareScannerService } from "../storage/malware-scanner.service.js";
import type { ObjectStorageService } from "../storage/object-storage.service.js";
import { InquiryAttachmentService } from "./inquiry-attachment.service.js";

const user = { id: "00000000-0000-4000-8000-000000000401", roles: ["student"] } as CurrentUser;
const attachment = {
  id: "00000000-0000-4000-8000-000000000701",
  ownerUserId: user.id,
  inquiryId: null,
  objectKey: "inquiry-attachments/00000000-0000-4000-8000-000000000701/source.pdf",
  originalName: "capture.pdf",
  contentType: "application/pdf",
  size: 12,
  status: InquiryAttachmentStatus.QUARANTINED,
  scanProvider: null,
  scanResult: null,
  scannedAt: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

function setup(bytes = Uint8Array.from(Buffer.from("not-a-pdf")), clean = true) {
  const current = { ...attachment };
  const update = vi.fn(async ({ data }: { data: Record<string, unknown> }) => Object.assign(current, data));
  const auditCreate = vi.fn(async () => ({ id: "audit-1" }));
  const prisma = {
    inquiryAttachment: {
      findFirst: vi.fn(async ({ where }: { where: Record<string, unknown> }) => where.ownerUserId === user.id ? current : null),
      update,
    },
    auditLog: { create: auditCreate },
    $transaction: vi.fn(async (operation: (transaction: unknown) => unknown) => operation(prisma)),
  };
  const storage = {
    getInquiryAttachmentMaxBytes: () => 10 * 1024 * 1024,
    inspectInquiryAttachment: vi.fn(async () => bytes),
    signAssetUrl: vi.fn(),
  };
  const scanner = { scan: vi.fn(async () => clean
    ? { clean: true as const, provider: "clamav" as const, result: "OK" as const }
    : { clean: false as const, provider: "clamav" as const, result: "Eicar-Test-Signature" }) };
  return {
    service: new InquiryAttachmentService(
      prisma as unknown as PrismaService,
      storage as unknown as ObjectStorageService,
      scanner as unknown as MalwareScannerService,
    ),
    current,
    update,
    auditCreate,
    scanner,
  };
}

describe("InquiryAttachmentService", () => {
  it("rejects a file whose bytes do not match its declared type before malware scanning", async () => {
    const test = setup();
    await expect(test.service.completeUpload(user, attachment.id, "req-1")).rejects.toMatchObject({
      code: "INQUIRY_ATTACHMENT_SIGNATURE_INVALID",
    });
    expect(test.current.status).toBe(InquiryAttachmentStatus.REJECTED);
    expect(test.scanner.scan).not.toHaveBeenCalled();
    expect(JSON.stringify(test.auditCreate.mock.calls)).not.toContain(attachment.originalName);
  });

  it("rejects malware even when the PDF signature is valid", async () => {
    const test = setup(Uint8Array.from(Buffer.from("%PDF-1.7 test")), false);
    await expect(test.service.completeUpload(user, attachment.id, "req-2")).rejects.toMatchObject({
      code: "MALWARE_DETECTED",
    });
    expect(test.current).toMatchObject({
      status: InquiryAttachmentStatus.REJECTED,
      scanProvider: "clamav",
      scanResult: "Eicar-Test-Signature",
    });
  });

  it("hides another user's attachment id", async () => {
    const test = setup();
    await expect(test.service.completeUpload({ ...user, id: "other-user" }, attachment.id)).rejects.toMatchObject({
      code: "INQUIRY_ATTACHMENT_NOT_FOUND",
    });
  });
});
