import { writeFile } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';

type LabVitals = {
  lcp: number;
  inp: number;
  cls: number;
  eventTimingSupported: boolean;
};

function installVitalsObservers() {
    const state: LabVitals = {
      lcp: 0,
      inp: 0,
      cls: 0,
      eventTimingSupported: 'PerformanceEventTiming' in window,
    };
    Object.defineProperty(window, '__bhjLabVitals', { value: state });
    let clsSessionValue = 0;
    let clsSessionStartedAt = 0;
    let previousShiftAt = 0;

    const observe = (type: string, callback: (entry: PerformanceEntry) => void, options = {}) => {
      if (!PerformanceObserver.supportedEntryTypes.includes(type)) return;
      const observer = new PerformanceObserver(list => list.getEntries().forEach(callback));
      observer.observe({ type, buffered: true, ...options } as PerformanceObserverInit);
    };

    observe('largest-contentful-paint', entry => {
      state.lcp = Math.max(state.lcp, entry.startTime);
    });
    observe('layout-shift', entry => {
      const shift = entry as PerformanceEntry & { hadRecentInput: boolean; value: number };
      if (shift.hadRecentInput) return;

      const startsNewSession = entry.startTime - previousShiftAt > 1_000
        || entry.startTime - clsSessionStartedAt > 5_000;
      if (startsNewSession) {
        clsSessionStartedAt = entry.startTime;
        clsSessionValue = shift.value;
      } else {
        clsSessionValue += shift.value;
      }
      previousShiftAt = entry.startTime;
      state.cls = Math.max(state.cls, clsSessionValue);
    });
    observe('first-input', entry => {
      state.inp = Math.max(state.inp, entry.duration);
    });
    observe('event', entry => {
      const interaction = entry as PerformanceEventTiming;
      if (interaction.interactionId > 0) state.inp = Math.max(state.inp, interaction.duration);
    }, { durationThreshold: 16 });
}

async function measureHomepageVitals(page: Page) {
  await page.goto('/');
  const hero = page.locator('.hero-image');
  await expect(hero).toBeVisible();
  await expect.poll(() => hero.evaluate(image => (image as HTMLImageElement).complete)).toBe(true);
  await page.evaluate(() => document.fonts.ready);

  await page.getByRole('tab', { name: /고조선/ }).click();
  await expect(page.locator('#eraTitle')).toContainText('내 영역을 만들고');
  await page.getByRole('button', { name: '무료 체험' }).click();
  await expect(page.getByRole('dialog', { name: '누가 여행을 시작하나요?' })).toBeVisible();
  await page.getByRole('button', { name: /학생/ }).click();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: '누가 여행을 시작하나요?' })).toBeHidden();

  return page.evaluate(async () => {
    await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    const state = (window as typeof window & { __bhjLabVitals: LabVitals }).__bhjLabVitals;
    return {
      lcp: Math.round(state.lcp),
      inp: Math.round(state.inp),
      cls: Number(state.cls.toFixed(4)),
      eventTimingSupported: state.eventTimingSupported,
    };
  });
}

function median(values: number[]) {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.floor(sorted.length / 2)];
}

test('프로덕션 홈페이지가 Core Web Vitals 랩 예산을 충족한다', async ({ browser }, testInfo) => {
  const samples: LabVitals[] = [];
  for (let run = 0; run < 3; run += 1) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    await context.addInitScript(installVitalsObservers);
    const page = await context.newPage();
    try {
      samples.push(await measureHomepageVitals(page));
    } finally {
      await context.close();
    }
  }

  const metrics = {
    lcp: median(samples.map(sample => sample.lcp)),
    inp: median(samples.map(sample => sample.inp)),
    cls: median(samples.map(sample => sample.cls)),
    eventTimingSupported: samples.every(sample => sample.eventTimingSupported),
  };

  const evidencePath = testInfo.outputPath('core-web-vitals-lab.json');
  await writeFile(evidencePath, `${JSON.stringify({ metrics, samples }, null, 2)}\n`, 'utf8');
  await testInfo.attach('core-web-vitals-lab.json', {
    path: evidencePath,
    contentType: 'application/json',
  });
  console.log(`[core-web-vitals] LCP=${metrics.lcp}ms INP=${metrics.inp}ms CLS=${metrics.cls}`);

  expect(metrics.eventTimingSupported).toBe(true);
  expect(metrics.lcp).toBeGreaterThan(0);
  expect(metrics.lcp).toBeLessThanOrEqual(2_500);
  expect(metrics.inp).toBeLessThanOrEqual(200);
  expect(metrics.cls).toBeLessThanOrEqual(0.1);
});
