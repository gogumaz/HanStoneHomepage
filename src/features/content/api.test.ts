import { describe, expect, it } from 'vitest';
import { getLessonAssetContentType } from './api';

describe('getLessonAssetContentType', () => {
  it('normalizes browser-specific or missing HWP MIME values', () => {
    expect(getLessonAssetContentType({ name: 'activity.HWP', type: '' })).toBe('application/x-hwp');
    expect(getLessonAssetContentType({ name: 'worksheet.hwpx', type: 'application/octet-stream' })).toBe('application/hwp+zip');
  });

  it('uses canonical Word MIME values based on the file extension', () => {
    expect(getLessonAssetContentType({ name: 'lesson.doc', type: 'application/octet-stream' })).toBe('application/msword');
    expect(getLessonAssetContentType({ name: 'lesson.docx', type: '' })).toBe('application/vnd.openxmlformats-officedocument.wordprocessingml.document');
  });
});
