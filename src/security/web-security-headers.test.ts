/// <reference types="node" />

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { viteDevelopmentSecurityHeaders, webSecurityHeaders } from './web-security-headers';

describe('web security policy', () => {
  it('blocks inline script, plugin content, and framing while allowing payment SDKs', () => {
    const csp = webSecurityHeaders['Content-Security-Policy'];

    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("script-src-attr 'none'");
    expect(csp).toContain('https://js.tosspayments.com');
    expect(csp).not.toContain("script-src 'unsafe-inline'");
    expect(csp).not.toContain("'unsafe-eval'");
  });

  it('limits the React refresh inline-script exception to the Vite development server', () => {
    expect(viteDevelopmentSecurityHeaders['Content-Security-Policy'])
      .toContain("script-src 'self' https://js.tosspayments.com 'unsafe-inline'");
    expect(webSecurityHeaders['Content-Security-Policy'])
      .not.toContain("script-src 'self' https://js.tosspayments.com 'unsafe-inline'");
  });

  it('keeps API-provided board fields escaped before legacy HTML insertion', () => {
    const source = readFileSync(resolve(process.cwd(), 'board.js'), 'utf8');

    expect(source).toContain('data-record-id="${escapeHtml(record.id)}"');
    expect(source).toContain("${escapeHtml(record.category || '일반')}");
    expect(source).toContain('>${escapeHtml(formatDate(record.publishedAt || record.createdAt))}</time>');
  });
});
