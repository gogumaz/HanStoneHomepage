# 바둑게임 에디터 제작·운영 및 서버 설치 매뉴얼

기준일: 2026-08-26

이 문서는 9·13·19줄 교육용 바둑문제를 제작하는 에디터의 구조, 현재 구현된
`/admin/missions` 사용법, 로컬 개발 서버 설치, Docker 기반 운영 배포 절차를 설명합니다.
현재 제품은 자유대국이나 범용 바둑 AI가 아니라 **초기 판 + 정답 수순 트리 + 서버 판정**으로
동작하는 사용자 착수형 바둑미션 시스템입니다.

## 1. 시스템 구성

```text
운영자 브라우저
  └─ React 문제 입력기 /admin/missions
       ├─ GoBoard: 9·13·19줄 초기 판 편집
       ├─ 수순 트리 JSON 편집
       └─ 저장·자동검수·미리보기·게시
             ↓ /api/v1/admin/missions
NestJS API
  ├─ MissionAdminService: 작성·검수·게시·통계
  ├─ Go Engine: 착수·따냄·자충·패·수순 판정
  └─ Prisma
       ↓
PostgreSQL
  ├─ BadukMission과 버전
  ├─ MissionAttempt와 MissionMove
  └─ 보상·즐겨찾기·감사로그
```

주요 구현 파일:

| 영역 | 파일 |
|---|---|
| 관리자 입력기 | `src/features/mission/AdminMissionPage.tsx` |
| 바둑판 UI | `src/features/mission/GoBoard.tsx` |
| 프런트 API 계약 | `src/features/mission/api.ts` |
| 관리자 API | `server/src/mission/mission.controller.ts` |
| 작성·검수 서비스 | `server/src/mission/mission-admin.service.ts` |
| 게임 규칙·수순 엔진 | `server/src/mission/go-engine.ts` |
| 데이터 모델 | `server/prisma/schema.prisma` |

## 2. 에디터를 만드는 방법

### 2.1 문제를 이미지가 아닌 데이터로 저장

바둑판 캡처 이미지만 저장하면 좌표 수정, 자동채점, 모바일 확대, 통계 처리가 어렵습니다.
따라서 한 문제를 다음 데이터로 분리합니다.

```text
기본정보
  + 판 크기와 초기 흑·백돌
  + 사용자 돌 색상
  + 정답·허용·금지 수가 포함된 수순 트리
  + 힌트·해설·오답 피드백
  + 배점·제한시간·재도전 제한
  + 공개 상태와 보상
```

내부 좌표는 좌상단이 `(0, 0)`입니다. 9줄이면 `0~8`, 13줄이면 `0~12`,
19줄이면 `0~18`만 허용합니다. 흑돌과 백돌이 같은 좌표를 공유할 수 없습니다.

### 2.2 에디터 화면 구성

에디터는 다음 다섯 영역으로 구성하는 것이 안전합니다.

1. 기본정보: 제목, 지시문, 과정·권·강, 문제군, 난이도, 유형
2. 초기 판: 9·13·19줄 선택과 흑돌·백돌·삭제 도구
3. 정답 수순: 대표 정답, 금지 수, 상대 자동 응수, 분기
4. 학습 설정: 힌트, 해설, 점수, 시간, 오답 제한, 보상
5. 검수: 임시저장, 자동검수, 기록 없는 미리보기, 게시

초기 판 편집에는 최소한 다음 도구가 필요합니다.

- `흑돌`: 교차점에 초기 흑돌 배치
- `백돌`: 교차점에 초기 백돌 배치
- `삭제`: 선택 좌표의 돌 삭제
- `대표 정답`: 현재 사용자 노드에 정답 좌표 추가
- `금지 수`: 별도 오답 피드백을 줄 좌표 추가
- `초기 판 지우기`: 초기 돌 전체 삭제

판 크기를 줄일 때 새 범위 밖에 돌이 있으면 자동 삭제하지 말고 변경을 중단해야 합니다.
현재 입력기도 충돌 좌표를 확인한 뒤 판 크기를 변경합니다.

### 2.3 게임 상태와 서버 판정

브라우저는 클릭 위치를 좌표로 변환하고 후보 수를 보여주지만 최종 정답은 서버가 판정합니다.

```text
사용자 착수 후보
  → 판 밖·중복 착점 1차 확인
  → 서버에 attemptId, 좌표, moveNumber, boardHash 전송
  → 서버가 따냄·자충·패와 수순 트리를 검증
      ├─ illegal: 불법 수
      ├─ forbidden: 관리자가 지정한 금지 수
      ├─ incorrect: 합법이지만 정답 경로가 아님
      ├─ acceptable: 허용 변화도
      └─ correct: 대표 정답
  → 상대 자동 응수 실행
  → 다음 사용자 노드 또는 성공 노드
```

`boardHash`, `missionVersion`, `expectedMoveNumber`, `clientMoveId`를 함께 사용하면
중복 클릭, 오래된 화면, 네트워크 재시도로 결과가 중복 저장되는 문제를 막을 수 있습니다.

### 2.4 데이터베이스와 보안 원칙

- 공개 문제 응답에는 전체 정답 트리를 포함하지 않습니다.
- 전체 `solutionTree`는 운영자·관리자 API에서만 반환합니다.
- 작성·수정·게시 API는 `operator` 또는 `admin` 역할만 허용합니다.
- 공개된 문제를 수정하면 버전을 증가시키고 기존 시도는 시작 버전을 유지합니다.
- 게시·수정 작업자는 감사로그에 남깁니다.
- 브라우저가 계산한 점수와 완료 상태를 신뢰하지 않습니다.
- 삭제 대신 `archived` 상태를 사용해 기존 학습기록과 참조를 보존합니다.

## 3. 현재 바둑문제 입력기 사용법

### 3.1 접속 조건

1. 웹과 API가 모두 실행 중이어야 합니다.
2. `operator` 또는 `admin` 역할의 계정으로 로그인합니다.
3. 브라우저에서 `http://127.0.0.1:5173/admin/missions`로 이동합니다.

공개 회원가입은 `student`, `guardian` 역할만 허용합니다. 운영 권한을 회원가입 요청이나
브라우저 입력값으로 부여하면 안 됩니다. 로컬 개발에서는 회원가입 후 Prisma Studio에서
승인된 계정에 `UserRoleAssignment`의 `OPERATOR` 역할을 추가할 수 있습니다.

```powershell
npm --prefix server run db:studio
```

역할 행의 ID가 필요하면 PowerShell에서 `[guid]::NewGuid()`로 UUID를 생성합니다. 역할 변경 뒤에는
기존 세션을 로그아웃하고 다시 로그인합니다. 스테이징·운영에서는 Prisma Studio를 외부에 열지 말고,
승인·기록이 남는 관리자 계정 발급 절차 또는 제한된 DBA 작업으로만 권한을 부여합니다.

### 3.2 첫 문제 만들기

1. 상단의 `새 문제`를 선택합니다.
2. 제목과 문제 지시문을 입력합니다.
3. 과정, 권, 강, 문제군, 카테고리와 난이도를 선택합니다.
4. 사용자 착수 색상과 문제 유형을 선택합니다.
5. `9줄`, `13줄`, `19줄` 중 하나를 선택합니다.
6. 흑돌·백돌 도구로 초기 판을 구성합니다.
7. 한 수 문제는 `대표 정답` 도구를 선택한 뒤 정답 교차점을 클릭합니다.
8. 힌트를 단계별로 한 줄씩 입력하고 정답 해설을 작성합니다.
9. 배점, 제한시간, 오답 제한과 별 보상을 확인합니다.
10. `임시저장`을 누릅니다.
11. `자동검수`를 통과시킵니다.
12. `기록 없는 미리보기`에서 직접 착수해 정답·오답·상대 응수를 확인합니다.
13. 검수가 끝나면 `게시`를 누릅니다.

`문제 ID`를 비우면 서버가 생성합니다. 외부 교재나 기존 CMS와 안정적으로 연결해야 할 때만
영문, 숫자, 하이픈으로 된 관리 ID를 사용하고, 문제 생성 후에는 ID를 변경하지 않습니다.

### 3.3 한 수 정답 예제

사용자가 `(3, 4)`에 두면 바로 성공하는 문제입니다.

```json
{
  "rootNodeId": "root",
  "nodes": {
    "root": {
      "actor": "player",
      "acceptedMoves": [
        { "x": 3, "y": 4, "result": "correct", "nextNodeId": "done" }
      ],
      "forbiddenMoves": [
        { "x": 2, "y": 4, "feedbackId": "incorrect" }
      ]
    },
    "done": { "terminal": "success" }
  }
}
```

`acceptedMoves`에 없는 합법 수는 기본 오답으로 판정됩니다. `forbiddenMoves`는 돌을 놓지 않고
즉시 전용 판정을 반환합니다. 현재 화면에서 작성한 기본 오답 피드백 키는 `incorrect`입니다.

### 3.4 상대 자동 응수가 있는 여러 수 문제

사용자 흑 `(2, 2)` → 상대 백 `(3, 2)` → 사용자 흑 `(2, 3)` 순으로 성공하는 예제입니다.

```json
{
  "rootNodeId": "root",
  "nodes": {
    "root": {
      "actor": "player",
      "acceptedMoves": [
        { "x": 2, "y": 2, "result": "correct", "nextNodeId": "reply-1" }
      ]
    },
    "reply-1": {
      "actor": "opponent",
      "move": { "color": "white", "x": 3, "y": 2 },
      "nextNodeId": "player-2"
    },
    "player-2": {
      "actor": "player",
      "acceptedMoves": [
        { "x": 2, "y": 3, "result": "correct", "nextNodeId": "done" }
      ]
    },
    "done": { "terminal": "success" }
  }
}
```

사용자 색상이 백이면 상대 응수의 `color`는 `black`이어야 합니다. 상대 응수 좌표도 해당 시점의
판에서 합법이어야 합니다.

### 3.5 복수 정답과 허용 변화도

한 사용자 노드의 `acceptedMoves`에 여러 좌표를 넣습니다. 대표 정답은 `correct`, 교육적으로
허용하지만 대표 수가 아닌 변화도는 `acceptable`을 사용합니다.

```json
{
  "rootNodeId": "root",
  "nodes": {
    "root": {
      "actor": "player",
      "acceptedMoves": [
        { "x": 4, "y": 4, "result": "correct", "nextNodeId": "best-done" },
        { "x": 5, "y": 4, "result": "acceptable", "nextNodeId": "allowed-reply" }
      ]
    },
    "allowed-reply": {
      "actor": "opponent",
      "move": { "color": "white", "x": 5, "y": 5 },
      "nextNodeId": "allowed-done"
    },
    "best-done": { "terminal": "success" },
    "allowed-done": { "terminal": "success" }
  }
}
```

모든 노드는 루트에서 도달 가능해야 하고, 최소 한 개의 `success` 노드가 있어야 하며,
노드가 자기 자신이나 이전 노드로 되돌아가는 순환 구조를 만들면 안 됩니다.

### 3.6 자동검수 항목

자동검수는 다음 오류를 찾아냅니다.

- 9·13·19 이외의 판 크기
- 판 밖 좌표와 초기 돌 중복
- 시작 노드 또는 참조 노드 누락
- 사용자 노드의 정답 착수 누락
- 불법 정답 수, 자충, 패 위반
- 사용자 색상과 같은 색의 상대 응수
- 수순 순환과 도달할 수 없는 노드
- 성공으로 끝나는 경로 누락

문법이 올바른 JSON이어도 바둑 규칙상 불가능한 수순이면 게시할 수 없습니다. 저장 후 반드시
`자동검수`와 `기록 없는 미리보기`를 모두 실행합니다.

### 3.7 상태 운영

| 상태 | 의미 |
|---|---|
| `draft` | 작성 중, 사용자에게 비공개 |
| `pending_review` | 운영 검수 대기 |
| `scheduled` | 예약 공개 대기 |
| `published` | 사용자에게 공개 가능 |
| `archived` | 신규 노출 중단, 기존 기록 보존 |

현재 입력기 화면은 임시저장·자동검수·미리보기·즉시 게시를 제공합니다. 검수 요청, 예약 게시,
보관 처리는 서버 API에도 준비되어 있으며 조직의 승인 흐름에 맞춘 운영 화면에서 연결할 수 있습니다.

## 4. 관리자·사용자 API

API 기본 주소는 `http://127.0.0.1:3000/api/v1`입니다.

| 메서드·경로 | 용도 | 권한 |
|---|---|---|
| `GET /missions` | 공개 문제 목록 | 선택 세션 |
| `GET /missions/{id}` | 문제와 이어하기 상태 | 선택 세션 |
| `POST /missions/{id}/attempts` | 풀이 시작 | 선택 세션 |
| `POST /mission-attempts/{id}/moves` | 착수 서버 판정 | 시도 소유자 |
| `POST /mission-attempts/{id}/hints` | 힌트 사용 | 시도 소유자 |
| `POST /mission-attempts/{id}/retry` | 재도전 | 시도 소유자 |
| `GET /admin/missions` | 문제은행 목록 | 운영자·관리자 |
| `POST /admin/missions` | 문제 생성 | 운영자·관리자 |
| `PATCH /admin/missions/{id}` | 문제 수정 | 운영자·관리자 |
| `POST /admin/missions/{id}/validate` | 자동검수 | 운영자·관리자 |
| `POST /admin/missions/{id}/preview` | 기록 없는 미리보기 | 운영자·관리자 |
| `POST /admin/missions/{id}/request-review` | 검수 요청 | 운영자·관리자 |
| `POST /admin/missions/{id}/publish` | 즉시·예약 게시 | 운영자·관리자 |
| `POST /admin/missions/{id}/archive` | 보관 처리 | 운영자·관리자 |
| `GET /admin/missions/{id}/statistics` | 학습 통계 | 운영자·관리자 |

브라우저 세션을 사용하는 변경 API는 허용된 `Origin`에서만 요청해야 합니다. API를 별도 도메인에
배포하면 `CORS_ORIGINS`, `PUBLIC_APP_URL`, 쿠키와 HTTPS 설정을 함께 맞춥니다.

## 5. 로컬 서버 설치

### 5.1 준비 프로그램

- Node.js 24 LTS
- npm
- Git
- Docker Desktop 또는 Docker Engine과 Compose v2
- Windows PowerShell 7 이상 또는 Linux 셸

프로젝트만 실행할 때 PostgreSQL과 Redis는 Docker로 구동할 수 있으므로 호스트에 직접 설치할
필요가 없습니다.

### 5.2 Windows PowerShell 설치

프로젝트 루트 `F:\Home Page`를 예로 듭니다.

```powershell
Set-Location -LiteralPath 'F:\Home Page'
npm ci
npm --prefix server ci
Copy-Item -LiteralPath server/.env.example -Destination server/.env
docker compose up -d database redis
npm --prefix server run db:deploy
```

첫 번째 터미널에서 API를 실행합니다.

```powershell
npm run dev:api
```

두 번째 터미널에서 웹을 실행합니다.

```powershell
npm run dev:web
```

접속 주소:

- 웹: `http://127.0.0.1:5173`
- 계정: `http://127.0.0.1:5173/account`
- 문제 입력기: `http://127.0.0.1:5173/admin/missions`
- 사용자 문제 목록: `http://127.0.0.1:5173/missions`
- API 준비 상태: `http://127.0.0.1:3000/api/v1/health/ready`

상태 확인:

```powershell
Invoke-RestMethod http://127.0.0.1:3000/api/v1/health/live
Invoke-RestMethod http://127.0.0.1:3000/api/v1/health/ready
docker compose ps
```

### 5.3 Linux 설치

```bash
git clone <저장소 주소> baduk-history
cd baduk-history
npm ci
npm --prefix server ci
cp server/.env.example server/.env
docker compose up -d database redis
npm --prefix server run db:deploy
```

개발 중에는 두 셸에서 각각 실행합니다.

```bash
npm run dev:api
npm run dev:web
```

### 5.4 전체 로컬 Docker 실행

호스트 Node 프로세스 대신 API까지 컨테이너로 실행하려면 먼저 마이그레이션을 적용하고 전체
Compose를 시작합니다.

```powershell
docker compose up -d database redis
npm --prefix server run db:deploy
docker compose up -d --build api inquiry-notification-worker
docker compose ps
docker compose logs --tail 100 api
```

영상 업로드·HLS·악성파일 검사까지 검증할 때만 선택 프로필을 추가합니다.

```powershell
docker compose --profile malware-scan up -d --build clamav video-scan-worker hls-transcode-worker video-cleanup-worker
```

바둑문제 에디터 자체는 객체 저장소, FFmpeg, ClamAV, OAuth, 토스 키 없이도 로컬에서 개발할 수
있습니다. 해당 환경변수는 관련 기능을 통합 검증할 때 설정합니다.

## 6. 설치 후 검증

```powershell
npm run typecheck
npm test
npm --prefix server run typecheck
npm --prefix server test
npm run build:web
npm --prefix server run build
npm run test:e2e
```

DB 마이그레이션과 관계·제약조건을 실제 PostgreSQL에서 점검하려면 다음 명령을 추가합니다.

```powershell
npm --prefix server run smoke:database
```

검증이 끝나면 다음 흐름을 수동 확인합니다.

1. 운영자 로그인 후 `/admin/missions`가 열립니다.
2. 9줄 한 수 문제를 저장합니다.
3. 자동검수가 `valid: true`를 반환합니다.
4. 미리보기에서 정답과 오답이 구분됩니다.
5. 게시 후 `/missions`에 공개 문제가 표시됩니다.
6. 13줄과 19줄에서도 돌과 클릭 교차점이 일치합니다.
7. 모바일 확대·스크롤 중에는 의도하지 않은 착수가 발생하지 않습니다.

## 7. 운영 서버 설치

### 7.1 권장 배치

```text
정적 웹 호스팅/CDN
  └─ dist, app.html fallback, config.js

HTTPS 로드밸런서 또는 리버스 프록시
  └─ API 컨테이너 127.0.0.1:3000
       ├─ 관리형 PostgreSQL
       ├─ 관리형 Redis
       ├─ 비공개 객체 저장소와 선택적 CloudFront
       ├─ SMTP
       └─ 독립 워커 컨테이너
```

운영에서는 PostgreSQL과 Redis를 API 호스트의 단일 컨테이너에 종속시키지 말고 백업·PITR·장애
조치가 가능한 관리형 서비스를 권장합니다. API 포트는 외부에 직접 공개하지 않고 HTTPS 프록시
뒤에서만 접근시킵니다.

### 7.2 API 이미지 생성

```bash
export RELEASE_SHA=$(git rev-parse HEAD)
docker build -t registry.example.com/baduk-history-api:${RELEASE_SHA} ./server
docker push registry.example.com/baduk-history-api:${RELEASE_SHA}
```

레지스트리가 반환한 `repository@sha256:<digest>`를 기록하고
`deploy/production.env`의 `API_IMAGE`에 태그가 아닌 불변 digest 참조를 넣습니다.

```bash
cp deploy/production.env.example deploy/production.env
chmod 600 deploy/production.env
```

`deploy/production.env`에는 최소한 다음 운영값이 필요합니다.

- `DATABASE_URL`, `RATE_LIMIT_REDIS_URL`
- `PUBLIC_APP_URL`, `CORS_ORIGINS`
- `SMTP_*`, `MAIL_FROM`, `ACCOUNT_MAIL_ENCRYPTION_KEY_BASE64`
- 객체 저장소와 ClamAV 설정
- OAuth를 운영할 경우 제공사별 ID·Secret·Redirect URI
- 결제를 운영할 경우 `TOSS_PAYMENTS_SECRET_KEY`
- 배포 커밋 SHA와 이미지 digest
- PITR·버전 관리·복구훈련 증빙값

Secret은 저장소의 `config.js`, Docker 이미지, 로그, 문서에 넣지 않습니다.

### 7.3 DB 적용과 프리플라이트

```bash
docker compose --env-file deploy/production.env \
  -f deploy/compose.production.yaml run --rm api npm run db:deploy

docker compose --env-file deploy/production.env \
  -f deploy/compose.production.yaml run --rm api node dist/production-preflight.js
```

프리플라이트 결과의 `ok`가 `true`이고 모든 필수 검사가 `pass`일 때만 배포합니다. 마이그레이션은
동시에 여러 인스턴스에서 실행하지 말고 배포 작업에서 한 번만 실행합니다.

### 7.4 API와 워커 기동

```bash
docker compose --env-file deploy/production.env \
  -f deploy/compose.production.yaml up -d

docker compose --env-file deploy/production.env \
  -f deploy/compose.production.yaml ps
```

API 준비 상태를 HTTPS 주소로 확인합니다.

```bash
curl --fail --silent https://api.example.com/api/v1/health/live
curl --fail --silent https://api.example.com/api/v1/health/ready
```

### 7.5 정적 웹 배포

```bash
npm ci
npm run build:web
npm run verify:web-artifacts
```

`dist`를 정적 호스팅에 배포합니다. 운영 `config.js`에는 공개 가능한 API 주소와 OAuth 제공사,
토스 공개 클라이언트 키만 넣습니다. React 직접 경로인 `/account`, `/missions`, `/admin/*` 등을
`app.html`로 rewrite해야 합니다.

캐시 정책:

- `dist/assets/*`: `public, max-age=31536000, immutable`
- HTML과 `config.js`: `public, max-age=0, must-revalidate`
- 정적 호스팅에도 프로젝트의 CSP, HSTS, `nosniff`, 프레이밍 차단 헤더 적용

### 7.6 운영 확인과 롤백

배포 직후 다음을 확인합니다.

1. API liveness와 readiness
2. 운영자 로그인과 문제은행 조회
3. 기존 공개 문제 풀이와 새 시도 저장
4. 문제 임시저장·자동검수·미리보기
5. 워커 상태와 오류율
6. DB 백업과 복구 지점 생성 여부

DB 마이그레이션은 되돌리지 않습니다. 문제가 생기면 호환되는 직전 불변 API 이미지로 되돌리고,
필요한 DB 수정은 새 전진 마이그레이션으로 적용합니다. 운영 배포·복구·인수 증빙의 전체 절차는
`deploy/README.md`를 따릅니다.

## 8. 백업과 운영 관리

- PostgreSQL PITR 활성화와 최소 30일 백업 보존
- 객체 저장소 버전 관리와 공개 접근 차단
- 분기별 격리 복원 훈련
- 문제 게시·수정·보관 감사로그 검토
- 운영자 계정 최소 권한과 정기 접근권한 검토
- 공개 문제 변경 전 기록 없는 미리보기와 모바일 검증
- 변경 전후 문제 버전과 정답률 이상 여부 확인

문제 데이터는 DB 백업에 포함되지만, 교재·영상 연결 자산은 객체 저장소 백업과 버전 관리도 함께
필요합니다.

## 9. 장애 해결

| 증상 | 확인 사항 |
|---|---|
| `/admin/missions`가 401 | 로그인 세션, 쿠키, API 주소 확인 |
| 403 권한 오류 | 계정에 `OPERATOR` 또는 `ADMIN` 역할이 있는지 확인 |
| API가 준비되지 않음 | PostgreSQL 연결, 마이그레이션, `DATABASE_URL` 확인 |
| 저장 시 JSON 오류 | 따옴표·쉼표·중괄호와 `rootNodeId` 확인 |
| 자동검수 실패 | 응답의 첫 오류와 전체 `errors` 목록 확인 |
| 정답 수가 불법 | 초기 돌 중복, 자충, 패, 좌표 범위 확인 |
| 상대 응수 색상 오류 | 사용자 흑이면 상대 백, 사용자 백이면 상대 흑으로 설정 |
| 성공 경로 없음 | 도달 가능한 `{ "terminal": "success" }` 노드 추가 |
| 공개 문제 목록에 안 보임 | `published` 상태, 공개시각, 무료/구독 권한 확인 |
| 웹에서 API 호출 실패 | Vite proxy 또는 운영 `apiBaseUrl`, CORS, HTTPS 확인 |
| 직접 URL 새로고침 404 | 정적 호스팅의 `app.html` rewrite 규칙 확인 |

로그 확인:

```powershell
docker compose logs --tail 200 api
docker compose logs --tail 200 database
docker compose logs --tail 200 redis
```

운영 로그에는 세션, 비밀번호, OAuth Secret, 결제 Secret, 전체 문제 정답 트리를 출력하지 않습니다.

## 10. 완료 체크리스트

### 에디터

- [ ] 9·13·19줄 전환과 좌표 충돌 차단
- [ ] 초기 흑·백돌 추가·삭제
- [ ] 단일 정답과 복수 정답
- [ ] 상대 자동 응수와 여러 수 분기
- [ ] 금지 수와 오답 피드백
- [ ] 합법 수·자충·패 자동검수
- [ ] 기록 없는 미리보기
- [ ] 임시저장·검수·게시·보관
- [ ] 문제 버전과 감사로그
- [ ] 모바일 확대·스크롤·터치 검증

### 서버

- [ ] Node.js 24, Docker, 의존성 설치
- [ ] PostgreSQL·Redis 연결
- [ ] Prisma 마이그레이션 적용
- [ ] API live·ready 통과
- [ ] 운영자 계정과 최소 권한 적용
- [ ] 웹 `app.html` rewrite와 HTTPS 적용
- [ ] 전체 테스트·빌드 통과
- [ ] 운영 프리플라이트 통과
- [ ] DB 백업·PITR·복구훈련 준비
- [ ] 배포·롤백 절차와 증빙 보관

기능 상세 기획은 `docs/BADUK_MISSION_GAME.md`, 전체 개발환경은
`docs/DEVELOPMENT_GUIDE.md`, 운영 배포와 복구 절차는 `deploy/README.md`를 함께 참고합니다.
