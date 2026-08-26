import { expect, test, type Locator, type Page } from "@playwright/test";

const targetViewports = [
  { width: 360, height: 800 },
  { width: 390, height: 844 },
  { width: 768, height: 1024 },
  { width: 1024, height: 768 },
  { width: 1440, height: 900 },
  { width: 1920, height: 1080 },
] as const;

async function expectNoHorizontalOverflow(page: Page) {
  const overflow = await page.evaluate(() => (
    document.documentElement.scrollWidth - document.documentElement.clientWidth
  ));
  expect(overflow).toBeLessThanOrEqual(1);
}

async function expectInsideViewport(locator: Locator, viewport: { width: number; height: number }) {
  const box = await locator.boundingBox();
  expect(box).not.toBeNull();
  if (!box) return;
  expect(box.x).toBeGreaterThanOrEqual(-1);
  expect(box.y).toBeGreaterThanOrEqual(-1);
  expect(box.x + box.width).toBeLessThanOrEqual(viewport.width + 1);
  expect(box.y + box.height).toBeLessThanOrEqual(viewport.height + 1);
}

async function expectMinimumTargetSize(locator: Locator) {
  await expect.poll(async () => (await locator.boundingBox())?.width ?? 0)
    .toBeGreaterThanOrEqual(44);
  await expect.poll(async () => (await locator.boundingBox())?.height ?? 0)
    .toBeGreaterThanOrEqual(44);
}

for (const viewport of targetViewports) {
  test(`${viewport.width} × ${viewport.height} 홈페이지와 모달이 화면 안에 유지된다`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/");

    await expect(page.getByRole("heading", { name: /한 수 두고/ })).toBeVisible();
    await expectNoHorizontalOverflow(page);

    const conceptCard = page.locator(".idea-card").first();
    await conceptCard.scrollIntoViewIfNeeded();
    await expectInsideViewport(conceptCard, viewport);

    const menuToggle = page.getByRole("button", { name: "메뉴 열기" });
    if (viewport.width <= 860) {
      await expect(menuToggle).toBeVisible();
      await expectMinimumTargetSize(menuToggle);
    } else {
      await expect(menuToggle).toBeHidden();
    }

    await page.getByRole("button", { name: /무료로 여행 시작하기/ }).click();
    const dialog = page.getByRole("dialog", { name: "누가 여행을 시작하나요?" });
    await expect(dialog).toBeVisible();
    await expectInsideViewport(dialog.locator(".modal-panel"), viewport);
    await expectNoHorizontalOverflow(page);

    const closeButton = dialog.getByRole("button", { name: "닫기" });
    await expectMinimumTargetSize(closeButton);
    await closeButton.click();
    await expect(dialog).toBeHidden();
  });
}
