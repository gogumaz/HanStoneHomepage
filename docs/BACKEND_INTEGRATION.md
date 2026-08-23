# 백엔드 연동 가이드

## 1. 목적

현재 데모 UI를 실제 회원, 학습 진도, 교재, 상담 서비스와 연결하기 위한 계약 초안입니다. API는 Node.js 24 LTS·NestJS·PostgreSQL·Prisma로 구현하고 엔드포인트와 필드명은 OpenAPI 문서로 관리합니다.

## 2. API 공통 규칙

- 기본 경로 예시: `/api/v1`
- 데이터 형식: `application/json; charset=utf-8`
- 날짜와 시간: ISO 8601 UTC 저장, 사용자 화면에서 한국 시간으로 표시
- ID: 외부 노출에 안전한 UUID 또는 불투명 문자열
- 페이지 목록: 커서 기반 페이지네이션 권장
- 오류 응답에 내부 스택과 DB 정보를 포함하지 않음

### 성공 응답 예시

```json
{
  "data": {
    "id": "lesson_01HXYZ",
    "title": "주변을 먼저 살펴봐!"
  }
}
```

### 오류 응답 예시

```json
{
  "error": {
    "code": "LESSON_LOCKED",
    "message": "선행 강의를 먼저 완료해 주세요.",
    "requestId": "req_01HXYZ"
  }
}
```

## 3. 인증과 계정

### 현재 구현 상태

| 상태 | 엔드포인트·기반 |
|---|---|
| 구현됨 | `POST /auth/signup`, `POST /auth/login`, `POST /auth/logout`, `POST /auth/refresh`, `GET /me` |
| 구현됨 | 이메일 인증 요청·확인과 비밀번호 재설정 요청·확인, 일회용 만료 토큰, 재설정 시 전체 세션 폐기 |
| 구현됨 | 공급자 중립 SMTP 이메일 발송, TLS·인증 설정 검증, 인증·재설정 HTML/텍스트 템플릿, 발송 결과 감사로그 |
| 구현됨 | CBD OAuth 컴포넌트, 네이버·카카오 프로필 변환, Google OIDC 검증, state·nonce·PKCE·일회용 콜백과 세션 발급 |
| 구현됨 | CBD 결제 계약과 PortOne V1 어댑터, 구독 도메인의 공급자 토큰 주입 및 오류 경계 분리 |
| 구현됨 | scrypt 비밀번호 해시, DB에는 SHA-256 세션 토큰 해시만 저장, HttpOnly·SameSite 세션 쿠키 |
| 구현됨 | 학생·보호자 공개 가입 제한, 역할 메타데이터·서버 역할 가드, 감사로그 기록 |
| 구현됨 | `{ data }` 성공 응답, `{ error: { code, message, requestId } }` 오류 응답, `x-request-id` 헤더 |
| 구현됨 | 보호자 초대 생성·조회·동의 수락·연결 학생 목록·연결 해제, 동의 버전·범위·확인방법·철회 이력 |
| 구현됨 | 활성 연결과 현재 동의 범위를 재검증하는 보호자용 학생 강의·단계 진도 리포트와 조회 감사로그 |
| 다음 구현 | OAuth 운영 앱 심사·실연동, 기존 계정의 명시적 소셜 계정 연결·해제 UI |

### 제안 엔드포인트

| 메서드 | 경로 | 설명 |
|---|---|---|
| `POST` | `/auth/signup` | 이메일 또는 아이디 회원가입 |
| `POST` | `/auth/login` | 로그인 |
| `POST` | `/auth/logout` | 현재 세션 종료 |
| `POST` | `/auth/refresh` | 액세스 토큰 갱신 |
| `POST` | `/auth/password-reset/request` | 계정 존재 여부를 노출하지 않는 비밀번호 재설정 요청 |
| `POST` | `/auth/password-reset/confirm` | 일회용 토큰 확인 후 비밀번호 변경과 전체 세션 폐기 |
| `POST` | `/auth/email-verification/request` | 로그인 계정의 이메일 인증 안내 재요청 |
| `POST` | `/auth/email-verification/confirm` | 일회용 토큰으로 이메일 인증 완료 |
| `GET` | `/auth/oauth/{provider}/start` | 네이버·카카오·Google OAuth 시작 |
| `GET` | `/auth/oauth/{provider}/callback` | 인가 코드 검증과 서비스 로그인 |
| `GET` | `/me` | 현재 사용자와 역할 조회 |
| `PATCH` | `/me` | 내 정보 수정 |
| `POST` | `/me/guardian-invitations` | 학생이 보호자 초대 생성 |
| `GET` | `/guardian-invitations/{token}` | 보호자가 학생·동의 범위 확인 |
| `POST` | `/guardian-invitations/{token}/accept` | 보호자 본인확인·동의 후 연결 활성화 |
| `POST` | `/me/guardian-links/{linkId}/revoke` | 학생 또는 보호자가 연결 해제 요청 |
| `GET` | `/guardians/me/students` | 보호자에게 활성 연결된 학생 목록 |
| `GET` | `/guardians/me/students/{studentId}/report` | 활성 연결·현재 학습정보 동의 확인 후 공개 강의·단계 진도 리포트 |

웹에서는 `HttpOnly`, `Secure`, `SameSite` 속성이 설정된 세션 쿠키 사용을 우선 검토합니다. 토큰을 `localStorage`에 장기 저장하지 않습니다.

학생이 보호자를 초대하며 보호자가 수락하고 필요한 법정대리인 동의를 완료하기 전까지 연결은 `pending`입니다. 초대만으로 학습정보를 공개하지 않습니다. 미성년자 계정에는 최소 수집, 동의 버전·범위·확인방법 기록, 철회, 탈퇴와 데이터 삭제 절차를 적용합니다. 상세 기준은 [계정·보호자·지도자·기관 권한 정책](./ACCOUNT_PERMISSION_POLICY.md)을 따릅니다.

현재 구현은 `GuardianInvitation(PENDING)`을 대기 연결로 사용하고 수락 시에만 `GuardianLink(ACTIVE)`를 생성합니다. 초대 토큰 원문은 데이터베이스에 저장하지 않으며, 보호자 로그인 이메일이 초대 이메일과 일치해야 수락할 수 있습니다. 개발·테스트 환경에서는 메일 발송 전 흐름 검증을 위해 응답의 `developmentToken`으로 토큰을 제공하지만 운영 응답에서는 제외합니다. 운영 전 이메일 발송 사업자와 반송·재발송 정책을 연결해야 합니다.

계정 인증·복구 토큰도 원문 대신 SHA-256 해시만 저장하고 발급 시 기존 미사용 토큰을 폐기합니다. 비밀번호 재설정 요청은 이메일의 가입 여부와 관계없이 같은 `202 Accepted` 응답을 반환합니다. 기본 만료시간은 재설정 30분, 이메일 인증 24시간이며 각각 `PASSWORD_RESET_TTL_MINUTES`, `EMAIL_VERIFICATION_TTL_HOURS`로 설정합니다. 개발·테스트 응답만 `developmentToken`을 제공합니다.

운영에서는 Nodemailer SMTP 어댑터가 `PUBLIC_APP_URL` 기반 인증·재설정 링크를 HTML과 텍스트 본문으로 발송합니다. SMTP 송수신 시간으로 계정 존재 여부가 드러나지 않도록 HTTP 응답 이후 비동기로 발송하며 성공·건너뜀·실패 결과를 `EmailDelivery` 감사로그로 기록합니다. `SMTP_HOST`, `MAIL_FROM`, `PUBLIC_APP_URL`은 운영 필수이고 587 포트는 `SMTP_REQUIRE_TLS=true`, 465 포트의 implicit TLS는 `SMTP_SECURE=true`와 `SMTP_REQUIRE_TLS=false`를 사용합니다. 현재 발송 작업은 API 프로세스 메모리에서 실행되므로 프로세스 종료에도 견디는 영속 큐·자동 재시도는 운영 고도화 항목입니다.

## 4. 여행과 강의

### 현재 구현 상태

- **구현됨**: `GET /eras`, `GET /eras/{eraId}/lessons`, `GET /lessons`, `GET /lessons/{lessonId}`
- **구현됨**: `published` 강의만 공개하고 공개 강의 수가 0인 시대는 `coming_soon`으로 계산
- **구현됨**: 6개 시대 기준 데이터와 무료 샘플 `PRE-01` 한 건을 추가하는 마이그레이션
- **구현됨**: 무료 샘플·활성 구독·운영자 미리보기 재생 접근 판정과 구독 플랜 조회
- **구현됨**: 강의 시작, 단계별 멱등 완료, 전체 단계 확인 후 최종 완료, 내 강의 진도 조회
- **구현됨**: 학생 전체·시대별 진도, 최근 학습과 구독 접근성을 반영한 다음 강의를 제공하는 React `/dashboard`
- **구현됨**: 서버 플랜 가격 기준 주문, PortOne V1 결제 조회·검증, 멱등 구독 발급, 주문·구독 내역
- **구현됨**: PortOne 웹훅 재조회·멱등 동기화, 운영자·관리자 전액 환불, 부분 환불 누적과 전액 환불 권한 회수
- **구현됨**: 공급자 중립 미디어 전송 서비스, CloudFront SHA-256 서명 URL 어댑터, S3 직접 서명 폴백과 React 영상 재생
- **구현됨**: 운영자·관리자 MP4 업로드 정책, 객체 메타데이터·`ftyp` 검사, DB 작업 큐와 별도 워커의 S3→ClamAV 스트리밍 검사, 통과 후 강의 연결
- **구현됨**: 강의별 HLS 마스터 활성화, 재생목록별 권한 재검사, 안전한 상대 경로와 세그먼트별 단기 서명, HLS.js/native 플레이어
- **구현됨**: ClamAV 통과 MP4의 영속 HLS 변환 큐, FFmpeg 최대 360p·720p fMP4 VOD 생성, S3 패키지 업로드·부분 실패 정리, 최신 영상 재검사와 운영자 상태·재시도
- **구현됨**: 운영자·관리자 강의 CMS 목록·등록·수정·공개·비공개·보관 API와 React `/admin/lessons`
- **구현됨**: 썸네일·PDF·PPT/PPTX·DOC/DOCX·HWP/HWPX 격리 모델, 서명 직접 업로드, 파일 시그니처·ClamAV 검사와 CMS 상태 표시
- **구현됨**: 공개 강의 썸네일 서명 표시와 무료 샘플·활성 구독·운영자 권한 기반 학습자료 다운로드
- **구현됨**: 주문·구독·환불 불일치 탐지, 기간·상태·검색 필터, 페이지 조회, CSV 내보내기, PortOne 수동 재동기화와 전액 환불을 제공하는 React `/admin/payments`
- **구현됨**: DB 최신 스키마·S3 쓰기/읽기/삭제·ClamAV·SMTP·PortOne 인증·필수 OAuth 설정을 비파괴적으로 점검하는 운영 프리플라이트 CLI
- **추가 고도화**: 대용량 자료의 별도 비동기 검사 워커 전환

| 메서드 | 경로 | 설명 |
|---|---|---|
| `GET` | `/eras` | 시대 목록과 개방 상태 |
| `GET` | `/eras/{eraId}/lessons` | 시대별 강의 목록 |
| `GET` | `/lessons/{lessonId}` | 공개 강의 정보와 단계 구성 |
| `GET` | `/lessons/{lessonId}/playback` | 무료 샘플 또는 유효한 계정 구독 확인 후 서명 재생 URL 발급 |
| `GET` | `/lessons/{lessonId}/hls-manifest` | 동일 권한 재검사 후 HLS 하위 재생목록은 API 경로로, 미디어 조각은 단기 서명 URL로 재작성 |
| `POST` | `/admin/lessons/{lessonId}/hls-source` | 운영자가 비공개 저장소에 준비된 강의별 HLS 마스터 재생목록을 검증하고 활성화 |
| `POST` | `/lessons/{lessonId}/start` | 강의 시작 기록 |
| `POST` | `/lessons/{lessonId}/steps/{stepId}/complete` | 단계 완료 |
| `POST` | `/questions/{questionId}/attempts` | 답안 제출 |
| `POST` | `/lessons/{lessonId}/complete` | 강의 완료 처리 |
| `GET` | `/me/lessons/{lessonId}/progress` | 로그인 사용자의 강의 진도 조회 |
| `GET` | `/me/dashboard` | 학생의 전체·시대별 진도, 최근 학습, 접근 가능한 다음 강의 추천 |
| `GET` | `/subscription-plans` | 활성 계정 구독 플랜 조회 |

### 시대 응답 예시

```json
{
  "data": [
    {
      "id": "era_prehistoric",
      "order": 1,
      "name": "선사시대",
      "theme": "주변을 살펴라",
      "status": "in_progress",
      "completedLessons": 2,
      "totalLessons": 8
    }
  ]
}
```

재생 접근 API는 원본 저장소 키를 별도 응답 필드로 제공하지 않습니다. 권한 판정을 통과하면 `free_sample`, `subscription`, `operator_preview` 중 접근 근거와 재생 상태를 반환합니다. 영상이 없으면 `asset_pending`, 저장소가 설정되지 않았으면 `signer_pending`, 서명에 성공하면 `ready`와 `playback.url`, `expiresAt`, 실제 전송 경로인 `delivery`(`cloudfront` 또는 `object-storage`)를 반환합니다. 기본 만료시간은 300초이고 최대 900초이며 응답에는 `Cache-Control: private, no-store`와 `Vary: Cookie`를 적용합니다. 서명 URL 자체에는 객체 경로가 포함될 수 있으므로 버킷은 반드시 공개 접근을 차단해야 합니다.

### 답안 제출 예시

```json
{
  "answer": {
    "choiceId": "history_choice_02"
  },
  "clientAttemptId": "catt_8b3c9e07"
}
```

`clientAttemptId` 또는 멱등성 키를 사용해 네트워크 재시도로 인한 중복 제출과 보상 지급을 방지합니다.

## 4.1 사용자 착수형 바둑미션

바둑미션은 객관식 답안 API를 사용하지 않습니다. 9·13·19줄 문제를 좌표 데이터로 제공하고, 사용자가 미확정 착수 후 `정답 확인`을 누르면 서버가 현재 판, 바둑 규칙, 미션 수순 트리를 검증하여 상대 자동 응수와 다음 상태를 반환합니다.

| 메서드 | 경로 | 설명 |
|---|---|---|
| `GET` | `/missions` | 과정·권·강·판 크기·유형·난이도·풀이 상태별 문제 카드 목록 |
| `GET` | `/missions/{missionId}` | 구독·무료 샘플 확인 후 미션과 이어할 판 조회 |
| `POST` | `/missions/{missionId}/attempts` | 새 미션 게임 시작 |
| `GET` | `/mission-attempts/{attemptId}` | 마지막 서버 확정 판과 수순 조회 |
| `POST` | `/mission-attempts/{attemptId}/moves` | 사용자 착수 제출, 규칙·수순 판정, 상대 응수 반환 |
| `POST` | `/mission-attempts/{attemptId}/hints` | 단계별 힌트 사용 |
| `POST` | `/mission-attempts/{attemptId}/retry` | 체크포인트 또는 처음부터 재도전 |
| `GET` | `/me/mission-attempts` | 이어하기·완료·오답 미션 조회 |
| `GET` | `/me/wrong-note` | 오답노트와 복습 완료 상태 조회 |
| `GET` | `/admin/missions` | 문제은행 관리 목록과 통계 필터 |
| `POST` | `/admin/missions` | 관리자·운영자 문제 임시저장 생성 |
| `PATCH` | `/admin/missions/{missionId}` | 교육과정·초기 판·목표·분기 수순·힌트·해설 수정 |
| `POST` | `/admin/missions/{missionId}/validate` | 공개 전 불법 수·성공 경로·반복 검증 |
| `POST` | `/admin/missions/{missionId}/preview-attempts` | 실제 학습기록을 남기지 않는 미리보기 |
| `POST` | `/admin/missions/{missionId}/request-review` | 운영 검수 요청 |
| `POST` | `/admin/missions/{missionId}/publish` | 즉시 또는 예약 게시 |
| `GET` | `/admin/missions/{missionId}/statistics` | 정답률·힌트·평균 풀이시간·점수 통계 |

착수 요청:

```json
{
  "clientMoveId": "move_01JXYZ",
  "missionVersion": 3,
  "expectedMoveNumber": 5,
  "boardHash": "board_v4_f91a",
  "move": { "color": "black", "x": 3, "y": 4 }
}
```

착수 응답:

```json
{
  "data": {
    "result": "correct",
    "playerMove": { "color": "black", "x": 3, "y": 4 },
    "capturedStones": [],
    "opponentMoves": [{ "color": "white", "x": 4, "y": 4 }],
    "nextTurn": "black",
    "status": "in_progress",
    "boardHash": "board_v5_ab12"
  }
}
```

클라이언트는 빠른 불법 착수 안내를 위해 동일한 기본 규칙 엔진을 사용하지만 최종 판정과 점수 계산은 서버가 담당합니다. 사용자가 판에 둔 후보는 `정답 확인` 전까지 클라이언트의 `pendingMove`이며 서버 기록에 포함하지 않습니다. `clientMoveId`는 중복 제출을 방지하고, `expectedMoveNumber`와 `boardHash`는 여러 기기 또는 중복 탭의 판 상태 충돌을 감지합니다. 미션 전체 정답 수순은 사용자 API 응답에 포함하지 않습니다.

핵심 모델:

```text
BadukMission
├─ level, volume, lesson, problemGroup, category, difficulty
├─ eraId, lessonId, lectureVideoId, historyContentId, textbookPage
├─ boardSize: 9 | 13 | 19, ruleset, playerColor, firstTurn
├─ initialBlackStones, initialWhiteStones
├─ missionType, successCondition, solutionTree, forbiddenLines
├─ hints, feedbacks, correctExplanation
├─ baseScore, timeLimitSeconds, retryLimit, rewardId, isFreeSample
├─ status, scheduledAt, publishedAt, version
└─ createdAt, updatedAt, createdBy, updatedBy

MissionAttempt
├─ missionId, missionVersion, userId
├─ source, currentNodeId, boardState, boardHash, status
├─ moveCount, wrongMoveCount, attemptCount
├─ hintLevel, hintUseCount, score
└─ startedAt, lastPlayedAt, completedAt

MissionMove
├─ attemptId, clientMoveId, moveNumber, actor, color, x, y
├─ result, capturedStones, nodeId, boardHash
└─ playedAt

MissionStatistics
├─ missionId, missionVersion
├─ attemptUsers, attemptCount, completionCount, correctCount
├─ hintUseCount, averageSolveSeconds, averageScore
└─ aggregatedAt
```

문제 원본 좌표는 좌상단 `(0, 0)` 정수 좌표로 저장하고 SGF는 가져오기·내보내기 보조 형식으로 사용합니다. 문제 카드, PC 확대 모달, 모바일 전체화면, 지도자 수업 화면은 같은 `attemptId`와 API를 사용합니다. 상세 게임·CMS·상태 명세는 [사용자 착수형 바둑문제·바둑미션 게임 기획](./BADUK_MISSION_GAME.md)을 참고합니다.

## 5. 진도와 보상

| 메서드 | 경로 | 설명 |
|---|---|---|
| `GET` | `/me/dashboard` | 전체·시대별 진도 요약과 다음 학습 추천 |
| `GET` | `/me/review-questions` | 오답 복습 목록 |
| `GET` | `/me/rewards` | 별, 배지, 유물 카드 |
| `GET` | `/guardians/me/students/{studentId}/report` | 학부모용 학생 리포트 |

### 핵심 데이터 모델

```text
User
├─ id
└─ status

UserRole
├─ userId
├─ role: student | guardian | teacher | organization_admin | operator | admin
└─ verificationStatus

StudentGuardianLink
├─ id, studentId, guardianId?
├─ status: pending | active | declined | revoked | expired
└─ requestedAt, acceptedAt, revokedAt

LessonProgress
├─ userId
├─ lessonId
├─ status
├─ scoreBaduk
├─ scoreHistory
├─ startedAt
└─ completedAt

RewardGrant
├─ userId
├─ rewardId
├─ sourceLessonId
└─ grantedAt
```

`RewardGrant`에는 `(userId, rewardId, sourceLessonId)` 고유 제약을 두어 중복 보상을 차단합니다.

## 6. 교실과 과제

| 메서드 | 경로 | 설명 |
|---|---|---|
| `GET` | `/teacher/classes` | 담당 반 목록 |
| `POST` | `/teacher/classes` | 반 생성 |
| `POST` | `/teacher/classes/{classId}/invite-codes` | 학생 등록 코드 생성 |
| `GET` | `/teacher/classes/{classId}/students` | 반 학생 조회 |
| `POST` | `/teacher/classes/{classId}/assignments` | 과제 배포 |
| `GET` | `/teacher/assignments/{assignmentId}/results` | 과제 결과 집계 |
| `GET` | `/teacher/materials` | 수업 자료 검색 |
| `GET` | `/class-helpers` | 지도자용 수업 패키지 게시물 목록·상세 |
| `POST` | `/admin/class-helpers` | 관리자·운영자 수업 패키지 일괄 등록 |
| `PATCH` | `/admin/class-helpers/{packageId}` | 수업 흐름과 첨부자료 수정 |
| `POST` | `/organizations/{organizationId}/members` | 기관 관리자가 지도자 초대 |
| `PATCH` | `/organizations/{organizationId}/members/{memberId}` | 기관 멤버십 상태·역할 변경 |
| `GET` | `/me/entitlements` | 개인·기관 이용권과 유효기간 조회 |

지도자는 인증 역할, 활성 기관 멤버십, 담당 반을 모두 통과한 데이터만 조회할 수 있어야 합니다. 콘텐츠 이용은 개인 구독과 기관 이용권 중 하나로 허용할 수 있지만, 기관 학생 데이터는 반드시 소속과 담당 반을 추가 검사합니다. 일반 지도자는 기관 라이선스·좌석·환불을 관리하지 않으며 기관 관리자 권한과 분리합니다.

수업도우미 게시물은 `lessonId`, `badukMissionId`, 대상 학년, 전체 수업 시간, 5단계 수업 흐름과 역할이 지정된 7개 첨부파일을 한 번에 반환합니다. 첨부파일마다 `lessonVideo`, `projectorPpt`, `activityPdf`, `historyQuizFile`, `problemMissionFile`, `answerFile`, `teacherGuideFile` 역할을 저장하여 화면 순서가 파일명에 의존하지 않게 합니다. `badukMissionId`는 수업 상세에서 사용자 착수형 게임을 실행하는 연결값이며, `problemMissionFile`은 인쇄용 보조자료입니다.

## 7. 교재 QR

| 메서드 | 경로 | 설명 |
|---|---|---|
| `GET` | `/qr/{code}` | QR 코드 상태와 연결 대상 확인 |
| `POST` | `/qr/{code}/claim` | 사용자 또는 기관 계정에 코드 등록 |

QR 원문에 강의 ID나 사용자 정보를 직접 포함하지 않습니다. 충분한 난수성을 가진 불투명 코드를 사용하고 등록 횟수와 만료 정책을 서버에서 검사합니다.

권장 딥링크 흐름:

```text
/qr/ABCD1234
  → 코드 확인
  → 로그인 필요 시 /login?returnTo=/qr/ABCD1234
  → 코드 등록
  → /journey/{eraId}/lessons/{lessonId}
```

## 8. 상품과 결제

| 메서드 | 경로 | 설명 |
|---|---|---|
| `GET` | `/products` | 상품 목록 |
| `GET` | `/products/{productId}` | 상품 상세 |
| `GET` | `/cart` | 장바구니 조회 |
| `POST` | `/cart/items` | 상품 담기 |
| `POST` | `/orders/checkout` | 서버 가격 검증과 PortOne 결제용 구독 주문 생성 |
| `POST` | `/orders` | 주문 생성 |
| `POST` | `/payments/portone/verify` | PortOne 결제 조회 후 주문번호·금액·상태 검증과 구독 발급 |
| `POST` | `/payments/portone/webhook` | PortOne 결제 재조회 후 성공·실패·취소 상태 멱등 동기화 |
| `POST` | `/admin/subscriptions/{subscriptionId}/refund` | 운영자·관리자 전액 환불과 구독 권한 회수 |
| `GET` | `/admin/payments/reconciliation` | 최대 366일 범위의 주문·구독·환불 대사, 기간·주문상태·대사상태·검색·페이지 조건 조회 |
| `GET` | `/admin/payments/reconciliation.csv` | 동일한 조회 조건의 UTF-8 CSV 내보내기와 감사로그 기록 |
| `POST` | `/admin/orders/{orderId}/reconcile` | 저장된 번호 또는 운영자가 입력한 PortOne 결제번호로 원본 재조회·상태 동기화와 감사로그 기록 |
| `GET` | `/me/orders` | 내 주문 목록 |
| `GET` | `/subscription-plans` | 활성 계정 구독 플랜 목록 |
| `GET` | `/me/subscriptions` | 종료 항목을 포함한 내 구독 내역 |

클라이언트가 전송한 가격과 할인 금액을 신뢰하지 않습니다. 주문 확정 시 서버가 상품 가격, 재고, 배송비, 쿠폰을 다시 계산합니다. 결제 성공 여부는 PG사의 서버 검증 또는 웹훅으로 최종 확정합니다.

강의별 주문은 사용하지 않습니다. 사용자는 계정 구독 플랜 식별자만 전송합니다.

```json
{
  "items": [
    { "productType": "account_subscription", "planId": "subscription-6m", "quantity": 1 }
  ]
}
```

서버는 주문 생성 시점의 `SubscriptionPlan`에서 활성 상태, 개월 수와 최신 금액을 조회합니다. 브라우저가 보낸 금액은 사용하지 않습니다. 활성 구독이 이미 있으면 중복 주문을 거절합니다.

```json
{
  "subscription": {
    "planId": "subscription-1m",
    "startsAt": "2026-08-19T06:00:00Z",
    "endsAt": "2026-09-19T15:00:00Z"
  }
}
```

위 예시는 한국시간 2026-08-19 결제, 2026-09-19까지 이용, 2026-09-20 00:00:00 종료를 뜻합니다. 목표 월에 같은 일자가 없으면 그 달 말일까지 이용하고 다음 날 00시에 종료합니다. 결제 승인과 구독 생성은 같은 트랜잭션에서 처리하고, 모든 구독 이력은 감사와 환불 처리를 위해 보존합니다.

구체적인 제공사 설정과 토스 승인 흐름은 [간편 로그인·토스페이먼츠 연동](./SOCIAL_LOGIN_PAYMENT.md)을 참고합니다.

현재 서버는 `PORTONE_V1_REST_API_KEY`와 `PORTONE_V1_REST_API_SECRET`으로 PortOne V1 결제 단건을 조회합니다. 결제 조회 결과가 `paid`이고 `merchant_uid`, 금액이 저장된 주문과 일치할 때만 주문과 구독을 같은 트랜잭션으로 확정합니다. 같은 `imp_uid`·주문 또는 웹훅을 다시 처리해도 기존 결과를 반환합니다.

관리자 대사 조회는 `from`, `to`, `status`, `reconciliation`, `search`, `page`, `pageSize` 조건을 사용합니다. 날짜를 생략하면 최근 31일, 직접 입력할 때는 한국시간 `YYYY-MM-DD`의 시작·종료일을 함께 사용하며 최대 366일입니다. CSV는 페이지 조건을 제외한 전체 조건을 사용합니다. 조회 후보가 5,000건을 넘으면 화면에 축약 상태를 표시하고 CSV는 기간 또는 조건을 좁히도록 거부합니다. CSV 문자열은 수식으로 해석될 수 있는 선행 문자를 이스케이프합니다.

웹훅 본문의 상태는 직접 신뢰하지 않고 `imp_uid`로 PortOne을 다시 조회합니다. 외부 부분 환불은 누적 환불금액과 이력을 저장하되 구독 권한을 유지하고, 누적 환불금액이 주문금액과 같아지는 전액 환불 시 `paymentStatus=REFUNDED`로 바꾸어 권한을 즉시 회수합니다. 환불 실행 API는 정책 오남용을 막기 위해 운영자·관리자 역할로 제한합니다.

## 9. 상담과 커뮤니티

| 메서드 | 경로 | 설명 |
|---|---|---|
| `POST` | `/consultations` | 기관 상담 접수 |
| `POST` | `/inquiries` | 1:1 문의 접수 |
| `GET` | `/notices` | 공지사항 |
| `GET` | `/faqs` | FAQ 목록 |
| `GET` | `/posts` | 공개 커뮤니티 게시물 |

상담 입력값은 서버에서 형식과 길이를 검증하고, 개인정보 동의 문서 버전과 동의 시간을 함께 저장합니다. 공개 게시 기능을 추가할 경우 신고, 숨김, 금칙어, 운영자 검수 정책이 선행되어야 합니다.

게시판별 등록·수정·승인 API와 필드 정의는 [게시판 입력·권한 설계](./BOARD_CMS.md)를 참고합니다.

## 10. 강의 CMS

| 메서드 | 경로 | 권한 | 설명 |
|---|---|---|---|
| `GET` | `/admin/lessons?include=draft,archived` | 운영자·관리자 | 전체 강의 관리 목록 |
| `POST` | `/admin/lessons` | 운영자·관리자 | 강의정보·무료 공개 여부를 비공개 상태로 등록하고 6개 기본 단계 생성 |
| `PATCH` | `/admin/lessons/{lessonId}` | 운영자·관리자 | 강의 콘텐츠 수정 |
| `PATCH` | `/admin/lessons/{lessonId}/status` | 운영자·관리자 | 공개·비공개·보관 |
| `POST` | `/admin/lessons/{lessonId}/video-upload` | 운영자·관리자 | MP4 크기와 MIME 검증 후 S3 POST 업로드 정책 발급 |
| `POST` | `/admin/lessons/{lessonId}/video-upload/complete` | 운영자·관리자 | 객체 메타데이터·실제 크기·`ftyp` 시그니처 확인 후 비동기 검사 작업 등록 |
| `GET` | `/admin/lessons/{lessonId}/video-uploads` | 운영자·관리자 | 최근 영상 검사 상태·시도 횟수·현재 연결 여부 조회 |
| `POST` | `/admin/lessons/{lessonId}/video-uploads/{assetId}/retry` | 운영자·관리자 | 오류 영상의 검사 횟수를 초기화하고 즉시 재시도 예약 |
| `GET` | `/admin/lessons/{lessonId}/assets` | 운영자·관리자 | 썸네일·학습자료 격리·검사 상태 조회 |
| `POST` | `/admin/lessons/{lessonId}/assets/uploads` | 운영자·관리자 | 격리 자산 생성과 S3 POST 정책 발급 |
| `POST` | `/admin/lessons/{lessonId}/assets/{assetId}/complete` | 운영자·관리자 | 메타데이터·시그니처·ClamAV 검사 후 활성화 또는 거부 |
| `GET` | `/lessons/{lessonId}/thumbnail` | 공개 | 현재 연결된 `ready` 썸네일의 단기 서명 URL 발급 |
| `GET` | `/lessons/{lessonId}/materials` | 강의 접근 권한 | `ready` 학습자료의 첨부 다운로드 서명 URL 발급 |
| `GET` | `/admin/subscriptions` | 관리자 | 계정 구독·종료·환불 이력 조회 |

업로드 파일은 비공개 객체 저장소에 보관합니다. 브라우저는 운영자 API가 발급한 5분 S3 POST 정책으로 객체 저장소에 직접 전송합니다. 정책은 `video/mp4`, 요청 크기와 최대 2GB를 제한하고 강의 ID·예상 크기를 서명된 메타데이터에 포함합니다. 완료 API는 `HEAD`와 첫 12바이트 범위 조회로 메타데이터, 실제 크기와 MP4 `ftyp` 시그니처를 확인한 뒤 DB 검사 작업만 등록합니다. 독립 `video-scan-worker`가 S3 응답을 버퍼링하지 않고 ClamAV `INSTREAM`으로 전달하고 `ready` 결과에만 `Lesson.videoAssetKey`를 갱신합니다. 경쟁 업로드에서는 더 최신 영상이 이미 연결된 경우 과거 작업이 이를 덮어쓰지 않습니다.

`ObjectDeletionJob`은 객체 삭제를 API 요청과 분리한 영속 큐입니다. `video-cleanup-worker`가 기본 24시간 지난 미완료 업로드를 먼저 `purged`로 전환하고, 영상 교체 시에는 이전 관리형 객체를 기본 24시간 보존 후 삭제합니다. 삭제 직전 `Lesson.videoAssetKey` 참조 수를 다시 검사해 다시 연결된 객체는 `cancelled`로 끝내며, 저장소 장애는 최대 5회 재시도합니다. 저장소 IAM에는 `DeleteObject`가 필요합니다. 버전 관리 버킷의 단순 삭제는 현재 버전에 삭제 마커를 추가하므로, 비현재 버전의 영구 정리는 별도 S3 Lifecycle 정책으로 설정합니다.

`Lesson.isFreeSample`은 무료 공개 여부를 나타냅니다. 재생 API는 강의가 `published`인지 먼저 확인하고, `isFreeSample = true`이거나 계정 구독의 `endsAt`이 유효한 경우에만 짧은 만료 시간을 가진 재생 URL을 발급합니다. 무료 샘플도 원본 저장 경로는 별도 응답 필드로 반환하지 않습니다. MP4는 객체 URL을 직접 서명하고 HLS는 모든 마스터·미디어 재생목록 요청에서 권한을 다시 검사합니다. HLS 재생목록의 외부·절대·상위 경로 참조는 거부하고, 같은 `lesson-hls/{lessonId}/{version}/` 패키지의 세그먼트·키·초기화 조각만 각각 단기 서명합니다. ClamAV를 통과한 MP4에는 `HlsTranscodeJob`이 생성되고 별도 워커가 원본보다 높이지 않은 최대 360p·720p fMP4 VOD 패키지를 생성합니다. 업로드 후에도 강의의 현재 MP4가 동일할 때만 HLS 마스터로 교체하며, 교체된 원본은 보존기간 뒤 삭제 큐로 전달합니다. CloudFront가 설정되면 MP4와 HLS 객체 모두 CDN SHA-256 서명 URL을 사용하고, 없으면 기존 S3 서명 URL로 폴백합니다. 실제 CloudFront 배포 생성은 별도 운영 범위입니다.

초기 마이그레이션 데이터는 무료 샘플인 선사시대 1강 `PRE-01` 한 건만 생성합니다. 이후 강의는 모두 위 관리자 API로 등록하며 시대별 강의 수와 지도 표시는 `published` 데이터 집계값을 사용합니다.

신규 강의는 항상 `draft`로 생성합니다. 같은 시대 안에서 강의 순서는 중복될 수 없고 ID는 영문 대문자·숫자·하이픈으로 제한합니다. `published` 전환은 비공개 영상과 정확히 6개 기본 단계가 연결된 경우에만 허용합니다. 물리 삭제 대신 `archived`를 사용하며 생성·수정·상태 변경은 감사로그에 기록합니다.

썸네일과 학습자료는 업로드 요청 시 `quarantined` 레코드를 먼저 생성합니다. 저장소의 MIME·크기·강의 및 자산 메타데이터와 JPG·PNG·WebP·PDF·PPT/PPTX·DOC/DOCX·HWP/HWPX 파일 구조를 검사하고, ClamAV `INSTREAM` 결과가 `OK`인 경우에만 `ready`로 전환합니다. DOC·PPT·HWP는 CFB 루트 스트림과 고유 문서 시그니처를, DOCX·PPTX·HWPX는 ZIP 중앙 디렉터리·안전한 경로·압축 해제 총량·필수 패키지 엔트리를 확인합니다. HWPX의 `mimetype`은 `application/hwp+zip`이어야 합니다. 탐지 파일은 `rejected`로 고정하며 스캐너 장애나 미설정 시에는 격리 상태를 유지합니다. 썸네일은 정상 판정 후에만 `Lesson.thumbnailKey`에 연결됩니다.

공개 카탈로그는 객체 키를 반환하지 않고 `hasThumbnail`만 제공합니다. 썸네일 API는 공개 강의에 현재 연결된 `ready` 자산만 인라인 서명하고, 자료 API는 재생과 동일한 무료 샘플·활성 구독·운영자 권한을 다시 검사한 뒤 `ready` 자료만 첨부 다운로드로 서명합니다. 두 응답은 `private, no-store`이며 기본 5분, 최대 15분 만료 설정을 공유합니다.

강의 CMS에는 가격, 판매 시작·종료일, 강의별 이용 일수를 두지 않습니다. 구독 플랜이 변경되는 경우 플랜 목록 캐시를 무효화하며, 결제 요청 도중 금액이 바뀌면 미결제 주문을 폐기하고 최신 금액으로 다시 생성합니다. 기존 결제내역은 플랜·개월 수·금액 스냅샷을 유지합니다.

상세 정책은 [계정 구독형 강의 CMS·시청 권한 설계](./LECTURE_CMS.md)를 참고합니다.

## 11. 프런트엔드 연동 순서

1. 로그인과 `/me` 연결
2. 시대·강의 목록을 `eraData` 정적 객체에서 API로 전환 — **React `/lessons`에 구현됨**
3. 사용자 착수형 바둑미션과 역사 문제 답안 저장 — **강의 플레이어 권한·단계 진도는 구현됨**
4. 학생 대시보드 연결
5. 교재 QR 딥링크 연결
6. 지도자 반·과제 기능 연결
7. 상담과 스토어 연결
8. 계정 구독 주문·종료 권한 연결
9. 관리자·운영자 강의 CMS와 비공개 파일 업로드 연결 — **React `/admin/lessons`에 구현됨**

각 단계에서 로딩, 빈 상태, 권한 없음, 네트워크 오류, 재시도 UI를 함께 구현합니다.
