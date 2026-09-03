import { existsSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const projectRoot = resolve(import.meta.dirname, '..', '..');
const scriptPath = resolve(projectRoot, 'deploy', 'check-host-readiness.sh');

function bashExecutable(): string | undefined {
  if (process.platform !== 'win32') return 'bash';
  const candidates = [
    'C:\\Program Files\\Git\\bin\\bash.exe',
    'C:\\Program Files\\Git\\usr\\bin\\bash.exe',
  ];
  return candidates.find(candidate => existsSync(candidate));
}

describe('hosting readiness audit', () => {
  it('has valid Bash syntax and a working help command', () => {
    const bash = bashExecutable();
    expect(bash, 'Bash is required to validate the deployment audit').toBeDefined();

    const syntax = spawnSync(bash!, ['-n', scriptPath], { encoding: 'utf8' });
    expect(syntax.stderr).toBe('');
    expect(syntax.status).toBe(0);

    const help = spawnSync(bash!, [scriptPath, '--help'], { encoding: 'utf8' });
    expect(help.status).toBe(0);
    expect(help.stdout).toContain('--mode base|static|full');
    expect(help.stdout).toContain('--allow-ubuntu-20-test');
    expect(help.stdout).toContain('The script is read-only');
  });

  it('checks the deployment blockers without changing server state', () => {
    const script = readFileSync(scriptPath, 'utf8');

    for (const requiredCheck of [
      '/etc/os-release',
      '/proc/meminfo',
      'df -Pk /',
      'getent ahostsv4',
      'python3',
      'ufw status',
      'nginx -t',
      'docker info',
      '/etc/hanstone/production.env',
      'for endpoint in live ready',
      '${API_BASE_URL}/api/v1/health/${endpoint}',
      'Ubuntu Pro ${esm_service} is enabled',
      'full service is not allowed',
    ]) {
      expect(script).toContain(requiredCheck);
    }

    for (const mutatingCommand of [
      'apt install',
      'apt upgrade',
      'ufw allow',
      'ufw enable',
      'systemctl enable',
      'systemctl start',
      'docker compose up',
      'docker compose pull',
      'chmod ',
      'chown ',
      'rm -',
    ]) {
      expect(script).not.toContain(mutatingCommand);
    }
  });
});
