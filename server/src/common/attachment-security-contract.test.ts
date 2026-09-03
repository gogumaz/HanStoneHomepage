import { describe, expect, it, vi } from 'vitest';
import type { CurrentUser } from '../auth/auth.types.js';
import { ClassHelperAssetService } from '../class-helper/class-helper-asset.service.js';
import { CommunityAttachmentService } from '../community/community-attachment.service.js';
import { LessonAssetService } from '../content/lesson-asset.service.js';
import {
  ClassHelperAssetKind,
  ClassHelperAssetStatus,
  CommunityAttachmentKind,
  CommunityAttachmentStatus,
  TeachingMaterialAssetStatus,
} from '../generated/prisma/enums.js';
import { InquiryAttachmentService } from '../inquiry/inquiry-attachment.service.js';
import { MaterialAssetService } from '../material/material-asset.service.js';

const operator: CurrentUser = {
  id: '00000000-0000-4000-8000-000000000801',
  email: 'operator@example.test',
  emailVerified: true,
  displayName: '업로드 운영자',
  roles: ['operator'],
};
const maxBytes = 1024;

type UploadContract = {
  name: string;
  expectedCode: string;
  base: Record<string, unknown>;
  start: (body: Record<string, unknown>) => Promise<unknown>;
};

function uploadContracts(): UploadContract[] {
  const prisma = {
    lesson: { findUnique: vi.fn(async () => ({ id: 'PRE-01' })) },
    $transaction: vi.fn(async () => { throw new Error('invalid input reached persistence'); }),
  };
  const storage = {
    getLessonAssetMaxBytes: () => maxBytes,
    getInquiryAttachmentMaxBytes: () => maxBytes,
    getCommunityAttachmentMaxBytes: () => maxBytes,
  };
  const scanner = { scan: vi.fn() };

  return [
    {
      name: '강의자료',
      expectedCode: 'INVALID_LESSON_ASSET',
      base: { kind: 'material', fileName: 'safe.pdf', contentType: 'application/pdf', size: 100 },
      start: (body) => new LessonAssetService(prisma as never, storage as never, scanner as never, {} as never)
        .startUpload(operator, 'PRE-01', body),
    },
    {
      name: '1:1 문의',
      expectedCode: 'INQUIRY_ATTACHMENT_INVALID',
      base: { fileName: 'safe.pdf', contentType: 'application/pdf', size: 100 },
      start: (body) => new InquiryAttachmentService(prisma as never, storage as never, scanner as never)
        .startUpload(operator, body),
    },
    {
      name: '커뮤니티',
      expectedCode: 'COMMUNITY_ATTACHMENT_INVALID',
      base: { kind: 'material', fileName: 'safe.pdf', contentType: 'application/pdf', size: 100 },
      start: (body) => new CommunityAttachmentService(prisma as never, storage as never, scanner as never)
        .startUpload(operator, body),
    },
    {
      name: '수업도우미',
      expectedCode: 'CLASS_HELPER_ASSET_INVALID',
      base: { kind: 'activityPdf', fileName: 'safe.pdf', contentType: 'application/pdf', size: 100 },
      start: (body) => new ClassHelperAssetService(prisma as never, storage as never, scanner as never)
        .startUpload(operator, body),
    },
    {
      name: '교재자료',
      expectedCode: 'TEACHING_MATERIAL_ASSET_INVALID',
      base: { fileName: 'safe.pdf', contentType: 'application/pdf', size: 100 },
      start: (body) => new MaterialAssetService(prisma as never, storage as never, scanner as never)
        .startUpload(operator, body),
    },
  ];
}

function infectedHarness(modelName: string, current: Record<string, unknown>) {
  const update = vi.fn(async ({ data }: { data: Record<string, unknown> }) => Object.assign(current, data));
  const prisma: Record<string, any> = {
    [modelName]: { findFirst: vi.fn(async () => current), update },
    auditLog: { create: vi.fn(async () => ({ id: 'audit-1' })) },
  };
  prisma.$transaction = vi.fn(async (operation: (transaction: typeof prisma) => unknown) => operation(prisma));
  return { prisma, update };
}

const pdfBytes = Uint8Array.from(Buffer.from('%PDF-1.7 infected test'));
const infectedScanner = () => ({
  scan: vi.fn(async () => ({ clean: false as const, provider: 'clamav', result: 'Eicar-Test-Signature' })),
});

describe('attachment upload security contract', () => {
  for (const contract of uploadContracts()) {
    it(`${contract.name}: rejects unsupported extensions, MIME mismatches, and invalid sizes before persistence`, async () => {
      const cases = [
        { ...contract.base, fileName: 'payload.exe' },
        { ...contract.base, contentType: 'text/html' },
        { ...contract.base, size: 0 },
        { ...contract.base, size: maxBytes + 1 },
      ];

      for (const body of cases) {
        await expect(contract.start(body)).rejects.toMatchObject({ code: contract.expectedCode });
      }
    });
  }

  it('rejects an infected community attachment after a valid file signature', async () => {
    const current = {
      id: 'community-asset', ownerUserId: operator.id, postId: null,
      kind: CommunityAttachmentKind.MATERIAL, objectKey: 'community-attachments/community-asset/source.pdf',
      originalName: 'safe.pdf', contentType: 'application/pdf', size: pdfBytes.length,
      status: CommunityAttachmentStatus.QUARANTINED,
    };
    const test = infectedHarness('communityAttachment', current);
    const storage = { inspectCommunityAttachment: vi.fn(async () => pdfBytes) };
    const service = new CommunityAttachmentService(test.prisma as never, storage as never, infectedScanner() as never);

    await expect(service.completeUpload(operator, current.id)).rejects.toMatchObject({ code: 'MALWARE_DETECTED' });
    expect(test.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: CommunityAttachmentStatus.REJECTED, scanProvider: 'clamav' }),
    }));
  });

  it('rejects an infected class-helper attachment after a valid file signature', async () => {
    const current = {
      id: 'class-helper-asset', ownerUserId: operator.id, classHelperId: null,
      kind: ClassHelperAssetKind.ACTIVITY_PDF, objectKey: 'class-helper-assets/class-helper-asset/source.pdf',
      originalName: 'safe.pdf', contentType: 'application/pdf', size: pdfBytes.length,
      status: ClassHelperAssetStatus.QUARANTINED,
    };
    const test = infectedHarness('classHelperAsset', current);
    const storage = { inspectClassHelperAsset: vi.fn(async () => pdfBytes) };
    const service = new ClassHelperAssetService(test.prisma as never, storage as never, infectedScanner() as never);

    await expect(service.completeUpload(operator, current.id)).rejects.toMatchObject({ code: 'MALWARE_DETECTED' });
    expect(test.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: ClassHelperAssetStatus.REJECTED, scanProvider: 'clamav' }),
    }));
  });

  it('rejects an infected teaching-material attachment after a valid file signature', async () => {
    const current = {
      id: 'teaching-material-asset', ownerUserId: operator.id, materialId: null,
      objectKey: 'teaching-material-assets/teaching-material-asset/source.pdf',
      originalName: 'safe.pdf', contentType: 'application/pdf', size: pdfBytes.length,
      status: TeachingMaterialAssetStatus.QUARANTINED,
    };
    const test = infectedHarness('teachingMaterialAsset', current);
    const storage = { inspectTeachingMaterialAsset: vi.fn(async () => pdfBytes) };
    const service = new MaterialAssetService(test.prisma as never, storage as never, infectedScanner() as never);

    await expect(service.completeUpload(operator, current.id)).rejects.toMatchObject({ code: 'MALWARE_DETECTED' });
    expect(test.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: TeachingMaterialAssetStatus.REJECTED, scanProvider: 'clamav' }),
    }));
  });
});
