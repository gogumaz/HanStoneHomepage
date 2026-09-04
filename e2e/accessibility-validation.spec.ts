import { expect, test, type Locator, type Page } from "@playwright/test";

async function expectFocusInside(dialog: Locator) {
  await expect.poll(() => dialog.evaluate((element) => element.contains(document.activeElement)))
    .toBe(true);
}

async function expectReturnsFocusAfter(
  page: Page,
  opener: Locator,
  dialog: Locator,
  close: () => Promise<void>,
) {
  await opener.click();
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("button", { name: "닫기" })).toBeFocused();
  await expectFocusInside(dialog);
  await expect(page.locator("main")).toHaveAttribute("inert", "");

  await page.keyboard.press("Shift+Tab");
  await expectFocusInside(dialog);
  await page.keyboard.press("Tab");
  await expect(dialog.getByRole("button", { name: "닫기" })).toBeFocused();

  await close();
  await expect(dialog).toBeHidden();
  await expect(opener).toBeFocused();
  await expect(page.locator("main")).not.toHaveAttribute("inert", "");
}

test("로그인·체험·미션·상담 모달의 포커스가 닫기 방식별로 복원된다", async ({ page }) => {
  await page.goto("/");

  const loginOpener = page.locator(".login-open").first();
  const loginDialog = page.getByRole("dialog", { name: "여행을 이어갈까요?" });
  await expectReturnsFocusAfter(page, loginOpener, loginDialog, async () => {
    await loginDialog.getByRole("button", { name: "닫기" }).click();
  });

  const trialOpener = page.getByRole("button", { name: "무료 체험" });
  const trialDialog = page.getByRole("dialog", { name: "누가 여행을 시작하나요?" });
  await expectReturnsFocusAfter(page, trialOpener, trialDialog, async () => {
    await page.keyboard.press("Escape");
  });

  const missionOpener = page.getByRole("button", { name: /샘플 강의 체험하기/ });
  const missionDialog = page.getByRole("dialog", { name: /주변을 살피면/ });
  await expectReturnsFocusAfter(page, missionOpener, missionDialog, async () => {
    await missionDialog.locator(".modal-backdrop").click({ position: { x: 5, y: 5 } });
  });

  const consultOpener = page.locator(".consult-open").first();
  const consultDialog = page.getByRole("dialog", { name: "기관 도입 상담" });
  await expectReturnsFocusAfter(page, consultOpener, consultDialog, async () => {
    await consultDialog.getByRole("button", { name: "닫기" }).click();
  });
});

test("상담 필수값이 비어 있으면 요청하지 않고 모달을 유지한다", async ({ page }) => {
  let requests = 0;
  await page.route("**/api/v1/consultations", async (route) => {
    requests += 1;
    await route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify({ data: {} }) });
  });
  await page.goto("/");

  await page.locator(".consult-open").first().click();
  const dialog = page.getByRole("dialog", { name: "기관 도입 상담" });
  await dialog.getByRole("button", { name: "상담 신청하기" }).click();

  await expect(dialog).toBeVisible();
  await expect(dialog.locator("select[name=category]")).toBeFocused();
  expect(requests).toBe(0);
});

test("키보드 포커스 표시와 폼 라벨, 동작 감소 설정을 유지한다", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");

  await page.keyboard.press("Tab");
  const skipLink = page.getByRole("link", { name: "본문 바로가기" });
  await expect(skipLink).toBeVisible();
  await expect(skipLink).toBeFocused();
  const focusStyle = await skipLink.evaluate((element) => {
    const style = getComputedStyle(element);
    return { outlineStyle: style.outlineStyle, outlineWidth: Number.parseFloat(style.outlineWidth) };
  });
  expect(focusStyle.outlineStyle).not.toBe("none");
  expect(focusStyle.outlineWidth).toBeGreaterThanOrEqual(2);

  const controlsWithoutLabels = await page.locator("form input, form select, form textarea").evaluateAll((controls) => (
    controls.filter((control) => !(control as HTMLInputElement).labels?.length).length
  ));
  expect(controlsWithoutLabels).toBe(0);

  await page.locator(".trial-open").first().click();
  const animationDuration = await page.locator("#trialModal .modal-panel").evaluate((element) => (
    Number.parseFloat(getComputedStyle(element).animationDuration) || 0
  ));
  expect(animationDuration).toBeLessThanOrEqual(0.001);
});

test("모바일 메뉴와 체험 역할 선택을 키보드만으로 완료한다", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");

  const menuToggle = page.locator(".menu-toggle");
  await expect(menuToggle).toHaveAccessibleName("메뉴 열기");
  await menuToggle.focus();
  await page.keyboard.press("Enter");
  await expect(menuToggle).toHaveAttribute("aria-expanded", "true");
  await expect(menuToggle).toHaveAccessibleName("메뉴 닫기");
  const navigation = page.getByRole("navigation", { name: "주요 메뉴" });
  await expect(navigation).toBeVisible();

  const journeyLink = navigation.getByRole("link", { name: "한국사 여행" });
  await journeyLink.focus();
  await page.keyboard.press("Enter");
  await expect(menuToggle).toHaveAttribute("aria-expanded", "false");
  await expect(navigation).toBeHidden();

  const trialOpener = page.getByRole("button", { name: /무료로 여행 시작하기/ });
  await trialOpener.focus();
  await page.keyboard.press("Enter");
  const trialDialog = page.getByRole("dialog", { name: "누가 여행을 시작하나요?" });
  await expect(trialDialog).toBeVisible();

  const studentRole = trialDialog.getByRole("button", { name: /학생/ });
  await studentRole.focus();
  await page.keyboard.press("Enter");
  await expect(studentRole).toHaveAttribute("aria-pressed", "true");
  const continueButton = trialDialog.getByRole("button", { name: /선택하고 계속하기/ });
  await expect(continueButton).toBeEnabled();
  await continueButton.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("dialog", { name: /주변을 살피면/ })).toBeVisible();
});

test("시대 탭과 바둑 데모를 키보드만으로 선택하고 결과를 읽는다", async ({ page }) => {
  await page.goto("/");

  const tabs = page.getByRole("tab");
  await tabs.first().focus();
  await page.keyboard.press("ArrowRight");
  await expect(tabs.nth(1)).toBeFocused();
  await expect(tabs.nth(1)).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("tabpanel")).toHaveAttribute("aria-labelledby", "era-tab-gojoseon");
  await expect(page.locator("#eraTitle")).toContainText("내 영역을 만들고");
  await expect(page.locator("#eraDescription")).toContainText("고조선");
  await expect(page.locator("#eraTags")).toContainText("포석 미션");
  await expect(page.locator(".era-copy .button")).toContainText("고조선 여행 시작");

  await page.keyboard.press("End");
  await expect(tabs.last()).toBeFocused();
  await expect(tabs.last()).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("Home");
  await expect(tabs.first()).toBeFocused();

  const feedback = page.locator("#boardFeedback");
  const candidates = [
    { name: "A 지점에 돌 놓기", message: "다시 살펴보세요" },
    { name: "B 지점에 돌 놓기", message: "정답" },
    { name: "C 지점에 돌 놓기", message: "다시 살펴보세요" },
  ];
  for (const candidate of candidates) {
    const button = page.getByRole("button", { name: candidate.name });
    await button.focus();
    await page.keyboard.press("Enter");
    await expect(feedback).toContainText(candidate.message);
    const box = await button.boundingBox();
    expect(box?.width).toBeGreaterThanOrEqual(44);
    expect(box?.height).toBeGreaterThanOrEqual(44);
  }
  await expect(feedback).toHaveAttribute("role", "status");
});

test("제목 구조와 200% 확대 상당 리플로우에서 콘텐츠를 유지한다", async ({ page }) => {
  await page.setViewportSize({ width: 640, height: 900 });
  await page.goto("/");

  const headingLevels = await page.locator("h1, h2, h3, h4, h5, h6").evaluateAll((headings) => (
    headings.map((heading) => Number(heading.tagName.slice(1)))
  ));
  expect(headingLevels.filter((level) => level === 1)).toHaveLength(1);
  for (let index = 1; index < headingLevels.length; index += 1) {
    expect(headingLevels[index] - headingLevels[index - 1]).toBeLessThanOrEqual(1);
  }

  const overflow = await page.evaluate(() => (
    document.documentElement.scrollWidth - document.documentElement.clientWidth
  ));
  expect(overflow).toBeLessThanOrEqual(1);
  await expect(page.getByRole("heading", { name: /한 수 두고/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /무료로 여행 시작하기/ })).toBeVisible();

  await expect(page.locator(".hero-image")).toHaveAccessibleName(/아이들과 바둑돌 친구들/);
  const images = page.locator("img");
  expect(await images.count()).toBeGreaterThan(0);
  for (let index = 0; index < await images.count(); index += 1) {
    await expect(images.nth(index)).toHaveAttribute("alt");
  }
  await expect(page.locator(".hero-image")).toHaveAttribute("width", "1672");
  await expect(page.locator(".hero-image")).toHaveAttribute("height", "941");
  await expect(page.locator(".mini-board")).toHaveAttribute("aria-hidden", "true");
  await expect(page.locator(".era-visual")).toHaveAttribute("aria-hidden", "true");
});

test("잠금 시대는 준비 중으로 안내하고 공개 시대만 미션을 연다", async ({ page }) => {
  await page.goto("/");

  await page.getByRole("tab", { name: /고려/ }).click();
  const eraCta = page.locator("#eraCta");
  await expect(eraCta).toHaveAttribute("data-era-available", "false");
  await expect(eraCta).toContainText("고려 여행 준비 중");
  await eraCta.click();
  await expect(page.locator("#toast")).toContainText("고려 여행은 아직 준비 중입니다.");
  await expect(page.getByRole("dialog", { name: /주변을 살피면/ })).toBeHidden();

  await page.getByRole("tab", { name: /선사시대/ }).click();
  await expect(eraCta).toHaveAttribute("data-era-available", "true");
  await eraCta.click();
  const dialog = page.getByRole("dialog", { name: /주변을 살피면/ });
  await expect(dialog).toBeVisible();

  const feedback = dialog.locator("#quizFeedback");
  const nextMission = dialog.getByRole("link", { name: /바둑미션 계속하기/ });
  await expect(nextMission).toBeHidden();
  await dialog.getByRole("button", { name: "집" }).click();
  await expect(feedback).toContainText("한 번 더 생각해 볼까요");
  await dialog.getByRole("button", { name: "활로" }).click();
  await expect(feedback).toContainText("정답이에요");
  await expect(feedback).toHaveAttribute("role", "status");
  await expect(nextMission).toBeVisible();
  await expect(nextMission).toHaveAttribute("href", "/missions");
  await expect(dialog.locator(".quiz-options button:disabled")).toHaveCount(3);
});

test("일반 텍스트가 WCAG AA 명암 대비를 충족한다", async ({ page }) => {
  await page.goto("/");
  await page.locator(".modal").evaluateAll((modals) => {
    for (const modal of modals) modal.classList.add("open");
  });

  const violations = await page.evaluate(() => {
    type Color = [number, number, number, number];

    const parseColor = (value: string): Color | null => {
      const channels = value.match(/[\d.]+/g)?.map(Number);
      if (!channels || channels.length < 3) return null;
      return [channels[0], channels[1], channels[2], channels[3] ?? 1];
    };
    const composite = (foreground: Color, background: Color): Color => {
      const alpha = foreground[3] + background[3] * (1 - foreground[3]);
      if (alpha === 0) return [0, 0, 0, 0];
      return [
        (foreground[0] * foreground[3] + background[0] * background[3] * (1 - foreground[3])) / alpha,
        (foreground[1] * foreground[3] + background[1] * background[3] * (1 - foreground[3])) / alpha,
        (foreground[2] * foreground[3] + background[2] * background[3] * (1 - foreground[3])) / alpha,
        alpha,
      ];
    };
    const luminance = ([red, green, blue]: Color) => {
      const linear = [red, green, blue].map((channel) => {
        const value = channel / 255;
        return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
      });
      return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
    };
    const contrast = (foreground: Color, background: Color) => {
      const lighter = Math.max(luminance(foreground), luminance(background));
      const darker = Math.min(luminance(foreground), luminance(background));
      return (lighter + 0.05) / (darker + 0.05);
    };
    const selector = (element: Element) => {
      if (element.id) return `#${element.id}`;
      const classes = [...element.classList].slice(0, 2).join(".");
      return `${element.tagName.toLowerCase()}${classes ? `.${classes}` : ""}`;
    };

    return [...document.querySelectorAll<HTMLElement>("body *")].flatMap((element) => {
      const hasText = [...element.childNodes].some((node) => (
        node.nodeType === Node.TEXT_NODE && Boolean(node.textContent?.trim())
      ));
      const style = getComputedStyle(element);
      if (!hasText || style.visibility === "hidden" || style.display === "none" || !element.getClientRects().length) return [];

      if (element.closest("[aria-hidden='true'], .hero, .final-cta")) return [];

      const layers: Color[] = [];
      const elementRect = element.getBoundingClientRect();
      const center = {
        x: elementRect.left + elementRect.width / 2,
        y: elementRect.top + elementRect.height / 2,
      };
      let current: HTMLElement | null = element;
      let uncertainBackground = false;
      while (current) {
        const currentStyle = getComputedStyle(current);
        const currentRect = current.getBoundingClientRect();
        const containsCenter = current === element || (
          center.x >= currentRect.left && center.x <= currentRect.right
          && center.y >= currentRect.top && center.y <= currentRect.bottom
        );
        if (containsCenter && currentStyle.backgroundImage !== "none") uncertainBackground = true;
        const background = parseColor(currentStyle.backgroundColor);
        if (containsCenter && background && background[3] > 0) layers.push(background);
        current = current.parentElement;
      }
      if (uncertainBackground) return [];

      let background: Color = [255, 255, 255, 1];
      for (const layer of layers.reverse()) background = composite(layer, background);
      const parsedForeground = parseColor(style.color);
      if (!parsedForeground) return [];
      const foreground = composite(parsedForeground, background);
      const ratio = contrast(foreground, background);
      const fontSize = Number.parseFloat(style.fontSize);
      const fontWeight = Number.parseInt(style.fontWeight, 10) || 400;
      const minimum = fontSize >= 24 || (fontSize >= 18.66 && fontWeight >= 700) ? 3 : 4.5;
      return ratio + 0.01 < minimum
        ? [{ selector: selector(element), text: element.textContent?.trim().slice(0, 40), ratio: ratio.toFixed(2), minimum }]
        : [];
    });
  });

  expect(violations).toEqual([]);
});
