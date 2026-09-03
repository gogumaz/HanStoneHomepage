import { describe, expect, it } from 'vitest';
import { filterLegacyCss } from './filter-legacy-css';

describe('filterLegacyCss', () => {
  it('keeps shared selectors and removes page selectors absent from the entry', () => {
    const css = `
      :root { --ink: #111; }
      body { color: var(--ink); }
      .home-card, .shared-button:hover { display: block; }
      .board-row.active { font-weight: 700; }
    `;

    const result = filterLegacyCss(css, '<button class="shared-button">계속</button>');

    expect(result).toContain(':root');
    expect(result).toContain('body');
    expect(result).toContain('.shared-button:hover');
    expect(result).not.toContain('.home-card');
    expect(result).not.toContain('.board-row');
  });

  it('filters selectors inside responsive rules while preserving keyframes', () => {
    const css = `
      @media (max-width: 700px) {
        .lecture-grid { grid-template-columns: 1fr; }
        .board-shell { padding: 1rem; }
      }
      @keyframes rise { from { opacity: 0; } to { opacity: 1; } }
    `;

    const result = filterLegacyCss(css, 'class="lecture-grid"');

    expect(result).toContain('.lecture-grid');
    expect(result).not.toContain('.board-shell');
    expect(result).toContain('@keyframes rise');
  });

  it('keeps a compound state selector when its stable class is referenced', () => {
    const result = filterLegacyCss('.modal.open { display: grid; }', '<div class="modal"></div>');

    expect(result).toContain('.modal.open');
  });
});
