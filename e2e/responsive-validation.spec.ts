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

async function expectHeroSafeRegionVisible(page: Page) {
  const result = await page.locator(".hero-image").evaluate((image: HTMLImageElement) => {
    const box = image.getBoundingClientRect();
    const scale = Math.max(box.width / image.naturalWidth, box.height / image.naturalHeight);
    const renderedWidth = image.naturalWidth * scale;
    const renderedHeight = image.naturalHeight * scale;
    const [rawX = "50%", rawY = "50%"] = getComputedStyle(image).objectPosition.split(/\s+/u);
    const percentage = (value: string) => Number.parseFloat(value) / 100;
    const cropX = Math.max(0, renderedWidth - box.width) * percentage(rawX) / scale;
    const cropY = Math.max(0, renderedHeight - box.height) * percentage(rawY) / scale;
    const visible = {
      x1: cropX,
      y1: cropY,
      x2: cropX + box.width / scale,
      y2: cropY + box.height / scale,
    };
    const safe = {
      x1: Number(image.dataset.safeX1),
      y1: Number(image.dataset.safeY1),
      x2: Number(image.dataset.safeX2),
      y2: Number(image.dataset.safeY2),
    };
    return {
      loaded: image.complete && image.naturalWidth > 0,
      contains: visible.x1 <= safe.x1 + 2
        && visible.y1 <= safe.y1 + 2
        && visible.x2 >= safe.x2 - 2
        && visible.y2 >= safe.y2 - 2,
      visible,
      safe,
    };
  });
  expect(result.loaded).toBe(true);
  expect(result.contains, JSON.stringify(result)).toBe(true);
}

type TextLayoutIssue = {
  kind: "clipped" | "overlap";
  first: string;
  second?: string;
};

async function expectTitleAndButtonTextLayout(page: Page, scopeSelector = "body") {
  const issues = await page.locator(scopeSelector).evaluate((scope): TextLayoutIssue[] => {
    const selector = "h1, h2, h3, button, a.button, a.inline-button, a.inline-link, .react-stack-card a";
    const elements = Array.from(scope.querySelectorAll<HTMLElement>(selector)).filter((element) => {
      const style = getComputedStyle(element);
      const box = element.getBoundingClientRect();
      return style.display !== "none"
        && style.visibility !== "hidden"
        && Number.parseFloat(style.opacity) > 0
        && box.width > 0
        && box.height > 0
        && element.innerText.trim().length > 0;
    });
    const label = (element: HTMLElement) => (
      element.innerText.replace(/\s+/gu, " ").trim().slice(0, 80)
    );
    const result: TextLayoutIssue[] = [];

    for (const element of elements) {
      const style = getComputedStyle(element);
      const clipsX = ["hidden", "clip"].includes(style.overflowX)
        && element.scrollWidth > element.clientWidth + 1;
      const clipsY = ["hidden", "clip"].includes(style.overflowY)
        && element.scrollHeight > element.clientHeight + 1;
      const range = document.createRange();
      range.selectNodeContents(element);
      const container = element.getBoundingClientRect();
      const textOutside = Array.from(range.getClientRects()).some((rect) => (
        rect.left < container.left - 2
        || rect.right > container.right + 2
        || rect.top < container.top - 2
        || rect.bottom > container.bottom + 2
      ));
      if (clipsX || clipsY || textOutside) result.push({ kind: "clipped", first: label(element) });
    }

    for (let firstIndex = 0; firstIndex < elements.length; firstIndex += 1) {
      const first = elements[firstIndex];
      if (!first) continue;
      const firstBox = first.getBoundingClientRect();
      for (let secondIndex = firstIndex + 1; secondIndex < elements.length; secondIndex += 1) {
        const second = elements[secondIndex];
        if (!second || first.contains(second) || second.contains(first)) continue;
        const secondBox = second.getBoundingClientRect();
        const overlapWidth = Math.min(firstBox.right, secondBox.right) - Math.max(firstBox.left, secondBox.left);
        const overlapHeight = Math.min(firstBox.bottom, secondBox.bottom) - Math.max(firstBox.top, secondBox.top);
        if (overlapWidth > 2 && overlapHeight > 2) {
          result.push({ kind: "overlap", first: label(first), second: label(second) });
        }
      }
    }
    return result;
  });

  expect(issues).toEqual([]);
}

for (const viewport of targetViewports) {
  test(`${viewport.width} × ${viewport.height} 홈페이지와 모달이 화면 안에 유지된다`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/");

    await expect(page.getByRole("heading", { name: /한 수 두고/ })).toBeVisible();
    await expectNoHorizontalOverflow(page);
    await expectTitleAndButtonTextLayout(page);
    await expectHeroSafeRegionVisible(page);

    await page.locator(".hero h1").evaluate((heading) => {
      heading.textContent = "아주 긴 한국어 제목도 작은 화면에서 자연스럽게 줄바꿈되어 내용을 모두 확인할 수 있습니다";
    });
    await expectNoHorizontalOverflow(page);
    await expectTitleAndButtonTextLayout(page, ".hero");

    const conceptCard = page.locator(".idea-card").first();
    await conceptCard.scrollIntoViewIfNeeded();
    await expectInsideViewport(conceptCard, viewport);

    const boardCandidates = page.locator(".board-point");
    for (let index = 0; index < await boardCandidates.count(); index += 1) {
      await expectMinimumTargetSize(boardCandidates.nth(index));
    }

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
    await expectTitleAndButtonTextLayout(page, ".trial-panel");

    const closeButton = dialog.getByRole("button", { name: "닫기" });
    await expectMinimumTargetSize(closeButton);
    await closeButton.click();
    await expect(dialog).toBeHidden();

    await page.route("**/api/v1/me", (route) => route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        data: {
          user: {
            id: "responsive-user",
            email: "responsive@example.test",
            emailVerified: true,
            displayName: "가나다라마바사아자차카타파하매우긴한국어사용자이름",
            roles: ["student"],
          },
        },
      }),
    }));
    await page.goto("/app.html");
    await expect(page.getByRole("heading", { name: "React 전환 환경이 준비되었습니다." })).toBeVisible();
    await expect(page.getByText(/매우긴한국어사용자이름님/)).toBeVisible();
    await expectNoHorizontalOverflow(page);
    await expectTitleAndButtonTextLayout(page);
  });
}
