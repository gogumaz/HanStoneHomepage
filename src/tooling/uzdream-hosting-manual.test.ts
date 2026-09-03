import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const projectRoot = resolve(import.meta.dirname, '..', '..');
const focusedManual = readFileSync(
  resolve(projectRoot, 'docs', 'UZDREAM_PHPS_HOSTING_TEST_MANUAL.md'),
  'utf8',
);
const generalManual = readFileSync(
  resolve(projectRoot, 'docs', 'HOMEPAGE_TEST_AND_SERVER_INSTALLATION.md'),
  'utf8',
);

describe('uzdream PHPS hosting manual', () => {
  it('clearly separates local Vite testing from domain hosting', () => {
    expect(generalManual).toContain('홈페이지 빠른 실행—로컬 PC 전용');
    expect(generalManual).toContain('같은 PC의 브라우저');
    expect(generalManual).toContain('www.uzdream.com:4173');
    expect(generalManual).toContain('UZDREAM_PHPS_HOSTING_TEST_MANUAL.md');
    expect(focusedManual).toContain('http://127.0.0.1:4173/index.html');
    expect(focusedManual).toContain('http://uzdream.com/');
    expect(focusedManual).not.toContain('--host 0.0.0.0');
  });

  it('records the observed server state and correct public addresses', () => {
    expect(focusedManual).toContain('115.71.237.88');
    expect(focusedManual).toContain('HTTP 80 / HTTPS 443 | 외부 연결 불가');
    expect(focusedManual).toContain('https://uzdream.com/');
    expect(focusedManual).toContain('https://www.uzdream.com/');
    expect(focusedManual).toContain('포트 번호 없이');
  });

  it('keeps the safe server procedure in dependency order', () => {
    const bootstrap = focusedManual.indexOf('bootstrap-static-host.sh');
    const install = focusedManual.indexOf('install-hosting-release.py --check');
    const certificate = focusedManual.indexOf('certbot certonly --nginx');
    const verify = focusedManual.indexOf('verify-hosting-release.py');
    expect(bootstrap).toBeGreaterThan(0);
    expect(install).toBeGreaterThan(bootstrap);
    expect(certificate).toBeGreaterThan(install);
    expect(verify).toBeGreaterThan(certificate);
    expect(focusedManual).toContain('--allow-ubuntu-20-test');
    expect(focusedManual).toContain('INSTALL_STATIC_HOSTING_TEST');
    expect(focusedManual).toContain('STATIC_BOOTSTRAP_UBUNTU_20_ESM_REQUIRED');
    expect(focusedManual).toContain('esm-infra');
    expect(focusedManual).toContain('esm-apps');
    expect(focusedManual).toContain('rollbackRecommended:false');
  });

  it('does not claim API-backed features work on the 512MB static host', () => {
    expect(focusedManual).toContain('로그인, 회원가입, 관리자 저장, 결제 승인');
    expect(focusedManual).toContain('API, PostgreSQL, Redis');
  });
});
