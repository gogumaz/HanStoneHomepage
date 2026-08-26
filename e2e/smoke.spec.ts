import { devices, expect, test } from "@playwright/test";

test("web responses send the CSP and browser security headers", async ({ request }) => {
  const response = await request.get("/");
  const csp = response.headers()["content-security-policy"] ?? "";

  expect(response.ok()).toBeTruthy();
  expect(csp).toContain("script-src 'self' https://js.tosspayments.com");
  expect(csp).toContain("script-src-attr 'none'");
  expect(csp).toContain("frame-ancestors 'none'");
  expect(response.headers()["x-content-type-options"]).toBe("nosniff");
  expect(response.headers()["permissions-policy"]).toContain("payment=(self)");
});

test("homepage prioritizes the optimized hero image", async ({ page }) => {
  await page.goto("/");

  const preload = page.locator('link[rel="preload"][as="image"]');
  await expect(preload).toHaveAttribute("href", "assets/hero-journey.webp");
  await expect(preload).toHaveAttribute("type", "image/webp");
  await expect(preload).toHaveAttribute("fetchpriority", "high");
  await expect(page.locator(".hero-image")).toHaveCSS(
    "background-image",
    /hero-journey\.webp/,
  );
});

test("교재 주문을 서버 가격으로 생성하고 토스 결제를 멱등 승인한다", async ({ page }) => {
  await page.route("**/config.js", (route) => route.fulfill({
    status: 200,
    contentType: "application/javascript",
    body: `window.APP_CONFIG=Object.freeze({
      apiBaseUrl:'/api/v1',
      tossPayments:Object.freeze({
        mode:'test',
        clientKey:'test_gck_store_12345678',
        paymentMethodVariantKey:'DEFAULT',
        agreementVariantKey:'AGREEMENT'
      })
    });`,
  }));
  await page.route("https://js.tosspayments.com/v2/standard", (route) => route.fulfill({
    status: 200,
    contentType: "application/javascript",
    body: `window.TossPayments=function(){return {widgets:function(){return {
      setAmount:async function(){},
      renderPaymentMethods:async function(){},
      renderAgreement:async function(){},
      requestPayment:async function(request){
        const url=new URL(request.successUrl);
        url.searchParams.set('paymentKey','payment-key-store-e2e');
        url.searchParams.set('orderId',request.orderId);
        url.searchParams.set('amount','18000');
        window.location.href=url.toString();
      }
    }}}}; window.TossPayments.ANONYMOUS='ANONYMOUS';`,
  }));

  let checkoutBody: Record<string, unknown> | undefined;
  let confirmationBody: Record<string, unknown> | undefined;
  let confirmationRequestId: string | undefined;
  const orderId = "store_00000000000040008000000000000501";
  await page.route("**/api/v1/store/orders/checkout", async (route) => {
    checkoutBody = route.request().postDataJSON() as Record<string, unknown>;
    await route.fulfill({
      status: 201,
      contentType: "application/json",
      body: JSON.stringify({ data: {
        orderId,
        orderName: "선사·고조선 편 워크북",
        amount: 18_000,
        customerKey: "00000000-0000-4000-8000-000000000501",
        customerEmail: "store@example.com",
        customerName: "교재 구매자",
      } }),
    });
  });
  await page.route("**/api/v1/payments/toss/confirm", async (route) => {
    confirmationBody = route.request().postDataJSON() as Record<string, unknown>;
    confirmationRequestId = route.request().headers()["x-request-id"];
    await route.fulfill({
      status: 201,
      contentType: "application/json",
      body: JSON.stringify({ data: {
        orderId,
        status: "paid",
        amount: 18_000,
        paymentId: "payment-key-store-e2e",
        method: "카드",
      } }),
    });
  });

  await page.goto("/");
  await page.getByRole("button", { name: "토스로 결제" }).first().click();
  await expect(page.locator("#paymentProductPrice")).toHaveText("18,000원");
  await page.locator("#shippingRecipientName").fill("홍길동");
  await page.locator("#shippingRecipientPhone").fill("010-1234-5678");
  await page.locator("#shippingPostalCode").fill("04524");
  await page.locator("#shippingAddressLine1").fill("서울특별시 중구 세종대로 110");
  await page.locator("#shippingAddressLine2").fill("3층");
  await page.locator("#tossPaymentButton").click();
  await expect(page.locator("#paymentButtonLabel")).toHaveText("결제하기");
  await page.locator("#tossPaymentButton").click();

  await expect(page.getByRole("heading", { name: "결제가 완료되었습니다" })).toBeVisible();
  await expect(page.locator("#resultDetails")).toContainText("카드");
  expect(checkoutBody).toEqual({
    items: [{ productId: "workbook-prehistory", quantity: 1 }],
    shipping: {
      recipientName: "홍길동",
      recipientPhone: "010-1234-5678",
      postalCode: "04524",
      addressLine1: "서울특별시 중구 세종대로 110",
      addressLine2: "3층",
    },
  });
  expect(confirmationBody).toEqual({
    paymentKey: "payment-key-store-e2e",
    orderId,
    amount: 18_000,
  });
  expect(confirmationRequestId).toMatch(/^toss_confirm_/);
});

test("홈페이지 기관 상담 폼이 검증된 필드만 API로 제출한다", async ({ page }) => {
  await page.route("**/config.js", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/javascript",
      body: "window.APP_CONFIG=Object.freeze({apiBaseUrl:'/api/v1',boardApiEnabled:true,oauthEnabled:false});",
    });
  });
  let submitted: Record<string, unknown> | undefined;
  await page.route("**/api/v1/consultations", async (route) => {
    submitted = route.request().postDataJSON() as Record<string, unknown>;
    await route.fulfill({
      status: 201,
      contentType: "application/json",
      body: JSON.stringify({ data: { id: "consultation-1", status: "submitted" } }),
    });
  });
  await page.goto("/");
  await page.getByRole("button", { name: "도입 문의하기" }).click();
  const form = page.locator("#consultForm");
  await form.locator('[name="category"]').selectOption("학교");
  await form.locator('[name="organizationName"]').fill("한빛초등학교");
  await form.locator('[name="contactName"]').fill("홍길동");
  await form.locator('[name="phone"]').fill("010-1234-5678");
  await form.locator('[name="email"]').fill("teacher@example.test");
  await form.locator('[name="expectedStudents"]').fill("30");
  await form.locator('[name="title"]').fill("방과후 수업 도입 문의");
  await form.locator('[name="content"]').fill("다음 학기 방과후 바둑 수업 도입을 상담하고 싶습니다.");
  await form.locator('[name="privacyConsent"]').check();
  await form.getByRole("button", { name: "상담 신청하기" }).click();

  await expect(page.locator("#toast")).toContainText("상담 신청이 접수되었습니다");
  expect(submitted).toEqual({
    category: "학교",
    organizationName: "한빛초등학교",
    contactName: "홍길동",
    phone: "010-1234-5678",
    email: "teacher@example.test",
    expectedStudents: 30,
    title: "방과후 수업 도입 문의",
    content: "다음 학기 방과후 바둑 수업 도입을 상담하고 싶습니다.",
    privacyConsent: true,
  });
});

test("로그인 회원이 1:1 문의를 접수하고 본인 답변만 확인한다", async ({ page }) => {
  await page.route("**/config.js", async (route) => route.fulfill({
    status: 200,
    contentType: "application/javascript",
    body: "window.APP_CONFIG=Object.freeze({apiBaseUrl:'/api/v1',boardApiEnabled:true,demoRoleSwitcher:false});",
  }));
  const requesterUserId = "student-inquiry-1";
  const records: Array<Record<string, unknown>> = [{
    id: "inquiry-existing", requesterUserId, category: "학습", title: "기존 문의",
    content: "기존 문의 내용입니다.", answer: "운영자 답변 내용입니다.", status: "answered",
    createdAt: "2026-08-24T00:00:00.000Z", updatedAt: "2026-08-24T01:00:00.000Z",
  }];
  await page.route("**/api/v1/me", async (route) => route.fulfill({
    status: 200, contentType: "application/json",
    body: JSON.stringify({ data: { user: { id: requesterUserId, displayName: "문의 학생", roles: ["student"] } } }),
  }));
  await page.route("**/api/v1/me/inquiries", async (route) => route.fulfill({
    status: 200, contentType: "application/json", body: JSON.stringify({ data: { items: records } }),
  }));
  let submitted: Record<string, unknown> | undefined;
  let uploadedAttachment = false;
  let completedAttachment = false;
  const attachmentId = "00000000-0000-4000-8000-000000000701";
  await page.route("**/api/v1/inquiry-attachments/uploads", async (route) => route.fulfill({
    status: 201,
    contentType: "application/json",
    body: JSON.stringify({ data: {
      attachment: { id: attachmentId, status: "quarantined" },
      upload: {
        method: "POST",
        url: "https://storage.example.test/private-media",
        fields: { key: `inquiry-attachments/${attachmentId}/source.pdf` },
        expiresAt: "2026-08-24T04:00:00.000Z",
      },
    } }),
  }));
  await page.route("https://storage.example.test/private-media", async (route) => {
    uploadedAttachment = true;
    await route.fulfill({ status: 204 });
  });
  await page.route(`**/api/v1/inquiry-attachments/${attachmentId}/complete`, async (route) => {
    completedAttachment = true;
    await route.fulfill({
      status: 201,
      contentType: "application/json",
      body: JSON.stringify({ data: { id: attachmentId, originalName: "진도 화면.pdf", contentType: "application/pdf", size: 24, status: "ready" } }),
    });
  });
  await page.route("**/api/v1/inquiries", async (route) => {
    submitted = route.request().postDataJSON() as Record<string, unknown>;
    const { attachmentId: submittedAttachmentId, ...fields } = submitted;
    records.unshift({
      id: "inquiry-new", requesterUserId, ...fields,
      attachment: submittedAttachmentId ? {
        id: submittedAttachmentId,
        originalName: "진도 화면.pdf",
        contentType: "application/pdf",
        size: 24,
        status: "ready",
      } : null,
      answer: null, status: "submitted",
      createdAt: "2026-08-24T02:00:00.000Z", updatedAt: "2026-08-24T02:00:00.000Z",
    });
    await route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify({ data: { inquiry: records[0] } }) });
  });

  await page.goto("/board.html?type=inquiry");
  await page.getByRole("button", { name: /기존 문의/ }).click();
  await expect(page.locator("#detailBody")).toContainText("운영자 답변 내용입니다.");
  await page.getByRole("button", { name: "닫기" }).click();
  await page.getByRole("button", { name: "문의하기" }).click();
  const form = page.locator("#dynamicForm");
  await form.getByLabel("문의 유형 *").selectOption("학습");
  await form.getByLabel("제목 *").fill("새로운 진도 문의");
  await form.getByLabel("문의 내용 *").fill("강의 완료 상태를 다시 확인해 주세요.");
  const attachmentInput = form.locator('input[type="file"]');
  await expect(attachmentInput).toHaveAttribute('accept', '.jpg,.jpeg,.png,.webp,.pdf');
  await attachmentInput.setInputFiles({ name: "진도 화면.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.7 safe inquiry") });
  await page.getByRole("button", { name: "저장하기" }).click();
  await expect(page.locator("#toast")).toContainText("정상적으로 접수되었습니다");
  expect(submitted).toEqual({
    category: "학습",
    title: "새로운 진도 문의",
    content: "강의 완료 상태를 다시 확인해 주세요.",
    attachmentId,
  });
  expect(uploadedAttachment).toBe(true);
  expect(completedAttachment).toBe(true);
  await page.getByRole("button", { name: /새로운 진도 문의/ }).click();
  await expect(page.getByRole("link", { name: "다운로드" })).toHaveAttribute(
    "href",
    /\/api\/v1\/me\/inquiries\/inquiry-new\/attachment$/,
  );
});

test("문의 답변 알림을 읽음 처리하고 본인 문의 상세를 바로 연다", async ({ page }) => {
  const requesterUserId = "student-notification-e2e";
  const inquiryId = "inquiry-notification-e2e";
  let readNotification = false;
  await page.route("**/config.js", async (route) => route.fulfill({
    status: 200,
    contentType: "application/javascript",
    body: "window.APP_CONFIG=Object.freeze({apiBaseUrl:'/api/v1',boardApiEnabled:true,demoRoleSwitcher:false});",
  }));
  await page.route("**/api/v1/me", async (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ data: { user: {
      id: requesterUserId,
      displayName: "알림 학생",
      email: "student@example.test",
      emailVerified: true,
      roles: ["student"],
    } } }),
  }));
  await page.route("**/api/v1/me/notifications?*", async (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ data: {
      items: [{
        id: "notification-e2e",
        kind: "inquiry_answered",
        resourceType: "Inquiry",
        resourceId: inquiryId,
        resourceVersion: 1,
        title: "문의 답변이 등록되었습니다",
        message: "본인 문의함에서 답변을 확인해 주세요.",
        readAt: null,
        createdAt: "2026-08-24T03:00:00.000Z",
      }],
      unreadCount: 1,
      pagination: { page: 1, pageSize: 20, total: 1, totalPages: 1 },
    } }),
  }));
  await page.route("**/api/v1/me/notifications/notification-e2e/read", async (route) => {
    readNotification = true;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ data: { notification: {
        id: "notification-e2e",
        kind: "inquiry_answered",
        resourceType: "Inquiry",
        resourceId: inquiryId,
        resourceVersion: 1,
        title: "문의 답변이 등록되었습니다",
        message: "본인 문의함에서 답변을 확인해 주세요.",
        readAt: "2026-08-24T03:01:00.000Z",
        createdAt: "2026-08-24T03:00:00.000Z",
      } } }),
    });
  });
  await page.route("**/api/v1/me/inquiries", async (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ data: { items: [{
      id: inquiryId,
      requesterUserId,
      category: "학습",
      title: "알림에서 여는 문의",
      content: "진도 저장 방법을 알려주세요.",
      answer: "로그인 계정에 자동으로 저장됩니다.",
      status: "answered",
      createdAt: "2026-08-24T00:00:00.000Z",
      updatedAt: "2026-08-24T03:00:00.000Z",
    }] } }),
  }));

  await page.goto("/notifications");
  await expect(page.getByText("읽지 않은 알림 1개")).toBeVisible();
  await page.getByRole("link", { name: "문의 답변 열기" }).click();

  await expect(page).toHaveURL(new RegExp(`/board\\.html\\?type=inquiry&id=${inquiryId}$`));
  await expect(page.locator("#detailModal")).toHaveClass(/open/);
  await expect(page.locator("#detailBody")).toContainText("로그인 계정에 자동으로 저장됩니다.");
  expect(readNotification).toBe(true);
});

test("운영자가 공지사항을 서버에 등록하고 공개 목록에서 확인한다", async ({ page }) => {
  await page.route("**/config.js", async (route) => route.fulfill({
    status: 200,
    contentType: "application/javascript",
    body: "window.APP_CONFIG=Object.freeze({apiBaseUrl:'/api/v1',boardApiEnabled:true,demoRoleSwitcher:false});",
  }));
  await page.route("**/api/v1/me", async (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ data: { user: {
      id: "editorial-operator-e2e", displayName: "콘텐츠 운영자", email: "operator@example.test",
      emailVerified: true, roles: ["operator"],
    } } }),
  }));
  const notices: Array<Record<string, unknown>> = [{
    id: "notice-existing-e2e", category: "서비스", title: "기존 서비스 공지",
    content: "기존 공지 내용입니다.", authorLabel: "운영자", publishedAt: "2026-08-20T00:00:00.000Z",
    isPinned: false, displayOrder: null, status: "published",
  }];
  let submitted: Record<string, unknown> | undefined;
  await page.route("**/api/v1/notices", async (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ data: {
      items: notices,
      pagination: { page: 1, pageSize: 50, total: notices.length, totalPages: 1 },
    } }),
  }));
  await page.route("**/api/v1/admin/notices", async (route) => {
    submitted = route.request().postDataJSON() as Record<string, unknown>;
    notices.unshift({
      id: "notice-new-e2e", ...submitted, authorLabel: "운영자",
      publishedAt: `${String(submitted.publishedAt)}T00:00:00.000Z`, status: "published",
    });
    await route.fulfill({
      status: 201,
      contentType: "application/json",
      body: JSON.stringify({ data: { item: notices[0] } }),
    });
  });

  await page.goto("/board.html?type=notice");
  await expect(page.getByRole("heading", { name: "공지사항" })).toBeVisible();
  await expect(page.getByText("기존 서비스 공지")).toBeVisible();
  await page.getByRole("button", { name: "공지 등록" }).click();
  const form = page.locator("#boardWriteForm");
  await form.getByLabel("분류 *").selectOption("콘텐츠");
  await form.getByLabel("제목 *").fill("새 강의 공개 안내");
  await form.getByLabel("내용 *").fill("선사시대 신규 강의가 공개되었습니다.");
  await form.getByLabel("공개일 *").fill("2026-08-24");
  await form.getByLabel("상단 고정").check();
  await form.getByRole("button", { name: "저장하기" }).click();

  await expect(page.locator("#toast")).toContainText("글이 저장되었습니다.");
  await expect(page.getByText("새 강의 공개 안내")).toBeVisible();
  expect(submitted).toEqual({
    category: "콘텐츠",
    title: "새 강의 공개 안내",
    content: "선사시대 신규 강의가 공개되었습니다.",
    publishedAt: "2026-08-24",
    isPinned: true,
    attachment: "",
  });
});

test("지도자 수업 팁을 검토 대기로 저장하고 운영자가 승인한다", async ({ page }) => {
  await page.route("**/config.js", async (route) => route.fulfill({
    status: 200,
    contentType: "application/javascript",
    body: "window.APP_CONFIG=Object.freeze({apiBaseUrl:'/api/v1',boardApiEnabled:true,demoRoleSwitcher:false});",
  }));
  let currentRole: "instructor" | "operator" | "student" | "guest" = "instructor";
  await page.route("**/api/v1/me", async (route) => {
    if (currentRole === "guest") {
      await route.fulfill({ status: 401, contentType: "application/json", body: JSON.stringify({ error: { code: "AUTH_REQUIRED" } }) });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ data: { user: {
        id: currentRole === "instructor" ? "instructor-community-e2e" : `${currentRole}-community-e2e`,
        displayName: currentRole === "instructor" ? "김지도" : currentRole === "student" ? "학생" : "커뮤니티 운영자",
        email: `${currentRole}@example.test`, emailVerified: true, roles: [currentRole],
      } } }),
    });
  });
  const posts: Array<Record<string, unknown>> = [];
  let submitted: Record<string, unknown> | undefined;
  let reported: Record<string, unknown> | undefined;
  let approved = false;
  const attachmentId = "00000000-0000-4000-8000-000000000721";
  await page.route("**/api/v1/community-attachments/uploads", async (route) => {
    expect(route.request().postDataJSON()).toEqual({
      kind: "material", fileName: "활로-활동지.pdf", contentType: "application/pdf", size: 17,
    });
    await route.fulfill({
      status: 201, contentType: "application/json",
      body: JSON.stringify({ data: {
        attachment: { id: attachmentId, kind: "material", status: "quarantined" },
        upload: { method: "POST", url: "https://storage.example.test/community-upload", fields: { key: "community.pdf" } },
      } }),
    });
  });
  await page.route("https://storage.example.test/community-upload", (route) => route.fulfill({ status: 204, body: "" }));
  await page.route(`**/api/v1/community-attachments/${attachmentId}/complete`, (route) => route.fulfill({
    status: 201, contentType: "application/json",
    body: JSON.stringify({ data: {
      id: attachmentId, kind: "material", originalName: "활로-활동지.pdf",
      contentType: "application/pdf", size: 17, status: "ready",
    } }),
  }));
  await page.route("**/api/v1/posts?type=classTip", async (route) => {
    const visible = currentRole === "guest" ? posts.filter((post) => post.status === "published") : posts;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ data: { items: visible, pagination: { page: 1, pageSize: 50, total: visible.length, totalPages: 1 } } }),
    });
  });
  await page.route("**/api/v1/posts", async (route) => {
    submitted = route.request().postDataJSON() as Record<string, unknown>;
    posts.unshift({
      id: "community-tip-e2e", ...submitted, authorLabel: "김지도", status: "pending_review",
      attachment: submitted.attachmentId ? {
        originalName: "활로-활동지.pdf", contentType: "application/pdf", size: 17,
        kind: "material", downloadUrl: "/api/v1/posts/community-tip-e2e/attachment",
      } : null,
      publishedAt: null, createdAt: "2026-08-24T00:00:00.000Z", updatedAt: "2026-08-24T00:00:00.000Z",
    });
    await route.fulfill({
      status: 201,
      contentType: "application/json",
      body: JSON.stringify({ data: { post: posts[0] } }),
    });
  });
  await page.route("**/api/v1/admin/posts?type=classTip", async (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ data: { items: posts, pagination: { page: 1, pageSize: 50, total: posts.length, totalPages: 1 } } }),
  }));
  await page.route("**/api/v1/admin/posts/community-tip-e2e/publish", async (route) => {
    approved = true;
    Object.assign(posts[0]!, { status: "published", publishedAt: "2026-08-24T01:00:00.000Z" });
    await route.fulfill({
      status: 201,
      contentType: "application/json",
      body: JSON.stringify({ data: { post: posts[0] } }),
    });
  });
  await page.route("**/api/v1/posts/community-tip-e2e/reports", async (route) => {
    reported = route.request().postDataJSON() as Record<string, unknown>;
    await route.fulfill({
      status: 201,
      contentType: "application/json",
      body: JSON.stringify({ data: { report: {
        id: "community-report-board-e2e", status: "open", createdAt: "2026-08-24T02:00:00.000Z",
      } } }),
    });
  });

  await page.goto("/board.html?type=classTip");
  await page.getByRole("button", { name: "수업 팁 작성" }).click();
  const form = page.locator("#boardWriteForm");
  await form.getByLabel("분류 *").selectOption("바둑활동");
  await form.getByLabel("제목 *").fill("활로 관찰 수업");
  await form.getByLabel("대상 학년 *").selectOption("초등 3~4학년");
  await form.getByLabel("연결 시대 *").selectOption("선사시대");
  await form.getByLabel("바둑 수준 *").selectOption("입문");
  await form.getByLabel("수업 내용 *").fill("주변 환경 관찰과 활로 찾기를 연결합니다.");
  await form.getByLabel("수업자료 첨부").setInputFiles({
    name: "활로-활동지.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.7 activity"),
  });
  await form.getByRole("button", { name: "저장하기" }).click();
  await expect(page.locator("#toast")).toContainText("글이 저장되었습니다.");
  await expect(page.getByRole("button", { name: /활로 관찰 수업/ })).toContainText("검토 대기");
  expect(submitted).toEqual({
    category: "바둑활동", title: "활로 관찰 수업", targetGrade: "초등 3~4학년",
    era: "선사시대", badukLevel: "입문", content: "주변 환경 관찰과 활로 찾기를 연결합니다.",
    attachmentId, type: "classTip",
  });

  currentRole = "operator";
  await page.reload();
  await page.getByRole("button", { name: /활로 관찰 수업/ }).click();
  await expect(page.getByRole("link", { name: "다운로드" })).toHaveAttribute(
    "href", /\/api\/v1\/posts\/community-tip-e2e\/attachment$/,
  );
  await page.getByRole("button", { name: "승인·공개" }).click();
  await expect(page.locator("#toast")).toContainText("게시글을 승인하고 공개했습니다.");
  expect(approved).toBe(true);

  currentRole = "guest";
  await page.reload();
  await expect(page.getByRole("button", { name: /활로 관찰 수업/ })).toContainText("공개");

  currentRole = "student";
  await page.reload();
  await page.getByRole("button", { name: /활로 관찰 수업/ }).click();
  page.on("dialog", async (dialog) => {
    await dialog.accept(dialog.message().includes("신고 사유 번호") ? "2" : "학생 연락처가 노출되었습니다.");
  });
  await page.getByRole("button", { name: "신고", exact: true }).click();
  await expect(page.locator("#toast")).toContainText("신고가 접수되었습니다.");
  expect(reported).toEqual({ reason: "personal_info", detail: "학생 연락처가 노출되었습니다." });
});

test("운영자가 커뮤니티 신고를 확인하고 게시글을 숨긴다", async ({ page }) => {
  const report = {
    id: "community-report-e2e",
    reason: "personal_info",
    detail: "학생 연락처가 본문에 노출되어 있습니다.",
    status: "open",
    resolution: null,
    resolvedAt: null,
    createdAt: "2026-08-24T01:00:00.000Z",
    post: {
      id: "community-post-e2e", type: "classTip", title: "교실 대항전 운영 팁",
      status: "published", authorLabel: "김지도",
    },
  };
  let hidden = false;
  await page.route("**/api/v1/me", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ data: { user: {
      id: "operator-community-report-e2e", displayName: "커뮤니티 운영자",
      email: "operator@example.test", emailVerified: true, roles: ["operator"],
    } } }),
  }));
  await page.route(/\/api\/v1\/admin\/community-reports\?.*$/, (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ data: {
      items: hidden ? [] : [report],
      pagination: { page: 1, pageSize: 20, total: hidden ? 0 : 1, totalPages: 1 },
    } }),
  }));
  await page.route("**/api/v1/admin/community-reports/community-report-e2e/resolve", async (route) => {
    expect(route.request().postDataJSON()).toEqual({ action: "hide" });
    hidden = true;
    await route.fulfill({
      status: 201,
      contentType: "application/json",
      body: JSON.stringify({ data: { report: {
        ...report, status: "resolved", resolution: "hidden",
        resolvedAt: "2026-08-24T02:00:00.000Z", post: { ...report.post, status: "hidden" },
      } } }),
    });
  });

  await page.goto("/admin/community-reports");
  await expect(page.getByRole("heading", { name: "커뮤니티 신고함" })).toBeVisible();
  await expect(page.getByText("교실 대항전 운영 팁")).toBeVisible();
  await expect(page.getByText("개인정보 노출")).toBeVisible();
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "게시글 숨김" }).click();
  await expect(page.getByText("게시글을 숨기고 관련 미처리 신고를 종결했습니다.")).toBeVisible();
  await expect(page.getByText("조건에 맞는 신고가 없습니다.")).toBeVisible();
  expect(hidden).toBe(true);
});

test("운영자가 1:1 문의를 검색하고 답변한 뒤 종료한다", async ({ page }) => {
  const inquiryId = "inquiry-admin-e2e";
  let current = {
    id: inquiryId, requesterUserId: "student-inquiry-e2e", category: "학습",
    title: "진도 저장 문의", content: "다른 기기에서도 진도가 유지되는지 궁금합니다.",
    status: "submitted", answer: null as string | null, answeredById: null as string | null,
    answeredAt: null as string | null, attachment: null,
    createdAt: "2026-08-24T00:00:00.000Z", updatedAt: "2026-08-24T00:00:00.000Z",
  };
  await page.route("**/api/v1/me", async (route) => route.fulfill({
    status: 200, contentType: "application/json",
    body: JSON.stringify({ data: { user: {
      id: "operator-inquiry-e2e", displayName: "운영자", email: "operator@example.test",
      emailVerified: true, roles: ["operator"],
    } } }),
  }));
  await page.route("**/api/v1/admin/inquiries?*", async (route) => route.fulfill({
    status: 200, contentType: "application/json",
    body: JSON.stringify({ data: {
      items: [current], pagination: { page: 1, pageSize: 20, total: 1, totalPages: 1 },
    } }),
  }));
  let submittedAnswer: Record<string, unknown> | undefined;
  let submittedStatus: Record<string, unknown> | undefined;
  let notificationJobs: Array<Record<string, unknown>> = [];
  let retriedNotification = false;
  await page.route("**/api/v1/admin/inquiry-notification-jobs/notification-admin-e2e/retry", async (route) => {
    retriedNotification = true;
    notificationJobs = notificationJobs.map((job) => ({
      ...job, status: "pending", attempts: 0, lastError: null, manualRetryAvailable: false,
    }));
    await route.fulfill({
      status: 201, contentType: "application/json",
      body: JSON.stringify({ data: { job: notificationJobs[0] } }),
    });
  });
  await page.route("**/api/v1/admin/inquiries/**", async (route) => {
    const request = route.request();
    if (request.url().endsWith("/notification-jobs")) {
      await route.fulfill({
        status: 200, contentType: "application/json",
        body: JSON.stringify({ data: { items: notificationJobs } }),
      });
      return;
    }
    if (request.url().endsWith("/answer")) {
      submittedAnswer = request.postDataJSON() as Record<string, unknown>;
      current = {
        ...current, status: "answered", answer: String(submittedAnswer.answer),
        answeredById: "operator-inquiry-e2e", answeredAt: "2026-08-24T01:00:00.000Z",
      };
      notificationJobs = [{
        id: "notification-admin-e2e", inquiryId, answerVersion: 1,
        status: "error", attempts: 5, nextAttemptAt: "2026-08-24T02:00:00.000Z",
        completedAt: null, lastError: "SMTP_TEMPORARY_FAILURE", manualRetryAvailable: true,
        createdAt: "2026-08-24T01:00:00.000Z", updatedAt: "2026-08-24T01:30:00.000Z",
      }];
    } else if (request.url().endsWith("/status")) {
      submittedStatus = request.postDataJSON() as Record<string, unknown>;
      current = { ...current, status: String(submittedStatus.status) };
    }
    await route.fulfill({
      status: 200, contentType: "application/json",
      body: JSON.stringify({ data: { inquiry: current } }),
    });
  });

  await page.goto("/admin/inquiries");
  await expect(page.getByRole("heading", { name: "1:1 문의 관리" })).toBeVisible();
  await expect(page.getByRole("region", { name: "문의 상세" }).getByText("다른 기기에서도 진도가 유지되는지 궁금합니다.")).toBeVisible();
  await page.getByLabel("운영자 답변").fill("로그인 계정 기준으로 진도가 자동 동기화됩니다.");
  await page.getByRole("button", { name: "답변 등록" }).click();
  await expect(page.getByText("문의 답변을 저장했습니다. 이메일 알림은 별도로 처리됩니다.")).toBeVisible();
  expect(submittedAnswer).toEqual({ answer: "로그인 계정 기준으로 진도가 자동 동기화됩니다." });
  await expect(page.getByText("SMTP_TEMPORARY_FAILURE")).toBeVisible();
  await page.getByRole("button", { name: "이메일 재시도" }).click();
  await expect(page.getByText("답변 이메일 발송을 다시 요청했습니다.")).toBeVisible();
  await expect(page.getByText("발송 대기")).toBeVisible();
  expect(retriedNotification).toBe(true);
  await page.getByRole("button", { name: "종료 전환" }).click();
  await expect(page.getByText(/문의 상태를 '종료'/)).toBeVisible();
  expect(submittedStatus).toEqual({ status: "closed" });
});

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
  const linkedMission = {
    id: "MISSION-PRE-01", version: 1, title: "주먹도끼의 단단한 연결",
    instruction: "끊기지 않도록 돌을 연결하세요.", level: "입문", volume: 1, lessonNumber: 1,
    problemGroup: "개념 확인", category: "연결", difficulty: 1, boardSize: 9,
    playerColor: "black", missionType: "best_move", baseScore: 100, timeLimitSeconds: null,
    retryLimit: 3, isFreeSample: true, reward: { id: "mission-star", quantity: 1 }, isFavorite: false,
    initialBlackStones: [{ x: 3, y: 4 }], initialWhiteStones: [], hintsAvailable: 1, progress: null,
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
  await page.route(/\/api\/v1\/missions\?lessonId=PRE-01$/, (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ data: { items: [linkedMission] } }),
  }));
  await page.route("**/api/v1/missions/MISSION-PRE-01", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ data: { mission: linkedMission, attempt: null } }),
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
  const missionSection = page.getByRole("region", { name: "판 위의 미션" });
  await expect(missionSection.getByText(linkedMission.title)).toBeVisible();
  const missionLink = missionSection.getByRole("link", { name: "미션 풀기" });
  await expect(missionLink).toHaveAttribute("href", `/missions?lessonId=PRE-01&missionId=${linkedMission.id}`);
  await missionLink.click();
  await expect(page).toHaveURL(new RegExp(`/missions\\?lessonId=PRE-01&missionId=${linkedMission.id}$`));
  await expect(page.getByRole("dialog").getByRole("heading", { name: linkedMission.title })).toBeVisible();
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

test("운영자가 워커 적체와 오래된 잠금을 확인하고 상태를 새로고침한다", async ({ page }) => {
  let healthRequests = 0;
  await page.route("**/api/v1/me", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({
      data: { user: { id: "operator-health", email: "operator@example.test", displayName: "운영자", roles: ["operator"] } },
    }),
  }));
  await page.route("**/api/v1/admin/operations/worker-health", (route) => {
    healthRequests += 1;
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ data: {
        status: "critical",
        checkedAt: "2026-08-24T00:30:00.000Z",
        backlogThresholdMinutes: 15,
        queues: [
          { name: "accountMail", status: "critical", due: 2, staleLocks: 1, terminalErrors: 0, oldestDueAt: "2026-08-24T00:00:00.000Z" },
          { name: "inquiryNotification", status: "attention", due: 0, staleLocks: 0, terminalErrors: 1, oldestDueAt: null },
          { name: "videoScan", status: "healthy", due: 0, staleLocks: 0, terminalErrors: 0, oldestDueAt: null },
          { name: "hlsTranscode", status: "healthy", due: 0, staleLocks: 0, terminalErrors: 0, oldestDueAt: null },
          { name: "objectDeletion", status: "healthy", due: 0, staleLocks: 0, terminalErrors: 0, oldestDueAt: null },
        ],
      } }),
    });
  });

  await page.goto("/admin/operations");
  await expect(page.getByRole("heading", { name: "운영 워커 상태" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "즉시 확인" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "계정 인증·복구 메일" })).toBeVisible();
  await expect(page.getByText("위험 적체 기준 15분")).toBeVisible();
  await page.getByRole("button", { name: "상태 새로고침" }).click();
  await expect.poll(() => healthRequests).toBe(2);
});

test("운영자가 결제 불일치를 확인하고 토스 재동기화와 전액 환불을 처리한다", async ({ page }) => {
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
          provider: "toss-payments", paymentId: null, paymentMethod: null, paidAt: null,
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
          status: refunded ? "canceled" : "paid", provider: "toss-payments",
          paymentId: "pay_admin_e2e", paymentMethod: "card", paidAt: "2026-08-22T02:00:00.000Z",
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
  await page.route("**/api/v1/admin/store-orders", (route) => route.fulfill({
    status: 200, contentType: "application/json", body: JSON.stringify({ data: { items: [] } }),
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
  await paidCard.getByRole("button", { name: "토스 재조회·동기화" }).click();
  await expect(page.getByText(/토스 원본과 다시 동기화했습니다/)).toBeVisible();
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

test("구독 주문을 만들고 토스 승인 후 구독 내역을 갱신한다", async ({ page }) => {
  let verified = false;
  let confirmationRequestId: string | undefined;
  const orderId = "sub_e2e_order";
  await page.route("**/config.js", (route) => route.fulfill({
    status: 200, contentType: "application/javascript",
    body: "window.APP_CONFIG=Object.freeze({apiBaseUrl:'/api/v1',tossPayments:Object.freeze({mode:'test',clientKey:'test_gck_subscription_12345678',paymentMethodVariantKey:'DEFAULT',agreementVariantKey:'AGREEMENT'})});",
  }));
  await page.route("https://js.tosspayments.com/v2/standard", (route) => route.fulfill({
    status: 200, contentType: "application/javascript", body: `window.TossPayments=function(){return {widgets:function(){return {
      setAmount:async function(){},renderPaymentMethods:async function(){},renderAgreement:async function(){},
      requestPayment:async function(request){const url=new URL(request.successUrl);url.searchParams.set('paymentKey','pay_e2e_paid');url.searchParams.set('orderId','sub_e2e_order');url.searchParams.set('amount','50000');window.location.href=url.toString();}
    }}}};window.TossPayments.ANONYMOUS='ANONYMOUS';`,
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
  await page.route("**/api/v1/payments/toss/subscriptions/confirm", (route) => {
    verified = true;
    confirmationRequestId = route.request().headers()["x-request-id"];
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
      provider: "toss-payments", paymentId: "pay_e2e_paid", paymentMethod: "card",
      refundedAmount: 0, refundedAt: null,
      paidAt: "2026-08-22T00:00:00.000Z", expiresAt: "2026-08-22T01:00:00.000Z",
      createdAt: "2026-08-22T00:00:00.000Z",
    }] : [] } }),
  }));

  await page.goto("/subscriptions");
  const sixMonthPlan = page.locator("article").filter({ has: page.getByRole("heading", { name: "6개월" }) });
  await sixMonthPlan.getByRole("button", { name: "결제하기" }).click();
  await expect(page.getByText(/테스트 결제입니다\. 실제 금액은 청구되지 않습니다/)).toBeVisible();
  await page.getByRole("button", { name: "토스로 50,000원 결제" }).click();

  await expect(page.getByRole("heading", { name: "6개월 이용 중" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "구독 내역" })).toBeVisible();
  await expect(page.getByText("바둑타고 6개월 구독")).toBeVisible();
  await expect(page.getByText("전액 환불")).toBeVisible();
  expect(verified).toBe(true);
  expect(confirmationRequestId).toMatch(/^toss_confirm_/);
});

test("9줄 바둑미션에서 후보 수를 확인한 뒤 서버 판정으로 완료한다", async ({ page }) => {
  const mission = {
    id: "MISSION-E2E-9", version: 1, title: "마지막 백돌 따내기",
    instruction: "백돌의 마지막 활로를 막으세요.", level: "입문", volume: 1, lessonNumber: 1,
    problemGroup: "개념 확인", category: "따내기", difficulty: 1, boardSize: 9,
    playerColor: "black", missionType: "capture", baseScore: 100, timeLimitSeconds: null,
    retryLimit: 3, isFreeSample: true, reward: { id: "mission-star", quantity: 1 }, isFavorite: false,
    initialBlackStones: [{ x: 3, y: 4 }, { x: 4, y: 3 }, { x: 5, y: 4 }],
    initialWhiteStones: [{ x: 4, y: 4 }], hintsAvailable: 1, progress: null,
  };
  const initialBoard = {
    size: 9,
    stones: [
      ...mission.initialBlackStones.map((point) => ({ ...point, color: "black" })),
      ...mission.initialWhiteStones.map((point) => ({ ...point, color: "white" })),
    ],
    previousPositionHash: null,
    lastMove: null,
  };
  const boardHash = "a".repeat(64);
  await page.route(/\/api\/v1\/missions(?:\?.*)?$/, (route) => route.fulfill({
    status: 200, contentType: "application/json", body: JSON.stringify({ data: { items: [mission] } }),
  }));
  await page.route("**/api/v1/missions/MISSION-E2E-9", (route) => route.fulfill({
    status: 200, contentType: "application/json", body: JSON.stringify({ data: { mission, attempt: null } }),
  }));
  await page.route("**/api/v1/missions/MISSION-E2E-9/attempts", (route) => route.fulfill({
    status: 201, contentType: "application/json", body: JSON.stringify({ data: { mission, attempt: {
      id: "attempt-e2e-9", missionId: mission.id, missionVersion: 1, source: "mission_list", status: "in_progress",
      boardState: initialBoard, boardHash, moveCount: 0, wrongMoveCount: 0, attemptCount: 0,
      hintLevel: 0, hintUseCount: 0, score: 0, startedAt: new Date().toISOString(),
      lastPlayedAt: new Date().toISOString(), completedAt: null,
    } } }),
  }));
  await page.route("**/api/v1/mission-attempts/attempt-e2e-9/moves", (route) => route.fulfill({
    status: 201, contentType: "application/json", body: JSON.stringify({ data: {
      result: "correct", reason: null, feedback: "정답입니다.",
      playerMove: { color: "black", x: 4, y: 5, capturedStones: [{ x: 4, y: 4 }] }, opponentMoves: [],
      nextTurn: null, status: "completed", score: 100,
      boardState: {
        ...initialBoard,
        stones: [...initialBoard.stones.filter((stone) => stone.x !== 4 || stone.y !== 4), { color: "black", x: 4, y: 5 }],
        lastMove: { color: "black", x: 4, y: 5 },
        captures: { black: 1, white: 0 },
      },
      boardHash: "b".repeat(64), moveCount: 1, wrongMoveCount: 0, attemptCount: 1,
      explanation: "백돌의 마지막 활로를 막아 따냈습니다.",
      reward: null,
    } }),
  }));

  await page.goto("/missions");
  await expect(page.getByRole("heading", { name: "판 위에서 직접 푸는 바둑미션" })).toBeVisible();
  await page.getByRole("button", { name: "시작하기" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("heading", { name: mission.title })).toBeFocused();
  await dialog.getByRole("button", { name: "문제 시작" }).click();
  await dialog.getByRole("button", { name: "E4 교차점" }).click();
  await expect(dialog.getByText(/E4에 둘 예정/)).toBeVisible();
  await dialog.getByRole("button", { name: "정답 확인" }).click();
  await expect(dialog.getByText("정답입니다.")).toBeVisible();
  await expect(dialog.getByText(/백돌의 마지막 활로를 막아 따냈습니다/)).toBeVisible();
  await expect(dialog.getByText("100")).toBeVisible();
  await expect(dialog.locator(".mission-stats div").filter({ hasText: "흑이 잡은 돌" }).getByText("1")).toBeVisible();
});

test("비회원 무료 바둑미션을 새로고침 후 서버 상태로 이어간다", async ({ page }) => {
  const mission = {
    id: "MISSION-RESUME-E2E-9", version: 1, title: "재접속 활로 문제",
    instruction: "중단한 판을 이어서 두세요.", level: "입문", volume: 1, lessonNumber: 1,
    problemGroup: "반복 훈련", category: "따내기", difficulty: 1, boardSize: 9,
    playerColor: "black", missionType: "capture", baseScore: 100, timeLimitSeconds: null,
    retryLimit: 3, isFreeSample: true, reward: { id: "mission-star", quantity: 1 }, isFavorite: false,
    initialBlackStones: [], initialWhiteStones: [], hintsAvailable: 1, progress: null,
  };
  const attemptId = "00000000-0000-4000-8000-000000000611";
  const attempt = {
    id: attemptId, missionId: mission.id, missionVersion: 1, source: "mission_list", status: "in_progress",
    boardState: { size: 9, stones: [], previousPositionHash: null, lastMove: null }, boardHash: "c".repeat(64),
    moveCount: 0, wrongMoveCount: 1, attemptCount: 1, hintLevel: 0, hintUseCount: 0, score: 90,
    startedAt: new Date().toISOString(), lastPlayedAt: new Date().toISOString(), completedAt: null,
  };
  let started = false;
  let resumedWith: string | null = null;
  await page.route(/\/api\/v1\/missions(?:\?.*)?$/, (route) => route.fulfill({
    status: 200, contentType: "application/json", body: JSON.stringify({ data: { items: [mission] } }),
  }));
  await page.route("**/api/v1/missions/MISSION-RESUME-E2E-9*", (route) => {
    const url = new URL(route.request().url());
    resumedWith = url.searchParams.get("attemptId");
    return route.fulfill({
      status: 200, contentType: "application/json",
      body: JSON.stringify({ data: { mission, attempt: started && resumedWith === attemptId ? attempt : null } }),
    });
  });
  await page.route("**/api/v1/missions/MISSION-RESUME-E2E-9/attempts", (route) => {
    started = true;
    return route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify({ data: { mission, attempt } }) });
  });

  await page.goto("/missions");
  await page.getByRole("button", { name: "시작하기" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "문제 시작" }).click();
  await expect(page.getByRole("dialog").getByText("90")).toBeVisible();

  await page.reload();
  await page.getByRole("button", { name: "시작하기" }).click();
  await expect(page.getByRole("dialog").getByText("재접속이 완료되었습니다.")).toBeVisible();
  await expect(page.getByRole("dialog").locator(".mission-stats div").filter({ hasText: "오답" }).getByText("1")).toBeVisible();
  expect(resumedWith).toBe(attemptId);
});

test("19줄 모바일 확대 상태에서 스크롤과 터치 착수를 구분한다", async ({ browser }) => {
  const context = await browser.newContext({ ...devices["Pixel 7"] });
  const page = await context.newPage();
  const mission = {
    id: "MISSION-E2E-19", version: 1, title: "19줄 중앙 착수",
    instruction: "천원에 착수하세요.", level: "기본", volume: 1, lessonNumber: 1,
    problemGroup: "개념 확인", category: "포석", difficulty: 1, boardSize: 19,
    playerColor: "black", missionType: "best_move", baseScore: 100, timeLimitSeconds: null,
    retryLimit: 3, isFreeSample: true, reward: { id: "mission-star", quantity: 1 }, isFavorite: false,
    initialBlackStones: [], initialWhiteStones: [], hintsAvailable: 0, progress: null,
  };
  const initialBoard = { size: 19, stones: [], previousPositionHash: null, lastMove: null };
  const attempt = {
    id: "attempt-e2e-19", missionId: mission.id, missionVersion: 1, source: "mission_list", status: "in_progress",
    boardState: initialBoard, boardHash: "c".repeat(64), moveCount: 0, wrongMoveCount: 0, attemptCount: 0,
    hintLevel: 0, hintUseCount: 0, score: 0, startedAt: new Date().toISOString(),
    lastPlayedAt: new Date().toISOString(), completedAt: null,
  };

  await page.route(/\/api\/v1\/missions(?:\?.*)?$/, (route) => route.fulfill({
    status: 200, contentType: "application/json", body: JSON.stringify({ data: { items: [mission] } }),
  }));
  await page.route("**/api/v1/missions/MISSION-E2E-19", (route) => route.fulfill({
    status: 200, contentType: "application/json", body: JSON.stringify({ data: { mission, attempt: null } }),
  }));
  await page.route("**/api/v1/missions/MISSION-E2E-19/attempts", (route) => route.fulfill({
    status: 201, contentType: "application/json", body: JSON.stringify({ data: { mission, attempt } }),
  }));

  try {
    await page.goto("http://127.0.0.1:5173/missions");
    await page.getByRole("button", { name: "시작하기" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByRole("button", { name: "문제 시작" }).click();
    const center = dialog.getByRole("button", { name: "K10 교차점" });
    await center.tap();
    await expect(dialog.getByText(/K10에 둘 예정입니다/)).toBeVisible();
    await dialog.getByRole("button", { name: "현재 착수 되돌리기" }).click();
    await expect(dialog.locator(".stone.pending")).toHaveCount(0);
    await dialog.getByRole("button", { name: "＋" }).click();

    const panel = dialog.locator(".mission-board-panel");
    const panelBox = await panel.boundingBox();
    const boardBox = await dialog.getByRole("grid", { name: "19줄 바둑판" }).boundingBox();
    if (!panelBox || !boardBox) throw new Error("mobile board bounds are missing");
    const sizes = await panel.evaluate((element) => ({ clientWidth: element.clientWidth, scrollWidth: element.scrollWidth }));
    expect(sizes.scrollWidth).toBeGreaterThan(sizes.clientWidth);

    const session = await context.newCDPSession(page);
    const startX = Math.round(panelBox.x + panelBox.width * 0.78);
    const endX = Math.round(panelBox.x + panelBox.width * 0.24);
    const y = Math.round(Math.min(boardBox.y + boardBox.height * 0.45, panelBox.y + panelBox.height - 30));
    await session.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: startX, y }] });
    await session.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: endX, y }] });
    await session.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });

    await expect.poll(() => panel.evaluate((element) => element.scrollLeft)).toBeGreaterThan(0);
    await expect(dialog.locator(".stone.pending")).toHaveCount(0);
  } finally {
    await context.close().catch(() => undefined);
  }
});

test("운영자가 바둑문제 통계를 확인하고 기록 없이 수순을 미리본다", async ({ page }) => {
  const mission = {
    id: "MISSION-ADMIN-E2E", version: 2, title: "천원 미리보기", instruction: "중앙에 두세요.",
    status: "published", level: "입문", volume: 1, lessonNumber: 1, problemGroup: "개념 확인",
    category: "포석", difficulty: 1, displayOrder: 1, eraId: null, lessonId: null, textbookPage: null,
    boardSize: 9, ruleset: "japanese_simple_ko", playerColor: "black", missionType: "best_move",
    initialBlackStones: [], initialWhiteStones: [], successCondition: null,
    solutionTree: { rootNodeId: "root", nodes: { root: { actor: "player", acceptedMoves: [{ x: 4, y: 4, result: "correct", nextNodeId: "done" }] }, done: { terminal: "success" } } },
    hints: ["중앙을 찾으세요."], correctExplanation: "정확한 중앙입니다.", feedbacks: { incorrect: "다시 세어 보세요." },
    baseScore: 100, timeLimitSeconds: null, retryLimit: 3, isFreeSample: true,
    reward: { id: "mission-star", quantity: 1 }, rewardId: "mission-star", rewardQuantity: 1,
    scheduledAt: null, publishedAt: new Date().toISOString(),
  };
  const initialBoard = { size: 9, stones: [], previousPositionHash: null, lastMove: null };
  let previewCalls = 0;
  await page.route(/\/api\/v1\/admin\/missions$/, (route) => route.fulfill({
    status: 200, contentType: "application/json", body: JSON.stringify({ data: { items: [mission] } }),
  }));
  await page.route("**/api/v1/admin/missions/MISSION-ADMIN-E2E/statistics", (route) => route.fulfill({
    status: 200, contentType: "application/json", body: JSON.stringify({ data: {
      mission: { id: mission.id, title: mission.title, version: 2, boardSize: 9 },
      summary: {
        totalAttempts: 10, uniqueLearners: 8, inProgress: 2, completed: 5, failed: 3,
        completionRate: 50, averageScore: 88, averageWrongMoves: 0.8, averageHintUses: 0.4,
        averageSolveSeconds: 24.5, submittedMoves: 18,
      },
      resultCounts: { correct: 5, acceptable: 0, incorrect: 4, forbidden: 1, illegal: 2, timeout: 1 },
      generatedAt: new Date().toISOString(),
    } }),
  }));
  await page.route("**/api/v1/admin/missions/MISSION-ADMIN-E2E/preview", async (route) => {
    previewCalls += 1;
    const moves = (route.request().postDataJSON() as { moves: Array<{ x: number; y: number }> }).moves;
    const completed = moves.length > 0;
    return route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify({ data: { preview: {
      missionId: mission.id, missionVersion: 2, status: completed ? "completed" : "in_progress",
      currentNodeId: completed ? "done" : "root",
      boardState: completed ? { ...initialBoard, stones: [{ x: 4, y: 4, color: "black" }], lastMove: { x: 4, y: 4, color: "black" } } : initialBoard,
      boardHash: (completed ? "b" : "a").repeat(64), moveCount: completed ? 1 : 0, wrongMoveCount: 0, score: 100,
      steps: completed ? [{ number: 1, point: moves[0], result: "correct", reason: null, feedback: "정답입니다.", opponentMoves: [], status: "completed" }] : [],
      explanation: completed ? mission.correctExplanation : null, persisted: false,
    } } }) });
  });

  await page.goto("/admin/missions");
  await page.getByRole("button", { name: /천원 미리보기/ }).click();
  await expect(page.getByRole("region", { name: "선택 문제 통계" }).getByText("50%")).toBeVisible();
  await page.getByRole("button", { name: "기록 없는 미리보기" }).click();
  const preview = page.getByRole("region", { name: "기록 없는 문제 미리보기" });
  await preview.getByRole("button", { name: "E5 교차점" }).click();
  await expect(preview.getByText("미션 성공")).toBeVisible();
  await expect(preview.getByText("정답입니다.")).toBeVisible();
  expect(previewCalls).toBe(2);
});

test("운영자가 교재자료 파일을 안전 검사 후 서버 게시판에 등록한다", async ({ page }) => {
  await page.route("**/config.js", (route) => route.fulfill({
    status: 200,
    contentType: "application/javascript",
    body: "window.APP_CONFIG=Object.freeze({apiBaseUrl:'/api/v1',boardApiEnabled:true,demoRoleSwitcher:false});",
  }));
  await page.route("**/api/v1/me", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ data: { user: {
      id: "material-operator-e2e", displayName: "교재 운영자", email: "operator@example.test",
      emailVerified: true, roles: ["operator"],
    } } }),
  }));

  const assetId = "00000000-0000-4000-8000-000000000731";
  let submitted: Record<string, unknown> | undefined;
  let updated: Record<string, unknown> | undefined;
  let restoredRevision: number | undefined;
  const materials: Array<Record<string, unknown>> = [];
  await page.route("**/api/v1/teaching-material-assets/uploads", async (route) => {
    expect(route.request().postDataJSON()).toEqual({
      fileName: "lesson-resource.pdf", contentType: "application/pdf", size: 17,
    });
    await route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify({ data: {
      asset: { id: assetId, status: "quarantined" },
      upload: { method: "POST", url: "https://storage.example.test/material-upload", fields: { key: "material.pdf" } },
    } }) });
  });
  await page.route("https://storage.example.test/material-upload", (route) => route.fulfill({ status: 204, body: "" }));
  await page.route(`**/api/v1/teaching-material-assets/${assetId}/complete`, (route) => route.fulfill({
    status: 201, contentType: "application/json", body: JSON.stringify({ data: {
      id: assetId, originalName: "lesson-resource.pdf", contentType: "application/pdf", size: 17, status: "ready",
    } }),
  }));
  await page.route("**/api/v1/admin/materials", async (route) => {
    if (route.request().method() === "POST") {
      submitted = route.request().postDataJSON() as Record<string, unknown>;
      materials.unshift({
        id: "material-e2e", ...submitted, authorLabel: "운영팀", status: "published",
        revision: 1,
        publishedAt: "2026-08-24T00:00:00.000Z",
        attachment: {
          kind: "material", originalName: "lesson-resource.pdf", contentType: "application/pdf", size: 17,
          status: "ready", canDownload: true, downloadUrl: "/api/v1/materials/material-e2e/download",
        },
      });
      await route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify({ data: { item: materials[0] } }) });
      return;
    }
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ data: { items: materials } }) });
  });
  await page.route("**/api/v1/admin/materials/material-e2e", async (route) => {
    expect(route.request().method()).toBe("PATCH");
    updated = route.request().postDataJSON() as Record<string, unknown>;
    materials[0] = { ...materials[0], ...updated, revision: 2 };
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ data: { item: materials[0] } }) });
  });
  await page.route("**/api/v1/admin/materials/material-e2e/revisions", (route) => route.fulfill({
    status: 200, contentType: "application/json", body: JSON.stringify({ data: { items: [{
      id: "material-revision-e2e", revision: 1, createdAt: "2026-08-24T01:00:00.000Z",
      changedByLabel: "교재 운영자",
      changesToNext: { changedFields: ["title"], assetChange: null },
      snapshot: { title: "E2E lesson resource", asset: { id: assetId, originalName: "lesson-resource.pdf" } },
    }] } }),
  }));
  await page.route("**/api/v1/admin/materials/material-e2e/revisions/1/restore", async (route) => {
    expect(route.request().method()).toBe("POST");
    restoredRevision = 1;
    materials[0] = { ...materials[0], title: "E2E lesson resource", revision: 3 };
    await route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify({ data: { item: materials[0] } }) });
  });

  await page.goto("/board.html?type=resource");
  await page.locator("#writeButton").click();
  const form = page.locator("#boardWriteForm");
  await form.locator('[name="category"]').selectOption({ index: 1 });
  await form.locator('[name="title"]').fill("E2E lesson resource");
  await form.locator('[name="lessonId"]').fill("PRE-01");
  await form.locator('[name="version"]').fill("1.0");
  await form.locator('[name="accessLevel"]').selectOption({ index: 1 });
  await form.locator('[name="content"]').fill("E2E resource description");
  await form.locator('[name="attachment"]').setInputFiles({
    name: "lesson-resource.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.7 resource"),
  });
  await form.locator('button[type="submit"]').click();

  await expect(page.getByText("E2E lesson resource")).toBeVisible();
  expect(submitted).toEqual(expect.objectContaining({
    title: "E2E lesson resource", lessonId: "PRE-01", version: "1.0", assetId,
  }));
  expect(submitted).not.toHaveProperty("attachment");
  await page.getByRole("button", { name: /E2E lesson resource/ }).click();
  await expect(page.locator("#detailAttachments a")).toHaveAttribute("href", /\/api\/v1\/materials\/material-e2e\/download$/);
  await page.locator("#detailModerationActions").getByRole("button", { name: "수정" }).click();
  await expect(form.locator('[name="attachment"]')).not.toHaveAttribute("required", "");
  await form.locator('[name="title"]').fill("E2E revised resource");
  await form.locator('button[type="submit"]').click();
  await expect(page.getByText("E2E revised resource")).toBeVisible();
  expect(updated).toEqual(expect.objectContaining({ title: "E2E revised resource", lessonId: "PRE-01" }));
  expect(updated).not.toHaveProperty("assetId");
  await page.getByRole("button", { name: /E2E revised resource/ }).click();
  await page.locator("#detailModerationActions").getByRole("button", { name: "수정 이력" }).click();
  await expect(page.locator("#detailRevisionHistory")).toContainText("버전 1");
  await expect(page.locator("#detailRevisionHistory")).toContainText("다음 버전에서 변경: 자료명");
  await expect(page.locator("#detailRevisionHistory")).toContainText("교재 운영자 변경");
  page.once("dialog", dialog => dialog.accept());
  await page.getByRole("button", { name: "이 버전 복원" }).click();
  await expect(page.getByRole("button", { name: /E2E lesson resource/ })).toBeVisible();
  expect(restoredRevision).toBe(1);
});

test("운영자가 연결 강의 영상과 6종 안전 자산으로 지도자 수업 패키지를 등록한다", async ({ page }) => {
  await page.route("**/config.js", (route) => route.fulfill({
    status: 200, contentType: "application/javascript",
    body: "window.APP_CONFIG=Object.freeze({apiBaseUrl:'/api/v1',boardApiEnabled:true,demoRoleSwitcher:false});",
  }));
  await page.route("**/api/v1/me", (route) => route.fulfill({
    status: 200, contentType: "application/json", body: JSON.stringify({ data: { user: {
      id: "class-helper-operator-e2e", displayName: "수업 운영자", email: "operator@example.test",
      emailVerified: true, roles: ["operator"],
    } } }),
  }));
  const fields = ["projectorPpt", "activityPdf", "historyQuizFile", "problemMissionFile", "answerFile", "teacherGuideFile"];
  const assetIds = Object.fromEntries(fields.map((field, index) => [field, `00000000-0000-4000-8000-${String(800 + index).padStart(12, "0")}`]));
  await page.route("**/api/v1/class-helper-assets/uploads", async (route) => {
    const body = route.request().postDataJSON() as { kind: string; fileName: string; contentType: string; size: number };
    expect(fields).toContain(body.kind);
    const id = assetIds[body.kind] as string;
    await route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify({ data: {
      asset: { id, kind: body.kind, status: "quarantined" },
      upload: { method: "POST", url: `https://storage.example.test/class-helper-${body.kind}`, fields: { key: body.fileName } },
    } }) });
  });
  await page.route("https://storage.example.test/class-helper-*", (route) => route.fulfill({ status: 204, body: "" }));
  for (const [field, id] of Object.entries(assetIds)) {
    await page.route(`**/api/v1/class-helper-assets/${id}/complete`, (route) => route.fulfill({
      status: 201, contentType: "application/json", body: JSON.stringify({ data: {
        id, kind: field, originalName: `${field}.pdf`, contentType: "application/pdf", size: 17, status: "ready",
      } }),
    }));
  }
  let submitted: Record<string, any> | undefined;
  let updated: Record<string, any> | undefined;
  const helpers: Array<Record<string, any>> = [];
  await page.route("**/api/v1/admin/class-helpers", async (route) => {
    if (route.request().method() === "POST") {
      submitted = route.request().postDataJSON() as Record<string, any>;
      const helper: Record<string, any> = {
        id: "class-helper-e2e", ...submitted, status: "published", authorLabel: "운영팀",
        revision: 1,
        publishedAt: "2026-08-24T00:00:00.000Z",
        lessonVideo: { kind: "video", originalName: "연결 강의 영상", appUrl: "/lessons/PRE-01" },
        missionUrl: "/missions?lessonId=PRE-01&missionId=MISSION-PRE-01-01",
      };
      fields.forEach((field) => { helper[field] = {
        kind: "material", originalName: `${field}.pdf`, status: "ready",
        downloadUrl: `/api/v1/class-helpers/class-helper-e2e/assets/${field}`,
      }; });
      helpers.unshift(helper);
      await route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify({ data: { item: helper } }) });
      return;
    }
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ data: { items: helpers } }) });
  });
  await page.route("**/api/v1/admin/class-helpers/class-helper-e2e", async (route) => {
    expect(route.request().method()).toBe("PATCH");
    updated = route.request().postDataJSON() as Record<string, any>;
    helpers[0] = { ...helpers[0], ...updated, revision: 2 };
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ data: { item: helpers[0] } }) });
  });

  await page.goto("/board.html?type=classHelper");
  await page.locator("#writeButton").click();
  const form = page.locator("#boardWriteForm");
  await form.locator('[name="category"]').selectOption({ index: 1 });
  await form.locator('[name="title"]').fill("E2E classroom package");
  await form.locator('[name="lessonId"]').fill("PRE-01");
  await form.locator('[name="badukMissionId"]').fill("MISSION-PRE-01-01");
  await form.locator('[name="targetGrade"]').selectOption({ index: 2 });
  await form.locator('[name="lessonDuration"]').fill("25~30분");
  for (const field of ["content", "introductionContent", "conceptContent", "problemContent", "quizContent", "wrapUpContent"]) {
    await form.locator(`[name="${field}"]`).fill(`${field} E2E 설명`);
  }
  await expect(form.locator(".dynamic-field-guide")).toContainText("연결 강의");
  await form.locator('[name="projectorPpt"]').setInputFiles({
    name: "projector.pptx", mimeType: "application/vnd.openxmlformats-officedocument.presentationml.presentation", buffer: Buffer.from("pptx"),
  });
  for (const field of fields.slice(1)) {
    await form.locator(`[name="${field}"]`).setInputFiles({
      name: `${field}.pdf`, mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.7 resource"),
    });
  }
  await form.locator('button[type="submit"]').click();

  await expect(page.getByRole("button", { name: /E2E classroom package/ })).toBeVisible();
  expect(submitted?.assetIds).toEqual(assetIds);
  expect(submitted).not.toHaveProperty("lessonVideo");
  for (const field of fields) expect(submitted).not.toHaveProperty(field);
  await page.getByRole("button", { name: /E2E classroom package/ }).click();
  await expect(page.locator("#detailAttachments a")).toHaveCount(7);
  await expect(page.getByRole("link", { name: "바둑미션 게임 실행" })).toHaveAttribute("href", /missionId=MISSION-PRE-01-01/);
  await page.locator("#detailModerationActions").getByRole("button", { name: "수정" }).click();
  for (const field of fields) await expect(form.locator(`[name="${field}"]`)).not.toHaveAttribute("required", "");
  await form.locator('[name="lessonDuration"]').fill("30분");
  await form.locator('button[type="submit"]').click();
  await expect(page.getByRole("button", { name: /E2E classroom package/ })).toBeVisible();
  expect(updated).toEqual(expect.objectContaining({ lessonDuration: "30분" }));
  expect(updated).not.toHaveProperty("assetIds");
});
