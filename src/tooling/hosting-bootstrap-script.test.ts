import { existsSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const projectRoot = resolve(import.meta.dirname, '..', '..');
const scriptPath = resolve(projectRoot, 'deploy', 'bootstrap-static-host.sh');

function bashExecutable(): string | undefined {
  if (process.platform !== 'win32') return 'bash';
  const candidates = [
    'C:\\Program Files\\Git\\bin\\bash.exe',
    'C:\\Program Files\\Git\\usr\\bin\\bash.exe',
  ];
  return candidates.find(candidate => existsSync(candidate));
}

describe('static hosting bootstrap', () => {
  it('has valid Bash syntax and explains dry-run and apply usage', () => {
    const bash = bashExecutable();
    expect(bash).toBeDefined();
    const syntax = spawnSync(bash!, ['-n', scriptPath], { encoding: 'utf8' });
    expect(syntax.stderr).toBe('');
    expect(syntax.status).toBe(0);

    const help = spawnSync(bash!, [scriptPath, '--help'], { encoding: 'utf8' });
    expect(help.status).toBe(0);
    expect(help.stdout).toContain('--ssh-port PORT');
    expect(help.stdout).toContain('--confirm INSTALL_STATIC_HOSTING');
    expect(help.stdout).toContain('--allow-ubuntu-20-test');
    expect(help.stdout).toContain('--confirm INSTALL_STATIC_HOSTING_TEST');
    expect(help.stdout).toContain('default mode is read-only');
  });

  it('limits Ubuntu 20.04 to an ESM-backed static test with separate approval', () => {
    const source = readFileSync(scriptPath, 'utf8');
    expect(source).toContain("22.04|24.04|26.04");
    expect(source).toContain('STATIC_BOOTSTRAP_UBUNTU_20_TEST_APPROVAL_REQUIRED');
    expect(source).toContain('STATIC_BOOTSTRAP_UBUNTU_20_ESM_REQUIRED');
    expect(source).toContain('esm_service_enabled esm-infra');
    expect(source).toContain('esm_service_enabled esm-apps');
    expect(source).not.toContain('pro attach');

    const confirmation = source.indexOf("[[ \"$CONFIRMATION\" == 'INSTALL_STATIC_HOSTING' ]]");
    const testConfirmation = source.indexOf("[[ \"$CONFIRMATION\" == 'INSTALL_STATIC_HOSTING_TEST' ]]");
    const packageInstall = source.indexOf('apt-get install');
    expect(confirmation).toBeGreaterThan(0);
    expect(testConfirmation).toBeGreaterThan(0);
    expect(packageInstall).toBeGreaterThan(confirmation);
    expect(packageInstall).toBeGreaterThan(testConfirmation);
    expect(source).not.toContain('apt-get upgrade');
    expect(source).not.toContain('do-release-upgrade');
    expect(source).not.toContain('certbot --nginx');
  });

  it('preserves the active SSH path before enabling the firewall', () => {
    const source = readFileSync(scriptPath, 'utf8');
    const activePortCheck = source.indexOf('STATIC_BOOTSTRAP_ACTIVE_SSH_PORT_MISMATCH');
    const allowSsh = source.indexOf('ufw allow "${SSH_PORT}/tcp"');
    const enableFirewall = source.indexOf('ufw --force enable');
    expect(activePortCheck).toBeGreaterThan(0);
    expect(allowSsh).toBeGreaterThan(activePortCheck);
    expect(enableFirewall).toBeGreaterThan(allowSsh);
  });

  it('never overwrites a conflicting Nginx configuration', () => {
    const source = readFileSync(scriptPath, 'utf8');
    expect(source).toContain("cmp -s -- \"$source\" \"$destination\" || fail 'STATIC_BOOTSTRAP_CONFIG_CONFLICT'");
    expect(source).toContain("[[ -L \"$destination\" ]]");
    expect(source).not.toContain('cp -f');
    expect(source).not.toContain('ln -sfn');
  });
});
