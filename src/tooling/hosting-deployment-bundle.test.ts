import { createHash } from 'node:crypto';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { afterEach, describe, expect, it } from 'vitest';

const projectRoot = resolve(import.meta.dirname, '..', '..');
const script = resolve(projectRoot, 'server', 'scripts', 'create-hosting-deployment-bundle.mjs');
const workspaces: string[] = [];

function run(command: string, args: string[], cwd: string) {
  return spawnSync(command, args, { cwd, encoding: 'utf8', windowsHide: true });
}

function sha256(contents: string | Buffer) {
  return createHash('sha256').update(contents).digest('hex');
}

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'hanstone-hosting-bundle-test-'));
  workspaces.push(root);
  await cp(resolve(projectRoot, 'deploy'), resolve(root, 'deploy'), { recursive: true });
  await mkdir(resolve(root, 'docs'), { recursive: true });
  await cp(
    resolve(projectRoot, 'docs', 'UZDREAM_PHPS_HOSTING_TEST_MANUAL.md'),
    resolve(root, 'docs', 'UZDREAM_PHPS_HOSTING_TEST_MANUAL.md'),
  );
  await writeFile(resolve(root, '.gitignore'), 'dist/\nartifacts/\n', 'utf8');
  await writeFile(resolve(root, 'candidate.txt'), 'candidate\n', 'utf8');

  expect(run('git', ['init'], root).status).toBe(0);
  expect(run('git', ['config', 'user.email', 'test@example.invalid'], root).status).toBe(0);
  expect(run('git', ['config', 'user.name', 'Bundle Test'], root).status).toBe(0);
  expect(run('git', ['add', '.'], root).status).toBe(0);
  expect(run('git', ['commit', '-m', 'fixture'], root).status).toBe(0);
  const commitSha = run('git', ['rev-parse', 'HEAD'], root).stdout.trim();

  const webFiles = new Map([
    ['index.html', '<!doctype html><title>home</title>'],
    ['app.html', '<!doctype html><title>app</title>'],
    ['config.js', 'window.APP_CONFIG = {};'],
    ['payment/success.html', '<!doctype html><title>success</title>'],
    ['payment/fail.html', '<!doctype html><title>fail</title>'],
    ['assets/app-AbCd1234.js', 'console.log("ok");'],
  ]);
  const files = [];
  let totalBytes = 0;
  for (const [name, contents] of webFiles) {
    const path = resolve(root, 'dist', ...name.split('/'));
    await mkdir(resolve(path, '..'), { recursive: true });
    await writeFile(path, contents, 'utf8');
    const bytes = Buffer.byteLength(contents);
    totalBytes += bytes;
    files.push({
      path: name,
      sha256: sha256(contents),
      bytes,
      contentType: name.endsWith('.html') ? 'text/html; charset=utf-8' : 'text/javascript; charset=utf-8',
      cacheControl: name.startsWith('assets/')
        ? 'public,max-age=31536000,immutable'
        : 'public,max-age=0,must-revalidate',
    });
  }
  await writeFile(
    resolve(root, 'dist', 'web-deployment-manifest.json'),
    `${JSON.stringify({
      schemaVersion: 1,
      ok: true,
      commitSha,
      generatedAt: new Date().toISOString(),
      files,
      totals: { files: files.length, bytes: totalBytes },
    }, null, 2)}\n`,
    'utf8',
  );
  return { root, commitSha };
}

afterEach(async () => {
  await Promise.all(workspaces.splice(0).map(root => rm(root, { recursive: true, force: true })));
});

describe('hosting deployment bundle', () => {
  it('creates a checksummed archive without runtime secrets', async () => {
    const { root, commitSha } = await fixture();
    const result = run(process.execPath, [script, '--project-root', root], root);

    expect(result.stderr).toBe('');
    expect(result.status).toBe(0);
    const report = JSON.parse(result.stdout);
    expect(report).toMatchObject({ ok: true, commitSha, fileCount: expect.any(Number) });

    const archive = resolve(root, report.output);
    const checksum = (await readFile(resolve(root, report.checksumOutput), 'utf8')).trim();
    expect(checksum).toBe(`${sha256(await readFile(archive))}  ${archive.split(/[\\/]/u).at(-1)}`);

    const listing = run('tar', ['-tzf', archive], root);
    expect(listing.status).toBe(0);
    expect(listing.stdout).toContain('hanstone-hosting/DEPLOYMENT_BUNDLE_MANIFEST.json');
    expect(listing.stdout).toContain('hanstone-hosting/docs/UZDREAM_PHPS_HOSTING_TEST_MANUAL.md');
    expect(listing.stdout).toContain('hanstone-hosting/web/web-deployment-manifest.json');
    expect(listing.stdout).toContain('hanstone-hosting/deploy/production.env.example');
    expect(listing.stdout).toContain('hanstone-hosting/deploy/HOSTING_INSTALL.md');
    expect(listing.stdout).toContain('hanstone-hosting/deploy/HOSTING_BOOTSTRAP.md');
    expect(listing.stdout).toContain('hanstone-hosting/deploy/HOSTING_VERIFY.md');
    expect(listing.stdout).toContain('hanstone-hosting/deploy/bootstrap-static-host.sh');
    expect(listing.stdout).toContain('hanstone-hosting/deploy/install-hosting-release.py');
    expect(listing.stdout).toContain('hanstone-hosting/deploy/verify-hosting-release.py');
    expect(listing.stdout).toContain('hanstone-hosting/deploy/nginx/sites-available/hanstone.conf');
    expect(listing.stdout).not.toMatch(/(?:^|\/)production\.env$/mu);
    expect(listing.stdout).not.toContain('/.git/');
  }, 15_000);

  it('rejects a dirty Git candidate', async () => {
    const { root } = await fixture();
    await writeFile(resolve(root, 'candidate.txt'), 'changed after commit\n', 'utf8');

    const result = run(process.execPath, [script, '--project-root', root], root);
    expect(result.status).toBe(1);
    expect(JSON.parse(result.stderr)).toEqual({ ok: false, errorType: 'HOSTING_BUNDLE_GIT_DIRTY' });
  });

  it('reuses an intact default bundle when only the web manifest generation time changed', async () => {
    const { root, commitSha } = await fixture();
    const created = run(process.execPath, [script, '--project-root', root], root);
    expect(created.status).toBe(0);
    const webManifestPath = resolve(root, 'dist', 'web-deployment-manifest.json');
    const regeneratedManifest = JSON.parse(await readFile(webManifestPath, 'utf8'));
    regeneratedManifest.generatedAt = new Date(Date.parse(regeneratedManifest.generatedAt) + 1_000).toISOString();
    await writeFile(webManifestPath, `${JSON.stringify(regeneratedManifest, null, 2)}\n`, 'utf8');

    const result = run(process.execPath, [script, '--project-root', root], root);
    expect(result.stderr).toBe('');
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({ ok: true, reused: true, commitSha });
  });

  it('rejects a damaged existing default bundle', async () => {
    const { root } = await fixture();
    const created = run(process.execPath, [script, '--project-root', root], root);
    expect(created.status).toBe(0);
    const report = JSON.parse(created.stdout);
    await writeFile(resolve(root, report.output), 'damaged archive', 'utf8');

    const result = run(process.execPath, [script, '--project-root', root], root);
    expect(result.status).toBe(1);
    expect(JSON.parse(result.stderr)).toEqual({ ok: false, errorType: 'HOSTING_BUNDLE_EXISTING_INVALID' });
  });

  it('rejects web files that no longer match the deployment manifest', async () => {
    const { root } = await fixture();
    await writeFile(resolve(root, 'dist', 'index.html'), '<!doctype html><title>tampered</title>', 'utf8');

    const result = run(process.execPath, [script, '--project-root', root], root);
    expect(result.status).toBe(1);
    expect(JSON.parse(result.stderr)).toEqual({ ok: false, errorType: 'HOSTING_BUNDLE_WEB_FILE_MISMATCH' });
  });
});
