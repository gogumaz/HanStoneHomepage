import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { webSecurityHeaders } from '../security/web-security-headers';

const projectRoot = resolve(import.meta.dirname, '..', '..');
const readDeploymentFile = (path: string) =>
  readFileSync(resolve(projectRoot, 'deploy', 'nginx', path), 'utf8');

describe('production Nginx configuration', () => {
  it('keeps the Nginx security headers aligned with the web application', () => {
    const snippet = readDeploymentFile('snippets/hanstone-security-headers.conf');

    for (const [name, value] of Object.entries(webSecurityHeaders)) {
      expect(snippet).toContain(`add_header ${name} "${value}" always;`);
    }

    const scriptDirective = webSecurityHeaders['Content-Security-Policy']
      .split('; ')
      .find(directive => directive.startsWith('script-src'));
    expect(scriptDirective).not.toContain("'unsafe-inline'");
  });

  it('uses immutable caching only for fingerprinted assets', () => {
    const cacheMap = readDeploymentFile('conf.d/hanstone-cache-map.conf');

    expect(cacheMap).toContain('default       "public, max-age=0, must-revalidate";');
    expect(cacheMap).toContain('~^/assets/    "public, max-age=31536000, immutable";');
    expect(cacheMap).toContain('~^/api/       "no-store";');
  });

  it('preserves API paths and never publishes port 3000 through Nginx', () => {
    const proxy = readDeploymentFile('snippets/hanstone-api-proxy.conf');
    const bootstrap = readDeploymentFile('sites-available/hanstone-bootstrap.conf');
    const production = readDeploymentFile('sites-available/hanstone.conf');

    expect(proxy).toContain('proxy_pass http://127.0.0.1:3000;');
    expect(proxy).not.toContain('proxy_pass http://127.0.0.1:3000/;');
    expect(proxy).toContain('proxy_set_header X-Forwarded-Proto $scheme;');
    expect(proxy).toContain('proxy_hide_header Cache-Control;');
    expect(bootstrap).toContain('location /api/');
    expect(production).toContain('location /api/');
    expect(`${bootstrap}\n${production}`).not.toMatch(/listen\s+3000/u);
  });

  it('supports the legacy home page, React deep links, TLS, and certificate renewal', () => {
    const bootstrap = readDeploymentFile('sites-available/hanstone-bootstrap.conf');
    const production = readDeploymentFile('sites-available/hanstone.conf');

    expect(bootstrap).toContain('root /var/www/hanstone/current;');
    expect(bootstrap).toContain('index index.html;');
    expect(bootstrap).toContain('try_files $uri $uri/ /app.html;');

    expect(production).toContain('return 301 https://$host$request_uri;');
    expect(production).toContain('listen 443 ssl http2;');
    expect(production).toContain('/etc/letsencrypt/live/uzdream.com/fullchain.pem');
    expect(production).toContain('/etc/letsencrypt/live/uzdream.com/privkey.pem');
    expect(production).toContain('location /.well-known/acme-challenge/');
    expect(production).toContain('Strict-Transport-Security "max-age=31536000" always;');
  });
});
