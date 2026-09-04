import { expect, test, type Page } from "@playwright/test";

test("홈과 주요 정적 자산이 정상 응답하고 브라우저 오류가 없다", async ({ page, request }) => {
  await page.route("**/api/v1/me", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ data: { user: null } }),
  }));

  const resources = [
    "/",
    "/styles.css",
    "/script.js",
    "/assets/favicon.svg",
    "/assets/hero-journey.webp",
  ];

  for (const resource of resources) {
    const response = await request.get(resource);
    expect(response.status(), `${resource} 응답 상태`).toBe(200);
  }

  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => pageErrors.push(error.message));

  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  expect(consoleErrors).toEqual([]);
  expect(pageErrors).toEqual([]);
});

test("React 화면의 직접 URL 진입과 새로고침을 유지한다", async ({ page }) => {
  await page.route("**/api/v1/**", async (route) => {
    await route.fulfill({
      status: 401,
      contentType: "application/json",
      body: JSON.stringify({ error: { code: "AUTH_REQUIRED", message: "로그인이 필요합니다." } }),
    });
  });

  await page.goto("/dashboard");
  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(page.locator("#root")).not.toBeEmpty();
  await page.reload();
  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(page.locator("#root")).not.toBeEmpty();
});

test("상단 메뉴가 올바른 섹션과 화면을 가리킨다", async ({ page }) => {
  await page.goto("/");

  const sectionLinks = [
    { name: "한국사 여행", target: "#journey" },
    { name: "바둑 미션", target: "#mission" },
    { name: "교재·자료실", target: "#materials" },
  ];

  for (const { name, target } of sectionLinks) {
    await page.getByRole("navigation", { name: "주요 메뉴" }).getByRole("link", { name }).click();
    await expect(page).toHaveURL(new RegExp(`${target}$`));
    await expectSectionBelowStickyHeader(page, target);
  }

  const destinationLinks = [
    { name: "강의영상", href: "lecture.html" },
    { name: "오늘의 교실", href: "board.html?type=classHelper" },
    { name: "나의 여행지도", href: "/dashboard" },
    { name: "커뮤니티", href: "board.html?type=notice" },
  ];
  const navigation = page.getByRole("navigation", { name: "주요 메뉴" });
  for (const { name, href } of destinationLinks) {
    await expect(navigation.getByRole("link", { name })).toHaveAttribute("href", href);
  }
});

test("본문 바로가기 링크가 키보드로 본문에 포커스를 이동한다", async ({ page }) => {
  await page.goto("/");
  await page.keyboard.press("Tab");
  const skipLink = page.getByRole("link", { name: "본문 바로가기" });
  await expect(skipLink).toBeVisible();
  await expect(skipLink).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.locator("#main")).toBeFocused();
  await expect(page).toHaveURL(/#main$/);
});

async function expectSectionBelowStickyHeader(page: Page, target: string) {
  await expect.poll(async () => {
    return page.locator(target).evaluate((section) => {
      const header = document.querySelector<HTMLElement>(".site-header");
      if (!header) return false;
      return section.getBoundingClientRect().top >= header.getBoundingClientRect().bottom - 1;
    });
  }).toBe(true);
}
