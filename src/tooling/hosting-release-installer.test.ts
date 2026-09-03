import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, readlink, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { afterEach, describe, expect, it } from 'vitest';

const projectRoot = resolve(import.meta.dirname, '..', '..');
const installer = resolve(projectRoot, 'deploy', 'install-hosting-release.py');
const workspaces: string[] = [];

function run(command: string, args: string[], cwd = projectRoot) {
  return spawnSync(command, args, { cwd, encoding: 'utf8', windowsHide: true });
}

function pythonExecutable(): string | undefined {
  for (const candidate of ['python3', 'python']) {
    if (run(candidate, ['--version']).status === 0) return candidate;
  }
  return undefined;
}

function sha256(contents: string | Buffer) {
  return createHash('sha256').update(contents).digest('hex');
}

async function bundleFixture(commitSha = '1'.repeat(40)) {
  const root = await mkdtemp(join(tmpdir(), 'hanstone-hosting-install-test-'));
  workspaces.push(root);
  const bundle = resolve(root, 'hanstone-hosting');
  const contents = new Map([
    ['web/index.html', '<!doctype html><title>home</title>'],
    ['web/app.html', '<!doctype html><title>app</title>'],
    ['web/config.js', 'window.APP_CONFIG = {};'],
    ['web/payment/success.html', '<!doctype html><title>success</title>'],
    ['web/payment/fail.html', '<!doctype html><title>fail</title>'],
    ['web/web-deployment-manifest.json', '{"schemaVersion":1,"ok":true}\n'],
    ['deploy/README.md', '# Deployment\n'],
  ]);
  const files = [];
  let totalBytes = 0;
  for (const [name, value] of contents) {
    const path = resolve(bundle, ...name.split('/'));
    await mkdir(resolve(path, '..'), { recursive: true });
    await writeFile(path, value, 'utf8');
    const bytes = Buffer.byteLength(value);
    files.push({ path: name, bytes, sha256: sha256(value) });
    totalBytes += bytes;
  }
  await writeFile(
    resolve(bundle, 'DEPLOYMENT_BUNDLE_MANIFEST.json'),
    `${JSON.stringify({
      schemaVersion: 1,
      kind: 'hanstone-hosting-deployment-bundle',
      ok: true,
      commitSha,
      generatedAt: '2026-09-03T00:00:00.000Z',
      webDeploymentManifestSha256: sha256(contents.get('web/web-deployment-manifest.json')!),
      containsSecrets: false,
      files,
      totals: { files: files.length, bytes: totalBytes },
    }, null, 2)}\n`,
    'utf8',
  );
  return { root, bundle, commitSha };
}

afterEach(async () => {
  await Promise.all(workspaces.splice(0).map(path => rm(path, { recursive: true, force: true })));
});

describe('hosting release installer', () => {
  it('verifies every bundled file without changing the server', async () => {
    const python = pythonExecutable();
    expect(python, 'Python 3 is required to validate the hosting installer').toBeDefined();
    const { bundle, commitSha } = await bundleFixture();

    const result = run(python!, [installer, '--check', '--bundle-root', bundle, '--expected-commit', commitSha]);

    expect(result.stderr).toBe('');
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
      ok: true,
      mode: 'check',
      commitSha,
      fileCount: 7,
    });
  });

  it('rejects a modified or unexpected file', async () => {
    const python = pythonExecutable();
    expect(python).toBeDefined();
    const modified = await bundleFixture();
    await writeFile(resolve(modified.bundle, 'web', 'index.html'), 'changed', 'utf8');
    const mismatch = run(python!, [installer, '--check', '--bundle-root', modified.bundle]);
    expect(mismatch.status).toBe(1);
    expect(JSON.parse(mismatch.stderr)).toEqual({ ok: false, errorType: 'HOSTING_INSTALL_FILE_MISMATCH' });

    const unexpected = await bundleFixture('2'.repeat(40));
    await writeFile(resolve(unexpected.bundle, 'unexpected.txt'), 'unexpected', 'utf8');
    const extra = run(python!, [installer, '--check', '--bundle-root', unexpected.bundle]);
    expect(extra.status).toBe(1);
    expect(JSON.parse(extra.stderr)).toEqual({ ok: false, errorType: 'HOSTING_INSTALL_FILE_SET_MISMATCH' });
  });

  it('rejects a bundle for a different expected commit', async () => {
    const python = pythonExecutable();
    expect(python).toBeDefined();
    const { bundle } = await bundleFixture();
    const result = run(python!, [
      installer,
      '--check',
      '--bundle-root',
      bundle,
      '--expected-commit',
      'f'.repeat(40),
    ]);
    expect(result.status).toBe(1);
    expect(JSON.parse(result.stderr)).toEqual({ ok: false, errorType: 'HOSTING_INSTALL_COMMIT_MISMATCH' });
  });

  it('requires both explicit commit confirmations before rollback', () => {
    const python = pythonExecutable();
    expect(python).toBeDefined();
    const result = run(python!, [installer, '--rollback', '--expected-current', 'a'.repeat(40)]);
    expect(result.status).toBe(1);
    expect(JSON.parse(result.stderr)).toEqual({
      ok: false,
      errorType: 'HOSTING_INSTALL_ROLLBACK_CONFIRMATION_REQUIRED',
    });
  });

  it.skipIf(process.platform === 'win32')('installs and rolls back releases with verified pointers', async () => {
    const python = pythonExecutable();
    expect(python).toBeDefined();
    const first = await bundleFixture('a'.repeat(40));
    const second = await bundleFixture('b'.repeat(40));
    const target = resolve(first.root, 'target', 'hanstone');

    const initial = run(python!, [installer, '--apply', '--bundle-root', first.bundle, '--target-root', target]);
    expect(initial.status).toBe(0);
    const next = run(python!, [installer, '--apply', '--bundle-root', second.bundle, '--target-root', target]);
    expect(next.status).toBe(0);

    expect(await readlink(resolve(target, 'current'))).toBe(`releases/${second.commitSha}`);
    expect(await readlink(resolve(target, 'previous'))).toBe(`releases/${first.commitSha}`);
    expect(await readFile(resolve(target, 'releases', second.commitSha, 'index.html'), 'utf8'))
      .toContain('<title>home</title>');

    const rollback = run(python!, [
      installer,
      '--rollback',
      '--target-root',
      target,
      '--expected-current',
      second.commitSha,
      '--expected-previous',
      first.commitSha,
    ]);
    expect(rollback.status).toBe(0);
    expect(JSON.parse(rollback.stdout)).toMatchObject({
      ok: true,
      mode: 'rollback',
      commitSha: first.commitSha,
      rolledBackFromCommitSha: second.commitSha,
    });
    expect(await readlink(resolve(target, 'current'))).toBe(`releases/${first.commitSha}`);
    expect(await readlink(resolve(target, 'previous'))).toBe(`releases/${second.commitSha}`);
  });

  it.skipIf(process.platform === 'win32')('refuses rollback when the previous release was modified', async () => {
    const python = pythonExecutable();
    expect(python).toBeDefined();
    const first = await bundleFixture('c'.repeat(40));
    const second = await bundleFixture('d'.repeat(40));
    const target = resolve(first.root, 'target', 'hanstone');
    expect(run(python!, [installer, '--apply', '--bundle-root', first.bundle, '--target-root', target]).status).toBe(0);
    expect(run(python!, [installer, '--apply', '--bundle-root', second.bundle, '--target-root', target]).status).toBe(0);
    await writeFile(resolve(target, 'releases', first.commitSha, 'index.html'), 'tampered', 'utf8');

    const rollback = run(python!, [
      installer,
      '--rollback',
      '--target-root',
      target,
      '--expected-current',
      second.commitSha,
      '--expected-previous',
      first.commitSha,
    ]);
    expect(rollback.status).toBe(1);
    expect(JSON.parse(rollback.stderr)).toEqual({
      ok: false,
      errorType: 'HOSTING_INSTALL_WEB_COPY_MISMATCH',
    });
    expect(await readlink(resolve(target, 'current'))).toBe(`releases/${second.commitSha}`);
  });
});
