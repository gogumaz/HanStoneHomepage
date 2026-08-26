/// <reference types="node" />

import { readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('homepage hero asset', () => {
  it('uses the optimized WebP asset within the deployment size budget', () => {
    const webp = resolve(process.cwd(), 'assets/hero-journey.webp');
    const styles = readFileSync(resolve(process.cwd(), 'styles.css'), 'utf8');
    const homepage = readFileSync(resolve(process.cwd(), 'index.html'), 'utf8');

    expect(statSync(webp).size).toBeLessThan(250_000);
    expect(styles).toContain('assets/hero-journey.webp');
    expect(styles).not.toContain('assets/hero-journey.png');
    expect(homepage).toContain(
      '<link rel="preload" as="image" href="assets/hero-journey.webp" type="image/webp" fetchpriority="high">',
    );
  });
});
