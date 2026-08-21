# 백엔드 연동 가이드

## 1. 목적

현재 데모 UI를 실제 회원, 학습 진도, 교재, 상담 서비스와 연결하기 위한 계약 초안입니다. 엔드포인트와 필드명은 구현 언어와 인프라가 확정된 뒤 OpenAPI 문서로 관리합니다.

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

### 제안 엔드포인트

| 메서드 | 경로 | 설명 |
|---|---|---|
| `POST` | `/auth/signup` | 이메일 또는 아이디 회원가입 |
| `POST` | `/auth/login` | 로그인 |
| `POST` | `/auth/logout` | 현재 세션 종료 |
| `POST` | `/auth/refresh` | 액세스 토큰 갱신 |
| `POST` | `/auth/password/reset-request` | 비밀번호 재설정 요청 |
| `GET` | `/auth/oauth/{provider}/start` | 네이버·카카오·Google OAuth 시작 |
| `GET` | `/auth/oauth/{provider}/callback` | 인가 코드 검증과 서비스 로그인 |
| `GET` | `/me` | 현재 사용자와 역할 조회 |
| `PATCH` | `/me` | 내 정보 수정 |

웹에서는 `HttpOnly`, `Secure`, `SameSite` 속성이 설정된 세션 쿠키 사용을 우선 검토합니다. 토큰을 `localStorage`에 장기 저장하지 않습니다.

미성년자 계정 정책에는 보호자 동의, 최소 수집 원칙, 탈퇴와 데이터 삭제 절차가 포함되어야 합니다.

## 4. 여행과 강의

| 메서드 | 경로 | 설명 |
|---|---|---|
| `GET` | `/eras` | 시대 목록과 개방 상태 |
| `GET` | `/eras/{eraId}/lessons` | 시대별 강의 목록 |
| `GET` | `/lessons/{lessonId}` | 강의 구성과 현재 진도 |
| `GET` | `/lessons/{lessonId}/playback` | 무료 샘플 또는 유효한 계정 구독 확인 후 서명 재생 URL 발급 |
| `POST` | `/lessons/{lessonId}/start` | 강의 시작 기록 |
| `POST` | `/lessons/{lessonId}/steps/{stepId}/complete` | 단계 완료 |
| `POST` | `/questions/{questionId}/attempts` | 답안 제출 |
| `POST` | `/lessons/{lessonId}/complete` | 강의 완료 처리 |

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
| `GET` | `/me/progress` | 전체 진도 요약 |
| `GET` | `/me/review-questions` | 오답 복습 목록 |
| `GET` | `/me/rewards` | 별, 배지, 유물 카드 |
| `GET` | `/guardians/me/students/{studentId}/report` | 학부모용 학생 리포트 |

### 핵심 데이터 모델

```text
User
├─ id
├─ role: student | guardian | teacher | operator | admin
└─ status

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

지도자는 소속 기관과 담당 반의 데이터만 조회할 수 있어야 합니다. 운영자 권한과 지도자 권한을 동일하게 취급하지 않습니다.

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
| `POST` | `/orders/checkout` | 서버 가격 검증과 토스 결제용 주문 생성 |
| `POST` | `/orders` | 주문 생성 |
| `POST` | `/payments/toss/confirm` | 토스 결제 금액 검증과 최종 승인 |
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
| `POST` | `/admin/lessons` | 운영자·관리자 | 영상·강의정보·학습자료·무료 공개 여부 등록 |
| `PATCH` | `/admin/lessons/{lessonId}` | 운영자·관리자 | 강의 콘텐츠 수정 |
| `PATCH` | `/admin/lessons/{lessonId}/status` | 운영자·관리자 | 공개·비공개·보관 |
| `POST` | `/admin/uploads` | 운영자·관리자 | 영상·썸네일·자료 업로드 시작 |
| `GET` | `/admin/subscriptions` | 관리자 | 계정 구독·종료·환불 이력 조회 |

업로드 파일은 비공개 객체 저장소에 보관합니다. `Lesson.isFreeSample`은 무료 공개 여부를 나타냅니다. 재생 API는 강의가 `published`인지 먼저 확인하고, `isFreeSample = true`이거나 계정 구독의 `endsAt`이 유효한 경우에만 짧은 만료 시간을 가진 CDN 서명 URL을 발급합니다. 무료 샘플도 원본 저장 경로는 반환하지 않습니다.

강의 CMS에는 가격, 판매 시작·종료일, 강의별 이용 일수를 두지 않습니다. 구독 플랜이 변경되는 경우 플랜 목록 캐시를 무효화하며, 결제 요청 도중 금액이 바뀌면 미결제 주문을 폐기하고 최신 금액으로 다시 생성합니다. 기존 결제내역은 플랜·개월 수·금액 스냅샷을 유지합니다.

상세 정책은 [계정 구독형 강의 CMS·시청 권한 설계](./LECTURE_CMS.md)를 참고합니다.

## 11. 프런트엔드 연동 순서

1. 로그인과 `/me` 연결
2. 시대·강의 목록을 `eraData` 정적 객체에서 API로 전환
3. 사용자 착수형 바둑미션, 역사 문제 답안과 진도 저장
4. 학생 대시보드 연결
5. 교재 QR 딥링크 연결
6. 지도자 반·과제 기능 연결
7. 상담과 스토어 연결
8. 계정 구독 주문·종료 권한 연결
9. 관리자·운영자 강의 CMS와 비공개 파일 업로드 연결

각 단계에서 로딩, 빈 상태, 권한 없음, 네트워크 오류, 재시도 UI를 함께 구현합니다.
