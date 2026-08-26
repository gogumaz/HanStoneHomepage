import { randomUUID } from "node:crypto";
import pg from "pg";

const databaseUrl = process.env.DATABASE_URL?.trim();
if (!databaseUrl) {
  process.stderr.write("DATABASE_URL is required for the database integration smoke test.\n");
  process.exit(1);
}

const REQUIRED_MIGRATION = "20260824002300_account_mail_outbox";
const { Client } = pg;
const client = new Client({ connectionString: databaseUrl });
let transactionStarted = false;

try {
  await client.connect();
  const migration = await client.query(
    `SELECT "migration_name"
     FROM "_prisma_migrations"
     WHERE "migration_name" = $1
       AND "finished_at" IS NOT NULL
       AND "rolled_back_at" IS NULL`,
    [REQUIRED_MIGRATION],
  );
  if (migration.rowCount !== 1) {
    throw new Error("DATABASE_MIGRATION_REQUIRED");
  }

  const mission = await client.query(
    `SELECT "id", "version", "rewardId", "rewardQuantity"
     FROM "BadukMission"
     WHERE "status" = 'PUBLISHED'
     ORDER BY "id"
     LIMIT 1`,
  );
  if (mission.rowCount !== 1) throw new Error("PUBLISHED_MISSION_REQUIRED");

  const reward = await client.query(
    `SELECT "id", "type", "title"
     FROM "Reward"
     WHERE "id" = $1 AND "active" = true`,
    [mission.rows[0].rewardId],
  );
  if (reward.rowCount !== 1) throw new Error("ACTIVE_REWARD_REQUIRED");

  const lesson = await client.query(
    `SELECT "id" FROM "Lesson" WHERE "status" = 'PUBLISHED' ORDER BY "id" LIMIT 1`,
  );
  if (lesson.rowCount !== 1) throw new Error("PUBLISHED_LESSON_REQUIRED");

  const userId = randomUUID();
  const oauthAttemptId = randomUUID();
  const missionAttemptId = randomUUID();
  const consultationId = randomUUID();
  const inquiryId = randomUUID();
  const inquiryNotificationId = randomUUID();
  const accountTokenId = randomUUID();
  const accountMailJobId = randomUUID();
  const userNotificationId = randomUUID();
  const inquiryAttachmentId = randomUUID();
  const editorialContentId = randomUUID();
  const communityPostId = randomUUID();
  const communityReportId = randomUUID();
  const communityAttachmentId = randomUUID();
  const teachingMaterialId = randomUUID();
  const teachingMaterialAssetId = randomUUID();
  const teachingMaterialRevisionId = randomUUID();
  const classHelperId = randomUUID();
  const classHelperRevisionId = randomUUID();
  const injectionProbe = `' OR 1=1; DROP TABLE "User"; --`;

  await client.query("BEGIN");
  transactionStarted = true;
  await client.query(
    `INSERT INTO "User" ("id", "displayName", "updatedAt")
     VALUES ($1, $2, CURRENT_TIMESTAMP)`,
    [userId, injectionProbe],
  );
  const injectionLookup = await client.query(
    `SELECT "id" FROM "User" WHERE "displayName" = $1`,
    [injectionProbe],
  );
  const injectionMiss = await client.query(
    `SELECT COUNT(*)::int AS "count" FROM "User" WHERE "displayName" = $1`,
    [`' OR 1=1 --`],
  );
  if (injectionLookup.rowCount !== 1 || injectionLookup.rows[0].id !== userId
    || injectionMiss.rows[0].count !== 0) {
    throw new Error("DATABASE_PARAMETERIZATION_FAILED");
  }
  await client.query(
    `INSERT INTO "AccountToken" ("id", "userId", "purpose", "tokenHash", "expiresAt")
     VALUES ($1, $2, 'EMAIL_VERIFICATION', $3, CURRENT_TIMESTAMP + INTERVAL '1 day')`,
    [accountTokenId, userId, `database-smoke-${accountTokenId}`],
  );
  await client.query(
    `INSERT INTO "AccountMailJob" ("id", "tokenId", "kind", "encryptedToken", "updatedAt")
     VALUES ($1, $2, 'EMAIL_VERIFICATION', $3, CURRENT_TIMESTAMP)`,
    [accountMailJobId, accountTokenId, "v1.database-smoke.encrypted.payload"],
  );
  await client.query(
    `INSERT INTO "OAuthAccount"
       ("id", "userId", "provider", "providerUserId", "email", "updatedAt")
     VALUES ($1, $2, $3, $4, $5, CURRENT_TIMESTAMP)`,
    [randomUUID(), userId, "database-smoke", randomUUID(), "database-smoke@example.test"],
  );
  await client.query(
    `INSERT INTO "EditorialContent"
       ("id", "type", "category", "title", "content", "status", "isPinned", "publishedAt", "createdById", "updatedById", "updatedAt")
     VALUES ($1, 'NOTICE', '서비스', $2, $3, 'PUBLISHED', true, CURRENT_TIMESTAMP, $4, $4, CURRENT_TIMESTAMP)`,
    [editorialContentId, "통합 테스트 공지", "통합 테스트 공지 내용입니다.", userId],
  );
  await client.query(
    `INSERT INTO "CommunityPost"
       ("id", "type", "authorUserId", "category", "title", "content", "targetGrade", "era", "badukLevel", "status", "reviewedById", "reviewedAt", "publishedAt", "updatedAt")
     VALUES ($1, 'CLASS_TIP', $2, '바둑활동', $3, $4, '초등 3~4학년', '선사시대', '입문', 'PUBLISHED', $2, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
    [communityPostId, userId, "통합 테스트 수업 팁", "통합 테스트 수업 팁 내용입니다."],
  );
  await client.query(
    `INSERT INTO "CommunityPostReport"
       ("id", "postId", "reporterUserId", "reason", "detail", "updatedAt")
     VALUES ($1, $2, $3, 'OTHER', $4, CURRENT_TIMESTAMP)`,
    [communityReportId, communityPostId, userId, "database smoke community report"],
  );
  await client.query(
    `INSERT INTO "CommunityAttachment"
       ("id", "ownerUserId", "postId", "kind", "objectKey", "originalName", "contentType", "size", "status", "scanProvider", "scanResult", "scannedAt", "updatedAt")
     VALUES ($1, $2, $3, 'MATERIAL', $4, $5, 'application/pdf', 128, 'READY', 'clamav', 'OK', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
    [communityAttachmentId, userId, communityPostId, `community-attachments/${communityAttachmentId}/source.pdf`, "database-smoke.pdf"],
  );
  await client.query(
    `INSERT INTO "TeachingMaterial"
       ("id", "category", "title", "content", "lessonId", "version", "accessLevel", "status", "publishedAt", "createdById", "updatedById", "updatedAt")
     VALUES ($1, '활동지', $2, $3, $4, '1.0', 'SUBSCRIBER', 'PUBLISHED', CURRENT_TIMESTAMP, $5, $5, CURRENT_TIMESTAMP)`,
    [teachingMaterialId, "통합 테스트 교재자료", "통합 테스트 교재자료 내용입니다.", lesson.rows[0].id, userId],
  );
  await client.query(
    `INSERT INTO "TeachingMaterialAsset"
       ("id", "ownerUserId", "materialId", "objectKey", "originalName", "contentType", "size", "status", "scanProvider", "scanResult", "scannedAt", "updatedAt")
     VALUES ($1, $2, $3, $4, $5, 'application/pdf', 128, 'READY', 'clamav', 'OK', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
    [teachingMaterialAssetId, userId, teachingMaterialId, `teaching-material-assets/${teachingMaterialAssetId}/source.pdf`, "database-smoke-material.pdf"],
  );
  await client.query(
    `INSERT INTO "ClassHelper"
       ("id", "category", "title", "lessonId", "badukMissionId", "targetGrade", "lessonDuration", "content", "introductionContent", "conceptContent", "problemContent", "quizContent", "wrapUpContent", "status", "publishedAt", "createdById", "updatedById", "updatedAt")
     VALUES ($1, '선사시대', $2, $3, $4, '초등 3~4학년', '25~30분', $5, $6, $7, $8, $9, $10, 'PUBLISHED', CURRENT_TIMESTAMP, $11, $11, CURRENT_TIMESTAMP)`,
    [classHelperId, "통합 테스트 수업 패키지", lesson.rows[0].id, mission.rows[0].id, "수업 목표", "도입", "개념", "문제풀이", "퀴즈", "마무리", userId],
  );
  const classHelperAssetKinds = ["PROJECTOR_PPT", "ACTIVITY_PDF", "HISTORY_QUIZ", "PROBLEM_MISSION", "ANSWER", "TEACHER_GUIDE"];
  for (const kind of classHelperAssetKinds) {
    const assetId = randomUUID();
    await client.query(
      `INSERT INTO "ClassHelperAsset"
         ("id", "ownerUserId", "classHelperId", "kind", "objectKey", "originalName", "contentType", "size", "status", "scanProvider", "scanResult", "scannedAt", "updatedAt")
       VALUES ($1, $2, $3, $4::"ClassHelperAssetKind", $5, $6, 'application/pdf', 128, 'READY', 'clamav', 'OK', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
      [assetId, userId, classHelperId, kind, `class-helper-assets/${assetId}/source.pdf`, `${kind.toLowerCase()}.pdf`],
    );
  }
  await client.query(
    `INSERT INTO "TeachingMaterialRevision"
       ("id", "materialId", "revision", "snapshot", "changedById")
     VALUES ($1, $2, 1, $3::jsonb, $4)`,
    [teachingMaterialRevisionId, teachingMaterialId, JSON.stringify({ title: "통합 테스트 교재자료", asset: { id: teachingMaterialAssetId } }), userId],
  );
  await client.query(
    `INSERT INTO "ClassHelperRevision"
       ("id", "classHelperId", "revision", "snapshot", "changedById")
     VALUES ($1, $2, 1, $3::jsonb, $4)`,
    [classHelperRevisionId, classHelperId, JSON.stringify({ title: "통합 테스트 수업 패키지", assets: [] }), userId],
  );
  await client.query(
    `INSERT INTO "OAuthLoginAttempt"
       ("id", "provider", "purpose", "userId", "stateHash", "nonce", "codeVerifier", "returnTo", "expiresAt")
     VALUES ($1, $2, 'LINK', $3, $4, $5, $6, $7, CURRENT_TIMESTAMP + INTERVAL '5 minutes')`,
    [oauthAttemptId, "database-smoke", userId, randomUUID(), randomUUID(), randomUUID(), "/account"],
  );
  await client.query(
    `INSERT INTO "MissionAttempt"
       ("id", "missionId", "missionVersion", "userId", "source", "currentNodeId",
        "missionSnapshot", "boardState", "boardHash")
     VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb, $9)`,
    [
      missionAttemptId,
      mission.rows[0].id,
      mission.rows[0].version,
      userId,
      "database_smoke",
      "root",
      JSON.stringify({ source: "database-smoke" }),
      JSON.stringify({ black: [], white: [] }),
      "0".repeat(64),
    ],
  );
  await client.query(
    `INSERT INTO "MissionFavorite" ("id", "userId", "missionId") VALUES ($1, $2, $3)`,
    [randomUUID(), userId, mission.rows[0].id],
  );
  await client.query(
    `INSERT INTO "RewardGrant"
       ("id", "userId", "rewardId", "missionId", "attemptId", "rewardTypeSnapshot",
        "rewardTitleSnapshot", "quantity")
     VALUES ($1, $2, $3, $4, $5, $6::"RewardType", $7, $8)`,
    [
      randomUUID(),
      userId,
      reward.rows[0].id,
      mission.rows[0].id,
      missionAttemptId,
      reward.rows[0].type,
      reward.rows[0].title,
      mission.rows[0].rewardQuantity,
    ],
  );
  await client.query(
    `INSERT INTO "Consultation"
       ("id", "requesterUserId", "category", "organizationName", "contactName", "phone",
        "email", "expectedStudents", "title", "content", "privacyConsentVersion", "privacyConsentedAt", "updatedAt")
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
    [
      consultationId,
      userId,
      "학교",
      "통합 테스트 학교",
      "테스트 담당자",
      "010-1234-5678",
      "consultation@example.test",
      30,
      "도입 상담 요청",
      "통합 테스트 상담 요청 내용입니다.",
      "consultation-privacy-v1",
    ],
  );
  await client.query(
    `INSERT INTO "Inquiry"
       ("id", "requesterUserId", "category", "title", "content", "status", "answer",
        "answeredById", "answeredAt", "answerVersion", "updatedAt")
     VALUES ($1, $2, $3, $4, $5, 'ANSWERED', $6, $2, CURRENT_TIMESTAMP, 1, CURRENT_TIMESTAMP)`,
    [inquiryId, userId, "학습", "통합 테스트 문의", "통합 테스트 문의 내용입니다.", "통합 테스트 답변입니다."],
  );
  await client.query(
    `INSERT INTO "InquiryNotificationJob"
       ("id", "inquiryId", "recipientUserId", "requestedById", "answerVersion", "updatedAt")
     VALUES ($1, $2, $3, $3, 1, CURRENT_TIMESTAMP)`,
    [inquiryNotificationId, inquiryId, userId],
  );
  await client.query(
    `INSERT INTO "UserNotification"
       ("id", "userId", "kind", "resourceType", "resourceId", "resourceVersion", "title", "message")
     VALUES ($1, $2, 'INQUIRY_ANSWERED', 'Inquiry', $3, 1, $4, $5)`,
    [userNotificationId, userId, inquiryId, "문의 답변 등록", "문의함에서 답변을 확인해 주세요."],
  );
  await client.query(
    `INSERT INTO "InquiryAttachment"
       ("id", "ownerUserId", "inquiryId", "objectKey", "originalName", "contentType", "size", "status", "scanProvider", "scanResult", "scannedAt", "updatedAt")
     VALUES ($1, $2, $3, $4, $5, 'application/pdf', 24, 'READY', 'clamav', 'OK', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
    [inquiryAttachmentId, userId, inquiryId, `inquiry-attachments/${inquiryAttachmentId}/source.pdf`, "database-smoke.pdf"],
  );

  const verified = await client.query(
    `SELECT
       EXISTS (SELECT 1 FROM "OAuthLoginAttempt" WHERE "id" = $1 AND "purpose" = 'LINK') AS "oauth",
       EXISTS (SELECT 1 FROM "MissionFavorite" WHERE "userId" = $2 AND "missionId" = $3) AS "favorite",
       EXISTS (SELECT 1 FROM "RewardGrant" WHERE "attemptId" = $4) AS "reward",
       EXISTS (SELECT 1 FROM "Consultation" WHERE "id" = $5 AND "privacyConsentVersion" = 'consultation-privacy-v1') AS "consultation",
       EXISTS (SELECT 1 FROM "Inquiry" WHERE "id" = $6 AND "requesterUserId" = $2) AS "inquiry",
       EXISTS (SELECT 1 FROM "InquiryNotificationJob" WHERE "id" = $7 AND "answerVersion" = 1) AS "notification",
       EXISTS (SELECT 1 FROM "UserNotification" WHERE "id" = $8 AND "readAt" IS NULL) AS "userNotification",
       EXISTS (SELECT 1 FROM "InquiryAttachment" WHERE "id" = $9 AND "ownerUserId" = $2 AND "inquiryId" = $6 AND "status" = 'READY') AS "inquiryAttachment",
       EXISTS (SELECT 1 FROM "EditorialContent" WHERE "id" = $10 AND "type" = 'NOTICE' AND "status" = 'PUBLISHED' AND "createdById" = $2) AS "editorialContent",
       EXISTS (SELECT 1 FROM "CommunityPost" WHERE "id" = $11 AND "type" = 'CLASS_TIP' AND "status" = 'PUBLISHED' AND "authorUserId" = $2) AS "communityPost",
       EXISTS (SELECT 1 FROM "CommunityPostReport" WHERE "id" = $12 AND "postId" = $11 AND "reporterUserId" = $2 AND "status" = 'OPEN') AS "communityReport",
       EXISTS (SELECT 1 FROM "CommunityAttachment" WHERE "id" = $13 AND "postId" = $11 AND "ownerUserId" = $2 AND "status" = 'READY') AS "communityAttachment",
       EXISTS (SELECT 1 FROM "TeachingMaterial" WHERE "id" = $14 AND "lessonId" = $15 AND "accessLevel" = 'SUBSCRIBER' AND "status" = 'PUBLISHED') AS "teachingMaterial",
       EXISTS (SELECT 1 FROM "TeachingMaterialAsset" WHERE "id" = $16 AND "materialId" = $14 AND "ownerUserId" = $2 AND "status" = 'READY') AS "teachingMaterialAsset",
       EXISTS (SELECT 1 FROM "ClassHelper" WHERE "id" = $17 AND "lessonId" = $15 AND "badukMissionId" = $3 AND "status" = 'PUBLISHED') AS "classHelper",
       ((SELECT COUNT(*) FROM "ClassHelperAsset" WHERE "classHelperId" = $17 AND "ownerUserId" = $2 AND "status" = 'READY') = 6) AS "classHelperAssets",
       EXISTS (SELECT 1 FROM "AccountToken" WHERE "id" = $18 AND "userId" = $2) AS "accountToken",
       EXISTS (SELECT 1 FROM "AccountMailJob" WHERE "id" = $19 AND "tokenId" = $18 AND "status" = 'PENDING') AS "accountMailJob"`,
    [oauthAttemptId, userId, mission.rows[0].id, missionAttemptId, consultationId, inquiryId, inquiryNotificationId, userNotificationId, inquiryAttachmentId, editorialContentId, communityPostId, communityReportId, communityAttachmentId, teachingMaterialId, lesson.rows[0].id, teachingMaterialAssetId, classHelperId, accountTokenId, accountMailJobId],
  );
  const result = verified.rows[0];
  if (!result.oauth || !result.favorite || !result.reward || !result.consultation || !result.inquiry || !result.notification || !result.userNotification || !result.inquiryAttachment || !result.editorialContent || !result.communityPost || !result.communityReport || !result.communityAttachment || !result.teachingMaterial || !result.teachingMaterialAsset || !result.classHelper || !result.classHelperAssets || !result.accountToken || !result.accountMailJob) {
    throw new Error("DATABASE_RELATION_VERIFICATION_FAILED");
  }
  const revisions = await client.query(
    `SELECT
       EXISTS (SELECT 1 FROM "TeachingMaterialRevision" WHERE "id" = $1 AND "materialId" = $2 AND "revision" = 1) AS "teachingMaterialRevision",
       EXISTS (SELECT 1 FROM "ClassHelperRevision" WHERE "id" = $3 AND "classHelperId" = $4 AND "revision" = 1) AS "classHelperRevision"`,
    [teachingMaterialRevisionId, teachingMaterialId, classHelperRevisionId, classHelperId],
  );
  if (!revisions.rows[0].teachingMaterialRevision || !revisions.rows[0].classHelperRevision) {
    throw new Error("DATABASE_REVISION_VERIFICATION_FAILED");
  }

  await client.query("ROLLBACK");
  transactionStarted = false;
  const residual = await client.query(
    `SELECT EXISTS (SELECT 1 FROM "User" WHERE "id" = $1) AS "exists"`,
    [userId],
  );
  if (residual.rows[0].exists) throw new Error("DATABASE_SMOKE_ROLLBACK_FAILED");

  process.stdout.write(`${JSON.stringify({
    ok: true,
    migration: REQUIRED_MIGRATION,
    checks: ["sql-parameterization", "oauth-link", "mission-attempt", "mission-favorite", "reward-grant", "consultation-consent", "private-inquiry", "inquiry-notification-outbox", "user-notification", "inquiry-attachment", "editorial-content", "community-post", "community-report", "community-attachment", "teaching-material", "teaching-material-asset", "teaching-material-revision", "class-helper", "class-helper-assets", "class-helper-revision"],
    mutation: "rolled-back",
  })}\n`);
} catch (error) {
  const detail = error instanceof Error ? error.message : "DATABASE_INTEGRATION_SMOKE_FAILED";
  process.stderr.write(`${JSON.stringify({ ok: false, detail })}\n`);
  process.exitCode = 1;
} finally {
  if (transactionStarted) {
    await client.query("ROLLBACK").catch(() => undefined);
  }
  await client.end().catch(() => undefined);
}
