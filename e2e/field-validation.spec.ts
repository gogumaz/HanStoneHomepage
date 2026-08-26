import { expect, test } from "@playwright/test";

const fieldEra = {
  id: "PRE",
  order: 1,
  name: "선사시대",
  theme: "주변을 먼저 살펴요",
  description: "첫 번째 역사 여행입니다.",
  status: "available",
  completedLessons: 0,
  totalLessons: 1,
};

const fieldLesson = {
  id: "PRE-01",
  era: { id: "PRE", name: "선사시대" },
  order: 1,
  level: "입문",
  course: "선사시대",
  title: "주먹도끼에서 배운 첫 수",
  summary: "주변을 관찰하며 활로를 배웁니다.",
  instructor: "바둑 선생님",
  difficulty: "쉬움",
  durationMinutes: 12,
  isFreeSample: true,
  hasThumbnail: false,
  access: "free_sample",
  publishedAt: "2026-08-24T00:00:00.000Z",
  steps: [],
};

function fulfillJson(route: import("@playwright/test").Route, data: unknown, status = 200) {
  return route.fulfill({
    status,
    contentType: "application/json",
    body: JSON.stringify(data),
  });
}

async function expectNoDocumentOverflow(page: import("@playwright/test").Page) {
  await expect.poll(() => page.evaluate(() => ({
    documentWidth: document.documentElement.scrollWidth,
    viewportWidth: document.documentElement.clientWidth,
  }))).toEqual(expect.objectContaining({
    documentWidth: expect.any(Number),
    viewportWidth: expect.any(Number),
  }));
  const overflow = await page.evaluate(() => (
    document.documentElement.scrollWidth - document.documentElement.clientWidth
  ));
  expect(overflow).toBeLessThanOrEqual(1);
}

async function exerciseLazySections(page: import("@playwright/test").Page) {
  const revealElements = page.locator(".reveal");
  const count = await revealElements.count();
  for (let index = 0; index < count; index += 1) {
    const element = revealElements.nth(index);
    if (!(await element.isVisible())) continue;
    await element.evaluate((target) => target.scrollIntoView({ block: "center" }));
    await expect(element).toHaveClass(/visible/);
  }
  await page.evaluate(() => window.scrollTo(0, 0));
}

test("홈페이지 내비게이션과 반응형 레이아웃이 실제 브라우저 규격에서 유지된다", async ({
  page,
  isMobile,
}, testInfo) => {
  await page.goto("/");

  await expect(page.getByRole("heading", { name: /한 수 두고/ })).toBeVisible();
  await expectNoDocumentOverflow(page);

  const menuToggle = page.locator(".menu-toggle");
  const mainNavigation = page.getByRole("navigation", { name: "주요 메뉴" });
  if (isMobile) {
    await expect(menuToggle).toBeVisible();
    await expect(menuToggle).toHaveAccessibleName("메뉴 열기");
    await menuToggle.click();
    await expect(menuToggle).toHaveAttribute("aria-expanded", "true");
    await expect(menuToggle).toHaveAccessibleName("메뉴 닫기");
    await expect(mainNavigation).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath("mobile-menu-open.png") });
    await mainNavigation.getByRole("link", { name: "바둑 미션" }).click();
    await expect(page).toHaveURL(/#mission$/);
    await expect(menuToggle).toHaveAttribute("aria-expanded", "false");
    await expect(mainNavigation).toBeHidden();

    const eraSelector = page.getByRole("tablist", { name: "한국사 시대 선택" });
    const eraWidths = await eraSelector.evaluate((element) => ({
      clientWidth: element.clientWidth,
      scrollWidth: element.scrollWidth,
    }));
    expect(eraWidths.scrollWidth).toBeGreaterThan(eraWidths.clientWidth);
  } else {
    await expect(menuToggle).toBeHidden();
    await expect(mainNavigation).toBeVisible();
  }

  await exerciseLazySections(page);
  await page.screenshot({ path: testInfo.outputPath("homepage.png"), fullPage: true });
});

test("React 진입 화면이 데스크톱과 모바일에서 잘림 없이 표시된다", async ({ page }, testInfo) => {
  await page.goto("/app.html");

  await expect(page.getByRole("heading", { name: "React 전환 환경이 준비되었습니다." })).toBeVisible();
  await expect(page.getByRole("link", { name: "바둑미션" })).toBeVisible();
  await expect(page.getByRole("link", { name: "계정 API 확인" })).toBeVisible();
  await expectNoDocumentOverflow(page);

  await page.screenshot({ path: testInfo.outputPath("react-entry.png"), fullPage: true });
});

test("모바일 저속 연결에서 강의 화면 셸과 로딩 안내가 먼저 표시된다", async ({
  page,
  isMobile,
}, testInfo) => {
  test.skip(!isMobile, "모바일 현장 검증 프로젝트에서 실행합니다.");

  await page.route("**/api/v1/subscription-plans", async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 900));
    await fulfillJson(route, { data: { items: [] } });
  });
  await page.route("**/api/v1/eras", async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 1_200));
    await fulfillJson(route, { data: [fieldEra] });
  });
  await page.route("**/api/v1/eras/PRE/lessons", async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 700));
    await fulfillJson(route, { data: { era: fieldEra, items: [fieldLesson] } });
  });

  await page.goto("/lessons");
  await expect(page.getByRole("heading", { name: "시대별 강의 여행" })).toBeVisible();
  await expect(page.getByRole("status")).toContainText("시대 목록을 불러오고 있습니다.");
  await page.screenshot({ path: testInfo.outputPath("slow-network-shell.png"), fullPage: true });

  await expect(page.getByRole("heading", { name: "선사시대" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "주먹도끼에서 배운 첫 수" })).toBeVisible();
  await expectNoDocumentOverflow(page);
  await page.screenshot({ path: testInfo.outputPath("slow-network-complete.png"), fullPage: true });
});

test("모바일 일시 장애 후 버튼으로 강의 목록을 복구한다", async ({
  page,
  isMobile,
}, testInfo) => {
  test.skip(!isMobile, "모바일 현장 검증 프로젝트에서 실행합니다.");
  let eraRequests = 0;

  await page.route("**/api/v1/subscription-plans", (route) => fulfillJson(route, { data: { items: [] } }));
  await page.route("**/api/v1/eras", (route) => {
    eraRequests += 1;
    if (eraRequests === 1) {
      return fulfillJson(route, {
        error: { code: "TEMPORARY_UNAVAILABLE", message: "잠시 후 다시 시도해 주세요." },
      }, 503);
    }
    return fulfillJson(route, { data: [fieldEra] });
  });
  await page.route("**/api/v1/eras/PRE/lessons", (route) => fulfillJson(route, {
    data: { era: fieldEra, items: [fieldLesson] },
  }));

  await page.goto("/lessons");
  const alert = page.getByRole("alert");
  await expect(alert).toContainText("강의 정보를 불러오지 못했습니다.");
  await page.screenshot({ path: testInfo.outputPath("temporary-failure.png"), fullPage: true });
  await alert.getByRole("button", { name: "강의 목록 다시 불러오기" }).click();

  await expect(page.getByRole("heading", { name: "주먹도끼에서 배운 첫 수" })).toBeVisible();
  expect(eraRequests).toBe(2);
  await expectNoDocumentOverflow(page);
  await page.screenshot({ path: testInfo.outputPath("retry-recovered.png"), fullPage: true });
});
