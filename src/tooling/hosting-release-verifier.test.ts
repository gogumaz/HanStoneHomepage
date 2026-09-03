import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

const projectRoot = resolve(import.meta.dirname, '..', '..');
const verifier = resolve(projectRoot, 'deploy', 'verify-hosting-release.py');

function run(command: string, args: string[]) {
  return spawnSync(command, args, { cwd: projectRoot, encoding: 'utf8', windowsHide: true });
}

function pythonExecutable(): string | undefined {
  for (const candidate of ['python3', 'python']) {
    if (run(candidate, ['--version']).status === 0) return candidate;
  }
  return undefined;
}

describe('static hosting release verifier', () => {
  it('documents its required production inputs', () => {
    const python = pythonExecutable();
    expect(python).toBeDefined();
    const result = run(python!, [verifier, '--help']);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('--base-url');
    expect(result.stdout).toContain('--expected-commit');
    expect(result.stdout).toContain('--output');
  });

  it('rejects an insecure HTTP production origin before reading server state', () => {
    const python = pythonExecutable();
    expect(python).toBeDefined();
    const result = run(python!, [
      verifier,
      '--base-url',
      'http://uzdream.com',
      '--expected-commit',
      'a'.repeat(40),
    ]);
    expect(result.status).toBe(1);
    expect(JSON.parse(result.stderr)).toEqual({
      ok: false,
      rollbackRecommended: true,
      errorType: 'HOSTING_VERIFY_HTTPS_BASE_URL_REQUIRED',
    });
  });

  it('keeps certificate validation, response hashes, routes, and headers mandatory', () => {
    const source = readFileSync(verifier, 'utf8');
    for (const contract of [
      'ssl.create_default_context',
      'ssl.TLSVersion.TLSv1_2',
      'hashlib.sha256(contents).hexdigest()',
      'Strict-Transport-Security',
      'Content-Security-Policy',
      'Cache-Control',
      'Content-Type',
      '"/dashboard"',
      '"/web-deployment-manifest.json"',
      'rollbackRecommended',
    ]) {
      expect(source).toContain(contract);
    }
    expect(source).not.toContain('_create_unverified_context');
    expect(source).not.toContain('CERT_NONE');
  });
});
