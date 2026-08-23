import { expect, test } from "@playwright/test";

test("React 전환 진입점과 기존 홈페이지 링크가 보인다", async ({ page }) => {
  await page.goto("/app.html");

  await expect(
    page.getByRole("heading", { name: "React 전환 환경이 준비되었습니다." }),
  ).toBeVisible();
  await expect(page.getByRole("link", { name: "기존 홈페이지" })).toHaveAttribute(
    "href",
    "/index.html",
  );
});

test("React 계정 화면이 세션 없음 상태에서 로그인 폼을 표시한다", async ({ page }) => {
  await page.route("**/api/v1/me", async (route) => {
    await route.fulfill({
      status: 401,
      contentType: "application/json",
      body: JSON.stringify({
        error: {
          code: "AUTH_REQUIRED",
          message: "로그인이 필요합니다.",
          requestId: "req_e2e_test_123",
        },
      }),
    });
  });
  await page.route("**/api/v1/auth/password-reset/request", async (route) => {
    await route.fulfill({
      status: 202,
      contentType: "application/json",
      body: JSON.stringify({ data: { accepted: true, developmentToken: "r".repeat(43) } }),
    });
  });
  await page.goto("/app.html");
  await page.getByRole("link", { name: "계정 API 확인" }).click();

  await expect(page).toHaveURL(/\/account$/);
  await expect(page.getByRole("heading", { name: "계정과 보안" })).toBeVisible();
  await expect(page.getByLabel("이메일")).toBeVisible();
  await expect(page.getByLabel("비밀번호")).toBeVisible();

  await page.getByRole("button", { name: "비밀번호를 잊으셨나요?" }).click();
  await page.getByLabel("이메일").fill("member@example.com");
  await page.getByRole("button", { name: "재설정 안내 받기" }).click();
  await expect(page.getByLabel("재설정 토큰")).toHaveValue("r".repeat(43));

  await page.reload();
  await expect(page.getByRole("heading", { name: "계정과 보안" })).toBeVisible();
});

test("보호자 연결 화면을 직접 열고 연결된 학생의 빈 상태를 확인한다", async ({ page }) => {
  await page.route("**/api/v1/me", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        data: {
          user: {
            id: "guardian-e2e",
            email: "guardian@example.com",
            displayName: "보호자",
            roles: ["guardian"],
          },
        },
      }),
    });
  });
  await page.route("**/api/v1/guardians/me/students", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ data: { students: [] } }),
    });
  });

  await page.goto("/guardian");

  await expect(page.getByRole("heading", { name: "보호자 연결 관리" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "연결된 학생" })).toBeVisible();
  await expect(page.getByText("현재 연결된 학생이 없습니다.")).toBeVisible();
});

test("보호자가 연결된 학생의 강의·단계 진도를 확인하고 연결 해제 시 리포트를 닫는다", async ({ page }) => {
  let revoked = false;
  let reportRequests = 0;
  const link = {
    id: "link-e2e",
    student: { id: "student-e2e", displayName: "한별" },
    status: "active",
    consentedAt: "2026-08-20T00:00:00.000Z",
  };
  await page.route("**/api/v1/me", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({
      data: { user: { id: "guardian-e2e", email: "guardian@example.com", displayName: "보호자", roles: ["guardian"] } },
    }),
  }));
  await page.route("**/api/v1/guardians/me/students", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ data: { students: revoked ? [] : [link] } }),
  }));
  await page.route("**/api/v1/guardians/me/students/student-e2e/report", (route) => {
    reportRequests += 1;
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ data: {
        student: link.student,
        generatedAt: "2026-08-22T06:00:00.000Z",
        summary: {
          totalLessons: 2, startedLessons: 2, completedLessons: 1, completionRate: 50,
          completedSteps: 3, totalSteps: 4, stepCompletionRate: 75,
          lastActivityAt: "2026-08-22T05:00:00.000Z",
        },
        items: [
          {
            lesson: { id: "PRE-01", era: { id: "era-pre", name: "선사시대" }, order: 1, course: "입문 1권", title: "첫 강의", durationMinutes: 8 },
            progress: { status: "in_progress", completedSteps: 1, totalSteps: 2, lastPositionSeconds: 120, startedAt: "2026-08-21T00:00:00.000Z", completedAt: null, lastActivityAt: "2026-08-22T05:00:00.000Z" },
          },
          {
            lesson: { id: "PRE-02", era: { id: "era-pre", name: "선사시대" }, order: 2, course: "입문 1권", title: "둘째 강의", durationMinutes: 10 },
            progress: { status: "completed", completedSteps: 2, totalSteps: 2, lastPositionSeconds: 0, startedAt: "2026-08-19T00:00:00.000Z", completedAt: "2026-08-20T00:00:00.000Z", lastActivityAt: "2026-08-20T00:00:00.000Z" },
          },
        ],
      } }),
    });
  });
  await page.route("**/api/v1/me/guardian-links/link-e2e/revoke", (route) => {
    revoked = true;
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ data: { link: { ...link, status: "revoked" } } }),
    });
  });

  await page.goto("/guardian");
  await expect(page.getByText("한별")).toBeVisible();
  await page.getByRole("button", { name: "학습 리포트" }).click();
  await expect(page.getByRole("heading", { name: "한별 학생의 학습 리포트" })).toBeVisible();
  await expect(page.getByText("3 / 4")).toBeVisible();
  await expect(page.getByRole("progressbar")).toHaveAttribute("value", "75");
  await expect(page.getByText("첫 강의")).toBeVisible();
  await expect(page.getByText("둘째 강의")).toBeVisible();
  expect(reportRequests).toBe(1);

  await page.getByRole("button", { name: "연결 해제" }).click();
  await expect(page.getByText("현재 연결된 학생이 없습니다.")).toBeVisible();
  await expect(page.getByRole("heading", { name: "한별 학생의 학습 리포트" })).not.toBeVisible();
});

test("학생의 실제 진도로 나의 여행지도와 다음 이어보기 강의를 표시한다", async ({ page }) => {
  await page.route("**/api/v1/me", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({
      data: { user: { id: "student-dashboard", email: "student@example.com", displayName: "한별", roles: ["student"] } },
    }),
  }));
  await page.route("**/api/v1/me/dashboard", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ data: {
      student: { id: "student-dashboard", displayName: "한별" },
      generatedAt: "2026-08-22T07:00:00.000Z",
      access: { hasActiveSubscription: false, subscriptionEndsAt: null },
      summary: {
        totalLessons: 2, startedLessons: 1, completedLessons: 0, completionRate: 0,
        completedSteps: 1, totalSteps: 4, stepCompletionRate: 25,
        lastActivityAt: "2026-08-22T06:00:00.000Z",
      },
      eras: [
        {
          id: "era_prehistoric", order: 1, name: "선사시대", theme: "주변을 살펴라", description: "첫 시대",
          totalLessons: 2, startedLessons: 1, completedLessons: 0, completionRate: 0, status: "in_progress",
        },
        {
          id: "era_goryeo", order: 2, name: "고려", theme: "균형을 지켜라", description: "준비 중",
          totalLessons: 0, startedLessons: 0, completedLessons: 0, completionRate: 0, status: "coming_soon",
        },
      ],
      recentLessons: [{
        lesson: {
          id: "PRE-01", era: { id: "era_prehistoric", name: "선사시대", order: 1 }, order: 1,
          course: "입문 1권", title: "주먹도끼에서 배운 첫 수", durationMinutes: 8,
          isFreeSample: true, accessible: true,
        },
        progress: {
          status: "in_progress", completedSteps: 1, totalSteps: 2, lastPositionSeconds: 120,
          startedAt: "2026-08-21T00:00:00.000Z", completedAt: null, lastActivityAt: "2026-08-22T06:00:00.000Z",
        },
      }],
      nextLesson: {
        lesson: {
          id: "PRE-01", era: { id: "era_prehistoric", name: "선사시대", order: 1 }, order: 1,
          course: "입문 1권", title: "주먹도끼에서 배운 첫 수", durationMinutes: 8,
          isFreeSample: true, accessible: true,
        },
        progress: {
          status: "in_progress", completedSteps: 1, totalSteps: 2, lastPositionSeconds: 120,
          startedAt: "2026-08-21T00:00:00.000Z", completedAt: null, lastActivityAt: "2026-08-22T06:00:00.000Z",
        },
        reason: "continue",
      },
    } }),
  }));

  await page.goto("/dashboard");
  await expect(page.getByRole("heading", { name: "나의 여행지도" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "한별님의 한국사 여행" })).toBeVisible();
  await expect(page.getByText("무료 강의 이용 중")).toBeVisible();
  await expect(page.getByText("이어서 여행하기")).toBeVisible();
  await expect(page.getByRole("link", { name: "학습 이어가기" })).toHaveAttribute("href", "/lessons/PRE-01");
  const eraMap = page.getByRole("region", { name: "시대별 여행지도" });
  await expect(eraMap.getByText("선사시대")).toBeVisible();
  await expect(eraMap.getByText("여행 중")).toBeVisible();
  await expect(eraMap.getByText("고려")).toBeVisible();
  await expect(eraMap.getByText("준비 중", { exact: true }).first()).toBeVisible();
  await expect(page.getByRole("region", { name: "최근 학습" }).getByText("주먹도끼에서 배운 첫 수")).toBeVisible();
});

test("공개 강의 목록과 준비 중 시대, 강의 상세를 API 데이터로 표시한다", async ({ page }) => {
  const eras = [
    {
      id: "era_prehistoric", order: 1, name: "선사시대", theme: "주변을 살펴라",
      description: "첫 시대", status: "available", completedLessons: 0, totalLessons: 1,
    },
    {
      id: "era_goryeo", order: 4, name: "고려", theme: "균형을 지켜라",
      description: "준비 중 시대", status: "coming_soon", completedLessons: 0, totalLessons: 0,
    },
  ];
  const lesson = {
    id: "PRE-01",
    era: { id: "era_prehistoric", name: "선사시대" },
    order: 1,
    level: "입문",
    course: "입문 1권",
    title: "주먹도끼에서 배운 첫 수",
    summary: "첫 강의",
    instructor: "김바둑 선생님",
    difficulty: "처음 시작",
    durationMinutes: 8,
    isFreeSample: true,
    hasThumbnail: true,
    access: "free_sample",
    publishedAt: "2026-08-01T00:00:00.000Z",
    steps: [
      { id: "PRE-01-01", order: 1, type: "history_story", title: "역사 이야기" },
      { id: "PRE-01-02", order: 2, type: "baduk_concept", title: "오늘의 한 수" },
    ],
  };
  await page.route("**/api/v1/eras", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ data: eras }),
  }));
  await page.route("**/api/v1/eras/*/lessons", (route) => {
    const isPrehistoric = route.request().url().includes("era_prehistoric");
    const era = isPrehistoric ? eras[0] : eras[1];
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ data: { era, items: isPrehistoric ? [lesson] : [] } }),
    });
  });
  await page.route("**/api/v1/lessons/PRE-01", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ data: lesson }),
  }));
  await page.route("**/api/v1/subscription-plans", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({
      data: {
        items: [
          { id: "subscription-1m", label: "1개월", months: 1, price: 10000, recommended: false },
          { id: "subscription-3m", label: "3개월", months: 3, price: 30000, recommended: false },
          { id: "subscription-6m", label: "6개월", months: 6, price: 50000, recommended: true },
          { id: "subscription-12m", label: "12개월", months: 12, price: 100000, recommended: false },
        ],
      },
    }),
  }));
  await page.route("**/api/v1/me", (route) => route.fulfill({
    status: 401,
    contentType: "application/json",
    body: JSON.stringify({ error: { code: "AUTH_REQUIRED", message: "로그인이 필요합니다.", requestId: "req_lessons_e2e" } }),
  }));
  await page.route("**/api/v1/lessons/PRE-01/playback", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({
      data: {
        lessonId: "PRE-01",
        access: { source: "free_sample", subscriptionEndsAt: null },
        playback: {
          status: "ready",
          url: "https://media.example.test/lesson.mp4?signature=e2e",
          expiresAt: "2026-08-22T00:05:00.000Z",
          message: "재생 URL이 준비되었습니다.",
        },
      },
    }),
  }));
  await page.route("**/api/v1/lessons/PRE-01/thumbnail", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({
      data: {
        lessonId: "PRE-01",
        url: "https://media.example.test/signed-thumbnail.png",
        expiresAt: "2026-08-22T00:05:00.000Z",
      },
    }),
  }));
  await page.route("https://media.example.test/signed-thumbnail.png", (route) => route.fulfill({
    status: 200,
    contentType: "image/png",
    body: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64"),
  }));
  await page.route("**/api/v1/lessons/PRE-01/materials", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({
      data: {
        lessonId: "PRE-01",
        access: { source: "free_sample", subscriptionEndsAt: null },
        items: [{
          id: "material-e2e",
          originalName: "선사시대 활동지.pdf",
          contentType: "application/pdf",
          size: 4096,
          url: "https://media.example.test/signed-material.pdf",
          expiresAt: "2026-08-22T00:05:00.000Z",
        }],
      },
    }),
  }));

  await page.goto("/lessons");
  await expect(page.getByRole("heading", { name: "시대별 강의 여행" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "주먹도끼에서 배운 첫 수" })).toBeVisible();
  await expect(page.getByRole("img", { name: "주먹도끼에서 배운 첫 수 강의 썸네일" })).toBeVisible();
  await expect(page.getByText("50,000원")).toBeVisible();

  await page.getByRole("button", { name: /고려/ }).click();
  await expect(page.getByText("아직 공개된 강의가 없습니다.")).toBeVisible();

  await page.goto("/lessons/PRE-01");
  await expect(page.getByRole("heading", { name: "주먹도끼에서 배운 첫 수" })).toBeVisible();
  await expect(page.getByText("누구나 무료")).toBeVisible();
  await page.getByRole("button", { name: "재생 권한 확인" }).click();
  await expect(page.getByText("재생 URL이 준비되었습니다.")).toBeVisible();
  await expect(page.locator("video.lesson-video")).toHaveAttribute("src", /signature=e2e/);
  await expect(page.getByText(/재생 URL 만료/)).toBeVisible();
  await page.getByRole("button", { name: "학습자료 확인" }).click();
  await expect(page.getByText("선사시대 활동지.pdf")).toBeVisible();
  await expect(page.getByRole("link", { name: "다운로드" })).toHaveAttribute("href", /signed-material\.pdf/);
  await expect(page.getByText("진도를 저장하려면")).toBeVisible();
});

test("운영자가 MP4 영상을 업로드하고 비동기 검사를 요청한다", async ({ page }) => {
  const lesson = {
    id: "PRE-01",
    era: { id: "era_prehistoric", name: "선사시대" },
    order: 1,
    level: "입문",
    course: "입문 1권",
    title: "주먹도끼에서 배운 첫 수",
    summary: "첫 강의",
    instructor: "김바둑 선생님",
    difficulty: "처음 시작",
    durationMinutes: 8,
    isFreeSample: true,
    access: "free_sample",
    publishedAt: "2026-08-01T00:00:00.000Z",
    steps: [],
  };
  let storageUploads = 0;
  let completions = 0;
  await page.route("**/api/v1/lessons/PRE-01", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ data: lesson }),
  }));
  await page.route("**/api/v1/me", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({
      data: {
        user: {
          id: "operator-1",
          email: "operator@example.com",
          displayName: "운영자",
          roles: ["operator"],
        },
      },
    }),
  }));
  await page.route("**/api/v1/me/lessons/PRE-01/progress", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({
      data: {
        lessonId: "PRE-01", status: "not_started", completedStepIds: [], completedSteps: 0,
        totalSteps: 0, lastPositionSeconds: 0, startedAt: null, completedAt: null,
      },
    }),
  }));
  await page.route("**/api/v1/admin/lessons/PRE-01/video-upload", (route) => route.fulfill({
    status: 201,
    contentType: "application/json",
    body: JSON.stringify({
      data: {
        lessonId: "PRE-01",
        upload: {
          method: "POST",
          url: "https://storage.example.test/private-media",
          fields: {
            key: "lesson-videos/e2e.mp4",
            "Content-Type": "video/mp4",
            "x-amz-meta-lesson-id": "PRE-01",
            "x-amz-meta-expected-size": "12",
          },
          assetKey: "lesson-videos/e2e.mp4",
          expiresAt: "2026-08-22T00:05:00.000Z",
          maxBytes: 2147483648,
        },
      },
    }),
  }));
  await page.route("https://storage.example.test/private-media", (route) => {
    storageUploads += 1;
    return route.fulfill({ status: 204 });
  });
  await page.route("**/api/v1/admin/lessons/PRE-01/video-upload/complete", (route) => {
    completions += 1;
    return route.fulfill({
      status: 201,
      contentType: "application/json",
      body: JSON.stringify({
        data: {
          id: "video-asset-e2e",
          lessonId: "PRE-01",
          status: "quarantined",
          fileName: "lesson.mp4",
          contentType: "video/mp4",
          expectedSize: 12,
          size: 12,
          scanProvider: null,
          scanResult: null,
          scannedAt: null,
          attachedAt: null,
          attempts: 0,
          nextAttemptAt: "2026-08-22T00:01:00.000Z",
          lastError: null,
          isCurrent: false,
          createdAt: "2026-08-22T00:00:00.000Z",
        },
      }),
    });
  });

  await page.goto("/lessons/PRE-01");
  await expect(page.getByRole("heading", { name: "강의 영상 업로드" })).toBeVisible();
  await page.getByLabel("MP4 영상 파일").setInputFiles({
    name: "lesson.mp4",
    mimeType: "video/mp4",
    buffer: Buffer.from([0, 0, 0, 12, 102, 116, 121, 112, 105, 115, 111, 109]),
  });
  await page.getByRole("button", { name: "영상 업로드" }).click();
  await expect(page.getByText("영상 업로드를 완료했습니다. 악성코드 검사 통과 후 자동으로 강의에 연결됩니다.")).toBeVisible();
  expect(storageUploads).toBe(1);
  expect(completions).toBe(1);
});

test("운영자가 CMS에서 강의를 등록·수정하고 공개 상태를 변경한다", async ({ page }) => {
  const era = { id: "era_prehistoric", order: 1, name: "선사시대" };
  const lessons = [{
    id: "DRAFT-01",
    era: { id: era.id, name: era.name },
    order: 1,
    level: "입문",
    course: "입문 1권",
    title: "공개 준비 강의",
    summary: "영상까지 준비된 공개 전 강의입니다.",
    instructor: "김바둑 선생님",
    difficulty: "처음 시작",
    durationMinutes: 10,
    status: "draft",
    isFreeSample: false,
    hasVideo: true,
    stepCount: 6,
    publishedAt: null,
    createdAt: "2026-08-22T00:00:00.000Z",
    updatedAt: "2026-08-22T00:00:00.000Z",
  }];
  const assets: Array<Record<string, unknown>> = [];
  let videoRetried = false;
  let hlsActivated = false;
  await page.route("**/api/v1/me", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({
      data: { user: { id: "operator-1", email: "operator@example.com", displayName: "운영자", roles: ["operator"] } },
    }),
  }));
  await page.route("**/api/v1/admin/lessons", async (route) => {
    if (route.request().method() === "POST") {
      const input = route.request().postDataJSON() as Record<string, unknown>;
      const created = {
        ...input,
        era: { id: input.eraId, name: era.name },
        status: "draft",
        hasVideo: false,
        stepCount: 6,
        publishedAt: null,
        createdAt: "2026-08-22T01:00:00.000Z",
        updatedAt: "2026-08-22T01:00:00.000Z",
      };
      lessons.push(created as typeof lessons[number]);
      return route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify({ data: created }) });
    }
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ data: { eras: [era], items: lessons } }),
    });
  });
  await page.route("**/api/v1/admin/lessons/DRAFT-01", async (route) => {
    const input = route.request().postDataJSON() as Record<string, unknown>;
    Object.assign(lessons[0] ?? {}, input, { era: { id: input.eraId, name: era.name } });
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ data: lessons[0] }) });
  });
  await page.route("**/api/v1/admin/lessons/DRAFT-01/status", async (route) => {
    const input = route.request().postDataJSON() as { status: "published" };
    Object.assign(lessons[0] ?? {}, { status: input.status, publishedAt: "2026-08-22T02:00:00.000Z" });
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ data: lessons[0] }) });
  });
  await page.route("**/api/v1/admin/lessons/*/assets", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ data: { items: assets } }),
  }));
  await page.route("**/api/v1/admin/lessons/*/video-uploads", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ data: { items: route.request().url().includes("DRAFT-01") ? [{
      id: "video-error",
      lessonId: "DRAFT-01",
      status: videoRetried ? "quarantined" : "error",
      fileName: "draft-lesson.mp4",
      contentType: "video/mp4",
      expectedSize: 1048576,
      size: 1048576,
      scanProvider: null,
      scanResult: null,
      scannedAt: null,
      attachedAt: null,
      attempts: videoRetried ? 0 : 3,
      nextAttemptAt: videoRetried ? "2026-08-23T00:00:00.000Z" : null,
      lastError: videoRetried ? null : "MALWARE_SCAN_FAILED",
      isCurrent: false,
      createdAt: "2026-08-22T03:00:00.000Z",
    }] : [] } }),
  }));
  await page.route("**/api/v1/admin/lessons/DRAFT-01/video-uploads/video-error/retry", (route) => {
    videoRetried = true;
    return route.fulfill({
      status: 201,
      contentType: "application/json",
      body: JSON.stringify({ data: { id: "video-error", status: "quarantined" } }),
    });
  });
  await page.route("**/api/v1/admin/lessons/DRAFT-01/hls-source", async (route) => {
    const input = route.request().postDataJSON() as { manifestKey: string };
    hlsActivated = true;
    return route.fulfill({
      status: 201,
      contentType: "application/json",
      body: JSON.stringify({
        data: {
          lessonId: "DRAFT-01",
          format: "hls",
          manifestKey: input.manifestKey,
          activatedAt: "2026-08-24T00:00:00.000Z",
        },
      }),
    });
  });
  await page.route("**/api/v1/admin/lessons/DRAFT-01/assets/uploads", (route) => route.fulfill({
    status: 201,
    contentType: "application/json",
    body: JSON.stringify({
      data: {
        asset: { id: "asset-e2e", kind: "material", status: "quarantined" },
        upload: {
          method: "POST",
          url: "https://storage.example.test/lesson-assets",
          fields: { key: "lesson-assets/asset-e2e/source.pdf" },
          expiresAt: "2026-08-22T03:00:00.000Z",
        },
      },
    }),
  }));
  await page.route("https://storage.example.test/lesson-assets", (route) => route.fulfill({ status: 204 }));
  await page.route("**/api/v1/admin/lessons/DRAFT-01/assets/asset-e2e/complete", (route) => {
    const ready = {
      id: "asset-e2e",
      kind: "material",
      originalName: "activity.pdf",
      contentType: "application/pdf",
      size: 13,
      status: "ready",
      scanProvider: "clamav",
      scanResult: "OK",
      scannedAt: "2026-08-22T03:00:00.000Z",
      createdAt: "2026-08-22T03:00:00.000Z",
      isCurrentThumbnail: false,
    };
    assets.push(ready);
    return route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify({ data: ready }) });
  });

  await page.goto("/admin/lessons");
  await expect(page.getByRole("heading", { name: "강의 콘텐츠 관리" })).toBeVisible();
  await page.getByRole("button", { name: /DRAFT-01/ }).click();
  await page.getByLabel("HLS 마스터 재생목록 경로").fill("lesson-hls/DRAFT-01/version-1/master.m3u8");
  await page.getByRole("button", { name: "준비된 HLS 연결" }).click();
  await expect(page.getByText("HLS 재생목록을 강의에 연결했습니다.")).toBeVisible();
  expect(hlsActivated).toBe(true);
  await expect(page.getByText("검사 오류")).toBeVisible();
  await page.getByRole("button", { name: "검사 다시 시도" }).click();
  await expect(page.getByText("검사 대기", { exact: true }).first()).toBeVisible();
  await page.getByLabel("제목").fill("수정된 공개 준비 강의");
  await page.getByRole("button", { name: "수정 저장" }).click();
  await expect(page.getByText("강의 정보를 저장했습니다.")).toBeVisible();
  await page.getByRole("button", { name: "공개", exact: true }).click();
  await expect(page.getByText("강의 상태를 공개로 변경했습니다.")).toBeVisible();
  await page.getByLabel("자료 종류").selectOption("material");
  await page.getByLabel("썸네일 또는 학습자료 파일").setInputFiles({
    name: "activity.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from("%PDF-1.7 test"),
  });
  await page.getByRole("button", { name: "자료 업로드·검사" }).click();
  await expect(page.getByText("파일 검사와 활성화를 완료했습니다.")).toBeVisible();
  await expect(page.getByText("clamav: OK")).toBeVisible();

  await page.getByRole("button", { name: "새 강의 등록" }).click();
  await page.getByLabel("강의 ID").fill("PRE-02");
  await page.getByLabel("강의 순서").fill("2");
  await page.getByLabel("제목").fill("새로운 선사 강의");
  await page.getByLabel("요약").fill("관리자 CMS에서 등록한 새로운 선사시대 강의입니다.");
  await page.getByRole("button", { name: "비공개 강의 등록" }).click();
  await expect(page.getByRole("heading", { name: "PRE-02 수정" })).toBeVisible();
  await expect(page.getByRole("button", { name: /PRE-02/ })).toBeVisible();
});

test("운영자가 결제 불일치를 확인하고 PortOne 재동기화와 전액 환불을 처리한다", async ({ page }) => {
  let refunded = false;
  let reconciled = 0;
  const report = () => ({
    generatedAt: "2026-08-22T04:00:00.000Z",
    limit: 5000,
    truncated: false,
    filters: { from: "2026-07-24", to: "2026-08-23", status: "all", reconciliation: "all", search: "" },
    pagination: { page: 1, pageSize: 50, total: 2, totalPages: 1 },
    summary: { total: 2, attention: 1, paidAmount: 60000, refundedAmount: refunded ? 50000 : 0 },
    items: [
      {
        order: {
          id: "sub_expired", planId: "subscription-1m", orderName: "만료된 대기 주문",
          amount: 10000, planLabelSnapshot: "1개월", monthsSnapshot: 1, status: "pending",
          provider: "portone-v1", paymentId: null, paymentMethod: null, paidAt: null,
          refundedAmount: 0, refundedAt: null, expiresAt: "2026-08-22T01:00:00.000Z",
          createdAt: "2026-08-22T00:30:00.000Z",
          user: { id: "student-1", email: "student@example.com", displayName: "학생" },
        },
        subscription: null,
        refunds: [],
        reconciliation: { status: "attention", issues: ["expired_pending_order"], canSync: false },
      },
      {
        order: {
          id: "sub_paid", planId: "subscription-6m", orderName: "정상 구독 주문",
          amount: 50000, planLabelSnapshot: "6개월", monthsSnapshot: 6,
          status: refunded ? "canceled" : "paid", provider: "portone-v1",
          paymentId: "imp_admin_e2e", paymentMethod: "card", paidAt: "2026-08-22T02:00:00.000Z",
          refundedAmount: refunded ? 50000 : 0,
          refundedAt: refunded ? "2026-08-22T05:00:00.000Z" : null,
          expiresAt: "2026-08-22T02:30:00.000Z", createdAt: "2026-08-22T01:30:00.000Z",
          user: { id: "student-2", email: "paid@example.com", displayName: "결제 학생" },
        },
        subscription: {
          id: "subscription-admin-e2e", paymentStatus: refunded ? "refunded" : "paid",
          amountSnapshot: 50000, refundedAmount: refunded ? 50000 : 0,
          refundedAt: refunded ? "2026-08-22T05:00:00.000Z" : null,
          startsAt: "2026-08-22T02:00:00.000Z", endsAt: "2027-02-22T15:00:00.000Z",
        },
        refunds: refunded ? [{
          id: "refund-admin-e2e", amount: 50000, cumulativeAmount: 50000,
          reason: "고객 요청에 따른 전액 환불", completedAt: "2026-08-22T05:00:00.000Z",
          providerCancellationId: "cancel-admin-e2e",
        }] : [],
        reconciliation: { status: "matched", issues: [], canSync: true },
      },
    ],
  });
  await page.route("**/api/v1/me", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({
      data: { user: { id: "operator-1", email: "operator@example.com", displayName: "운영자", roles: ["operator"] } },
    }),
  }));
  await page.route(/\/api\/v1\/admin\/payments\/reconciliation(?:\?.*)?$/, (route) => route.fulfill({
    status: 200, contentType: "application/json", body: JSON.stringify({ data: report() }),
  }));
  await page.route(/\/api\/v1\/admin\/payments\/reconciliation\.csv(?:\?.*)?$/, (route) => route.fulfill({
    status: 200,
    contentType: "text/csv; charset=utf-8",
    headers: { "content-disposition": 'attachment; filename="payment-reconciliation-2026-08-23.csv"' },
    body: '\uFEFF"주문번호"\r\n"sub_paid"\r\n',
  }));
  await page.route("**/api/v1/admin/orders/sub_paid/reconcile", (route) => {
    reconciled += 1;
    return route.fulfill({
      status: 201,
      contentType: "application/json",
      body: JSON.stringify({ data: { orderId: "sub_paid", paymentId: "imp_admin_e2e", action: "payment_confirmed" } }),
    });
  });
  await page.route("**/api/v1/admin/subscriptions/subscription-admin-e2e/refund", (route) => {
    const body = route.request().postDataJSON() as { reason: string };
    expect(body.reason).toBe("고객 요청에 따른 전액 환불");
    refunded = true;
    return route.fulfill({
      status: 201,
      contentType: "application/json",
      body: JSON.stringify({ data: {
        subscriptionId: "subscription-admin-e2e", orderId: "sub_paid", paymentStatus: "refunded",
        amount: 50000, refundedAmount: 50000, refundedAt: "2026-08-22T05:00:00.000Z", accessRevoked: true,
      } }),
    });
  });

  await page.goto("/admin/payments");
  await expect(page.getByRole("heading", { name: "결제 대사 관리" })).toBeVisible();
  await expect(page.getByText("확인 필요", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("결제 대기 시간이 만료됨")).toBeVisible();

  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "CSV 내려받기" }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe("payment-reconciliation-2026-08-23.csv");
  await expect(page.getByText("현재 조회 조건의 결제 대사 CSV를 내려받았습니다.")).toBeVisible();

  const paidCard = page.locator("article").filter({ hasText: "정상 구독 주문" });
  await paidCard.getByRole("button", { name: "PortOne 재조회·동기화" }).click();
  await expect(page.getByText(/PortOne 원본과 다시 동기화했습니다/)).toBeVisible();
  expect(reconciled).toBe(1);

  await paidCard.getByRole("button", { name: "전액 환불", exact: true }).click();
  await paidCard.getByLabel("환불 사유").fill("고객 요청에 따른 전액 환불");
  await paidCard.getByLabel("전액 환불과 즉시 권한 회수를 확인했습니다.").check();
  await paidCard.getByRole("button", { name: "전액 환불 확정" }).click();
  await expect(page.getByText(/전액 환불하고 구독 권한을 회수했습니다/)).toBeVisible();
  expect(refunded).toBe(true);
});

test("로그인 사용자가 강의 단계를 완료하고 최종 진도를 저장한다", async ({ page }) => {
  const steps = [
    { id: "PRE-01-01", order: 1, type: "history_story", title: "역사 이야기" },
    { id: "PRE-01-02", order: 2, type: "baduk_concept", title: "오늘의 한 수" },
  ];
  const completedStepIds = new Set<string>();
  let status = "not_started";
  const progress = () => ({
    lessonId: "PRE-01",
    status,
    completedStepIds: [...completedStepIds],
    completedSteps: completedStepIds.size,
    totalSteps: steps.length,
    lastPositionSeconds: 0,
    startedAt: status === "not_started" ? null : "2026-08-22T00:00:00.000Z",
    completedAt: status === "completed" ? "2026-08-22T00:10:00.000Z" : null,
  });
  await page.route("**/api/v1/me", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({
      data: { user: { id: "student-e2e", email: "student@example.com", displayName: "학생", roles: ["student"] } },
    }),
  }));
  await page.route("**/api/v1/lessons/PRE-01", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({
      data: {
        id: "PRE-01", era: { id: "era_prehistoric", name: "선사시대" }, order: 1,
        level: "입문", course: "입문 1권", title: "주먹도끼에서 배운 첫 수", summary: "첫 강의",
        instructor: "김바둑 선생님", difficulty: "처음 시작", durationMinutes: 8,
        isFreeSample: true, access: "free_sample", publishedAt: "2026-08-01T00:00:00.000Z", steps,
      },
    }),
  }));
  await page.route("**/api/v1/me/lessons/PRE-01/progress", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ data: progress() }),
  }));
  await page.route("**/api/v1/lessons/PRE-01/start", (route) => {
    status = "in_progress";
    return route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify({ data: progress() }) });
  });
  await page.route("**/api/v1/lessons/PRE-01/steps/*/complete", (route) => {
    const match = route.request().url().match(/steps\/([^/]+)\/complete/);
    if (match?.[1]) completedStepIds.add(decodeURIComponent(match[1]));
    return route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify({ data: progress() }) });
  });
  await page.route("**/api/v1/lessons/PRE-01/complete", (route) => {
    status = "completed";
    return route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify({ data: progress() }) });
  });

  await page.goto("/lessons/PRE-01");
  await page.getByRole("button", { name: "강의 시작" }).click();
  await page.getByRole("listitem").filter({ hasText: "역사 이야기" }).getByRole("button", { name: "단계 완료" }).click();
  await page.getByRole("listitem").filter({ hasText: "오늘의 한 수" }).getByRole("button", { name: "단계 완료" }).click();
  await expect(page.getByText("2 / 2")).toBeVisible();
  await page.getByRole("button", { name: "강의 완료" }).click();
  await expect(page.getByText("강의를 완료했습니다.")).toBeVisible();
});

test("구독 주문을 만들고 PortOne 검증 후 구독 내역을 갱신한다", async ({ page }) => {
  let verified = false;
  const orderId = "sub_e2e_order";
  await page.addInitScript(() => {
    window.IMP = {
      init: () => undefined,
      request_pay: (_request, callback) => callback({
        imp_uid: "imp_e2e_paid",
        merchant_uid: "sub_e2e_order",
      }),
    };
  });
  await page.route("https://cdn.iamport.kr/v1/iamport.js", (route) => route.fulfill({
    status: 200, contentType: "application/javascript", body: "",
  }));
  await page.route("**/api/v1/me", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({
      data: { user: { id: "student-subscription", email: "pay@example.com", displayName: "결제 학생", roles: ["student"] } },
    }),
  }));
  await page.route("**/api/v1/subscription-plans", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({
      data: { items: [
        { id: "subscription-1m", label: "1개월", months: 1, price: 10000, recommended: false },
        { id: "subscription-6m", label: "6개월", months: 6, price: 50000, recommended: true },
      ] },
    }),
  }));
  await page.route("**/api/v1/orders/checkout", (route) => route.fulfill({
    status: 201,
    contentType: "application/json",
    body: JSON.stringify({ data: {
      orderId, orderName: "바둑타고 6개월 구독", amount: 50000, currency: "KRW",
      expiresAt: "2026-08-22T01:00:00.000Z", customerKey: "student-subscription",
      customerEmail: "pay@example.com", customerName: "결제 학생",
    } }),
  }));
  await page.route("**/api/v1/payments/portone/verify", (route) => {
    verified = true;
    return route.fulfill({
      status: 201,
      contentType: "application/json",
      body: JSON.stringify({ data: {
        orderId, orderName: "바둑타고 6개월 구독", amount: 50000, method: "card",
        subscription: {
          id: "subscription-e2e", planId: "subscription-6m",
          paidAt: "2026-08-22T00:00:00.000Z", startsAt: "2026-08-22T00:00:00.000Z",
          endsAt: "2027-02-22T15:00:00.000Z",
        },
      } }),
    });
  });
  await page.route("**/api/v1/me/subscriptions", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ data: { items: [{
      id: "subscription-refunded", orderId: "sub_refunded", planId: "subscription-1m",
      planLabelSnapshot: "1개월", monthsSnapshot: 1, amountSnapshot: 10000,
      paymentStatus: "refunded", refundedAmount: 10000, refundedAt: "2026-07-20T00:00:00.000Z",
      paidAt: "2026-07-01T00:00:00.000Z", startsAt: "2026-07-01T00:00:00.000Z",
      endsAt: "2026-08-01T15:00:00.000Z", active: false,
    }, ...(verified ? [{
      id: "subscription-e2e", orderId, planId: "subscription-6m", planLabelSnapshot: "6개월",
      monthsSnapshot: 6, amountSnapshot: 50000, paymentStatus: "paid", refundedAmount: 0, refundedAt: null,
      paidAt: "2026-08-22T00:00:00.000Z", startsAt: "2026-08-22T00:00:00.000Z",
      endsAt: "2027-02-22T15:00:00.000Z", active: true,
    }] : [])] } }),
  }));
  await page.route("**/api/v1/me/orders", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ data: { items: verified ? [{
      id: orderId, planId: "subscription-6m", orderName: "바둑타고 6개월 구독",
      amount: 50000, planLabelSnapshot: "6개월", monthsSnapshot: 6, status: "paid",
      provider: "portone-v1", paymentId: "imp_e2e_paid", paymentMethod: "card",
      refundedAmount: 0, refundedAt: null,
      paidAt: "2026-08-22T00:00:00.000Z", expiresAt: "2026-08-22T01:00:00.000Z",
      createdAt: "2026-08-22T00:00:00.000Z",
    }] : [] } }),
  }));

  await page.goto("/subscriptions");
  const sixMonthPlan = page.locator("article").filter({ has: page.getByRole("heading", { name: "6개월" }) });
  await sixMonthPlan.getByRole("button", { name: "결제하기" }).click();

  await expect(page.getByRole("heading", { name: "6개월 이용 중" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "구독 내역" })).toBeVisible();
  await expect(page.getByText("바둑타고 6개월 구독")).toBeVisible();
  await expect(page.getByText("전액 환불")).toBeVisible();
  expect(verified).toBe(true);
});
