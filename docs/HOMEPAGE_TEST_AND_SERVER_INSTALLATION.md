# 홈페이지 테스트 및 서버 설치 매뉴얼

문서 버전: 1.0
작성 기준일: 2026-09-02
대상 서비스: 바둑타고 한국사 여행 홈페이지·React 웹·NestJS API

## 1. 목적과 권장 실행 순서

이 문서는 새 PC 또는 새 서버에서 다음 작업을 재현하기 위한 절차입니다.

1. 홈페이지를 빠르게 실행해 화면을 확인합니다.
2. 웹·API 자동 테스트와 브라우저 테스트를 실행합니다.
3. 로컬 PostgreSQL·Redis와 API 서버를 설치합니다.
4. 필요할 때 전체 구성을 Docker로 실행합니다.
5. 운영 서버 설치 전 필수 보안·배포 검사를 수행합니다.

로컬 확인은 `4173`(웹), `3000`(API), `5432`(PostgreSQL), `6379`(Redis) 포트를 기본값으로 사용합니다. Windows에서 Vite 기본 포트 `5173` 또는 PostgreSQL 기본 포트 `5432`가 예약돼 `EACCES`가 발생할 수 있으므로 웹은 `4173`, PostgreSQL 충돌 시에는 `55432`를 사용합니다. Compose의 호스트 포트는 `API_HOST_PORT`, `POSTGRES_HOST_PORT`, `REDIS_HOST_PORT`, `CLAMAV_HOST_PORT`로 재지정할 수 있습니다.

## 2. 준비 사항

### 2.1 필수 프로그램

| 프로그램 | 기준 | 확인 명령 |
|---|---:|---|
| Git | 최신 안정 버전 | `git --version` |
| Node.js | 24 LTS | `node --version` |
| npm | Node.js 24 동봉 버전 | `npm --version` |
| Docker Desktop 또는 Docker Engine | Compose 포함 | `docker --version` |
| Docker Compose | v2 이상 | `docker compose version` |

브라우저 자동 테스트에는 Playwright가 관리하는 Chromium·Firefox·WebKit이 추가로 필요합니다.

### 2.2 저장소 받기

```powershell
git clone https://github.com/gogumaz/HanStoneHomepage.git
Set-Location HanStoneHomepage
```

이미 저장소가 있으면 프로젝트 루트에서 아래 절차를 시작합니다.

### 2.3 의존성 설치

웹과 API는 잠금 파일이 분리되어 있으므로 둘 다 설치합니다.

```powershell
npm ci
npm --prefix server ci
npx playwright install chromium firefox webkit
```

Linux CI 또는 브라우저 라이브러리가 없는 서버에서는 다음 명령을 사용합니다.

```bash
npx playwright install --with-deps chromium firefox webkit
```

## 3. 홈페이지 빠른 실행—로컬 PC 전용

API 없이 화면과 정적 콘텐츠만 먼저 확인하려면 다음 명령을 실행합니다.

```powershell
npm run dev:web -- --port 4173 --strictPort
```

이 명령은 실행한 PC의 `127.0.0.1`에만 개발 서버를 엽니다. 같은 PC의 브라우저에서만
`http://127.0.0.1:4173/...` 주소를 사용합니다. `www.uzdream.com:4173`은 원격 PHPS 서버의
4173 포트를 뜻하므로 이 명령으로는 접속할 수 없습니다. 운영 서버에서는 4173 포트를 열거나
Vite 개발 서버를 계속 실행하지 않고, 빌드 결과를 Nginx의 80·443 포트로 제공합니다.

명령을 실행한 같은 PC의 브라우저에서 다음 주소를 확인합니다.

| 주소 | 확인 대상 | API 필요 여부 |
|---|---|---|
| `http://127.0.0.1:4173/index.html` | 기존 홈페이지 | 일부 기능만 필요 |
| `http://127.0.0.1:4173/app.html` | React 전환 진입 화면 | 일부 기능만 필요 |
| `http://127.0.0.1:4173/account` | 회원가입·로그인 | 필요 |
| `http://127.0.0.1:4173/guardian` | 보호자 연결·학습 리포트 | 필요 |
| `http://127.0.0.1:4173/lessons` | 공개 강의 목록·상세 | 필요 |
| `http://127.0.0.1:4173/dashboard` | 학생 여행지도·진도 | 필요 |
| `http://127.0.0.1:4173/missions` | 바둑미션 목록·풀이 | 필요 |
| `http://127.0.0.1:4173/admin/lessons` | 운영자 강의 관리 | 필요 |

종료할 때는 실행한 터미널에서 `Ctrl+C`를 누릅니다.

PHPS 서버 IP `115.71.237.88`과 `uzdream.com`을 이용한 실제 배포·브라우저 확인 절차는
[uzdream.com PHPS 서버 호스팅 테스트 매뉴얼](./UZDREAM_PHPS_HOSTING_TEST_MANUAL.md)을
따릅니다.

## 4. 로컬 API 서버 설치

개발 시에는 PostgreSQL과 Redis만 Docker로 실행하고 API는 Node.js로 실행하는 구성을 권장합니다. 코드 변경이 즉시 반영되어 문제를 확인하기 쉽습니다.

### 4.1 데이터베이스와 Redis 실행

기본 포트를 사용할 수 있으면 다음 명령을 실행합니다.

```powershell
docker compose up -d database redis
docker compose ps
```

Windows에서 `5432` 바인딩이 거부되면 현재 PowerShell 세션에 대체 포트를 지정하고 다시 실행합니다.

```powershell
$env:POSTGRES_HOST_PORT = "55432"
docker compose up -d database redis
```

두 컨테이너의 상태가 `healthy`가 될 때까지 기다립니다.

### 4.2 개발 환경 파일 준비

```powershell
Copy-Item server/.env.example server/.env
```

`server/.env`에서 로컬 웹 주소를 다음처럼 맞춥니다.

```dotenv
CORS_ORIGINS=http://127.0.0.1:4173,http://localhost:4173
PUBLIC_APP_URL=http://127.0.0.1:4173
```

`POSTGRES_HOST_PORT=55432`를 사용했다면 같은 파일의 DB 주소도 호스트 포트에 맞춥니다.

```dotenv
DATABASE_URL=postgresql://baduk:baduk-local-password@127.0.0.1:55432/baduk_history?schema=public
```

`.env`는 Git에 커밋하지 않습니다. SMTP·OAuth·토스페이먼츠·객체 저장소를 사용하지 않는 기본 로컬 검증에서는 해당 값들을 비워 둘 수 있습니다. 실제 연동 시험을 할 때만 테스트 자격증명을 입력합니다.

### 4.3 DB 마이그레이션

```powershell
npm --prefix server run prisma:validate
npm --prefix server run db:deploy
```

### 4.4 API와 웹 실행

터미널 1에서 API를 실행합니다.

```powershell
npm run dev:api
```

터미널 2에서 웹을 실행합니다.

```powershell
npm run dev:web -- --port 4173 --strictPort
```

Vite는 `/api` 요청을 `http://127.0.0.1:3000`으로 전달합니다.

### 4.5 서버 상태 확인

```powershell
Invoke-RestMethod http://127.0.0.1:3000/api/v1/health/live
Invoke-RestMethod http://127.0.0.1:3000/api/v1/health/ready
```

두 응답이 성공해야 합니다. `live`만 성공하고 `ready`가 실패하면 PostgreSQL·Redis 연결과 마이그레이션 상태를 먼저 확인합니다.

## 5. Docker로 전체 로컬 서버 설치

Node.js API를 직접 실행하지 않고 컨테이너로 확인할 때 사용합니다.

```powershell
docker compose up -d database redis
docker compose build api
docker compose run --rm api npm run db:deploy
docker compose up -d api inquiry-notification-worker
docker compose ps
```

로그 확인:

```powershell
docker compose logs --tail 100 api
docker compose logs --tail 100 inquiry-notification-worker
```

API 상태 확인:

```powershell
Invoke-RestMethod http://127.0.0.1:3000/api/v1/health/ready
```

영상 업로드·악성코드 검사·HLS 변환까지 시험하려면 객체 저장소 테스트 값을 준비한 뒤 다음 프로필을 추가로 실행합니다.

```powershell
docker compose --profile malware-scan up -d clamav video-scan-worker hls-transcode-worker video-cleanup-worker
```

일반 홈페이지 확인에는 이 프로필이 필요하지 않습니다.

## 6. 홈페이지 수동 테스트

### 6.1 기본 확인 항목

- 브라우저 콘솔에 처리되지 않은 JavaScript 오류가 없는지 확인합니다.
- 개발자 도구 Network 탭에서 HTML·CSS·JavaScript·이미지가 `200` 또는 정상 캐시 응답인지 확인합니다.
- 상단 메뉴, 본문 바로가기, 로그인·체험 버튼과 주요 링크가 올바른 화면으로 이동하는지 확인합니다.
- 모달을 열고 닫았을 때 키보드 포커스가 원래 버튼으로 돌아오는지 확인합니다.
- 필수 입력값이 비어 있을 때 요청을 보내지 않고 오류 안내가 표시되는지 확인합니다.
- 로그인하지 않은 사용자가 운영자·보호자 전용 화면에 접근할 수 없는지 확인합니다.
- API 오류가 발생해도 입력값이 보존되고 재시도 안내가 표시되는지 확인합니다.

### 6.2 반응형 확인 규격

브라우저 개발자 도구에서 다음 화면 크기를 확인합니다.

| 구분 | 화면 크기 |
|---|---:|
| 소형 모바일 | 360 × 800 |
| 일반 모바일 | 390 × 844 |
| 태블릿 세로 | 768 × 1024 |
| 태블릿 가로 | 1024 × 768 |
| 데스크톱 | 1440 × 900 |
| 대형 데스크톱 | 1920 × 1080 |

가로 스크롤, 잘린 버튼, 겹친 글자, 화면 밖 모달이 없어야 합니다. 브라우저 확대 200%에서도 주요 콘텐츠와 조작 기능을 사용할 수 있어야 합니다.

### 6.3 핵심 사용자 흐름

1. 홈페이지 진입과 메뉴 이동
2. 회원가입·이메일 인증·로그인·로그아웃
3. 공개 강의 목록과 강의 상세 조회
4. 바둑미션 선택·착수·힌트·완료
5. 학생 진도 저장과 대시보드 반영
6. 보호자 연결과 학생 학습 리포트 조회
7. 구독 주문·테스트 결제·결과 화면
8. 운영자 강의·문의·상담·결제 관리

SMTP·OAuth·결제는 반드시 공급자의 테스트 환경과 테스트 계정을 사용합니다.

## 7. 자동 테스트 실행

### 7.1 웹 단위 테스트와 빌드

```powershell
npm run typecheck
npm test
npm run build:web
npm run verify:web-artifacts
```

### 7.2 API 테스트와 빌드

```powershell
npm --prefix server run prisma:validate
npm --prefix server run typecheck
npm --prefix server test
npm --prefix server run build
npm --prefix server run verify:runtime-artifacts
```

### 7.3 DB 통합 스모크 테스트

```powershell
docker compose up -d database redis
npm --prefix server run db:deploy
npm --prefix server run smoke:database
```

이 검사는 트랜잭션 안에서 핵심 관계와 제약조건을 확인한 뒤 롤백하므로 시험 데이터를 남기지 않습니다.

### 7.4 브라우저 E2E 테스트

Playwright가 웹 서버를 `4173` 포트에 자동으로 시작하므로 같은 포트의 개발 서버를 먼저 종료합니다.

```powershell
npm run test:e2e
```

분야별 실행:

```powershell
npm run test:e2e:navigation
npm run test:e2e:responsive
npm run test:e2e:accessibility
npm run test:e2e:field
npm run test:e2e:performance
```

### 7.5 전체 회귀 검증

```powershell
npm run ci
```

`npm run ci`는 타입검사, 웹·API 단위 테스트, 웹·API 운영 빌드, 산출물 검사와 통합 컴포넌트 패키징을 실행합니다. 브라우저 E2E와 성능 검사는 별도 명령이므로 릴리스 후보에서는 세 명령을 모두 실행합니다.

```powershell
npm run ci
npm run test:e2e
npm run test:e2e:performance
```

모든 명령의 종료 코드가 `0`이어야 통과입니다. 실패 상황을 의도적으로 검증하는 테스트에서는 경고·오류 로그가 출력될 수 있으므로 개별 로그 문구가 아니라 최종 테스트 수와 종료 코드를 기준으로 판정합니다.

## 8. 테스트 결과 확인과 보관

- Vitest는 통과·실패 파일 수와 테스트 수를 터미널에 출력합니다.
- Playwright 실패 시 `test-results/`에 스크린샷·추적 파일이 저장됩니다.
- 현장 검증 보고서는 `test-results/field-validation-report.json`에 생성될 수 있습니다.
- `dist/`에는 운영용 웹 빌드가 생성됩니다.
- `server/dist/`에는 운영용 API 빌드가 생성됩니다.
- 비밀번호, 토큰, `.env` 원문과 개인정보가 포함된 화면 캡처는 테스트 증빙에 넣지 않습니다.

## 9. 운영 서버 설치 개요

운영 설치는 단일 PC의 로컬 Docker 실행과 다릅니다. 다음 외부 구성이 먼저 준비돼야 합니다.

- TLS가 적용된 관리형 PostgreSQL과 Redis
- 비공개 객체 저장소, CDN, 인증서와 운영 도메인
- SMTP 계정과 SPF·DKIM·DMARC 레코드
- 운영 OAuth 앱과 토스페이먼츠 운영 키
- 컨테이너 레지스트리와 불변 이미지 digest
- 백업·PITR·격리 복구 DB와 악성코드 검사 서비스

### 9.1 API 이미지 준비

```powershell
docker build -t <registry>/<owner>/<image>:<commit-sha> server
docker push <registry>/<owner>/<image>:<commit-sha>
```

레지스트리가 반환한 `<registry>/<owner>/<image>@sha256:<64자리>` 값을 기록합니다. 운영 `API_IMAGE`에는 태그가 아니라 이 불변 digest 참조만 사용합니다.

### 9.2 운영 환경 파일

`deploy/production.env.example`을 참고하되 실제 파일은 저장소 밖의 제한된 경로에 작성합니다.

Windows PowerShell:

```powershell
New-Item -ItemType Directory -Path C:\secure -Force
Copy-Item deploy/production.env.example C:\secure\hanstone-production.env
```

Linux 서버:

```bash
sudo install -d -m 700 /etc/hanstone
sudo install -m 600 deploy/production.env.example /etc/hanstone/production.env
```

예제 주소·예제 비밀번호를 모두 실제 운영 값으로 교체하고 파일 권한을 운영 계정으로 제한합니다. 환경 파일과 Secret 원문은 Git, 메신저, 일반 보고서에 올리지 않습니다.

### 9.3 마이그레이션·프리플라이트·기동

```powershell
docker compose --env-file C:\secure\hanstone-production.env -f deploy/compose.production.yaml run --rm api npm run db:deploy
docker compose --env-file C:\secure\hanstone-production.env -f deploy/compose.production.yaml run --rm api node dist/production-preflight.js
docker compose --env-file C:\secure\hanstone-production.env -f deploy/compose.production.yaml up -d
```

Linux 서버에서는 같은 순서로 다음 경로를 사용합니다.

```bash
docker compose --env-file /etc/hanstone/production.env -f deploy/compose.production.yaml run --rm api npm run db:deploy
docker compose --env-file /etc/hanstone/production.env -f deploy/compose.production.yaml run --rm api node dist/production-preflight.js
docker compose --env-file /etc/hanstone/production.env -f deploy/compose.production.yaml up -d
```

프리플라이트가 종료 코드 `0`과 전체 `pass`를 반환하기 전에는 운영 서비스를 기동하지 않습니다.

### 9.4 정적 웹 배포

```powershell
npm ci
$env:WEB_RELEASE_COMMIT_SHA = (git rev-parse HEAD).Trim()
npm run build:web
npm run manifest:web-deployment
npm run verify:web-artifacts
```

검증된 `dist/`를 정적 호스팅 또는 CDN에 배포합니다. `assets/`의 해시 파일은 장기 캐시하고 HTML·`config.js`·진입 파일은 항상 재검증하도록 설정합니다. React 경로는 새로고침 시 `/app.html`로 연결되는 rewrite 규칙이 필요합니다.

### 9.5 설치 후 확인

1. API의 `/api/v1/health/live`와 `/api/v1/health/ready`가 성공하는지 확인합니다.
2. 운영 웹과 API의 모든 공개 주소가 HTTPS인지 확인합니다.
3. 실제 후보 SHA·이미지 digest·웹 매니페스트가 배포 승인 기록과 일치하는지 확인합니다.
4. 운영 프리플라이트, 배포 검증과 `release-closeout.json`을 보관합니다.
5. 실패 또는 `rollbackRecommended: true`이면 새 배포를 중단하고 승인된 직전 불변 이미지로 롤백합니다. DB 마이그레이션은 직접 되돌리지 않습니다.

상세 운영 배포·증빙 절차는 `deploy/README.md`와 `docs/RELEASE_CHANGE_APPROVAL_TEMPLATE.md`를 따릅니다.

## 10. 자주 발생하는 문제

### 웹 서버가 `EACCES 127.0.0.1:5173`으로 시작되지 않음

Windows 예약 포트일 수 있습니다. 이 문서처럼 `4173`을 명시합니다.

```powershell
npm run dev:web -- --port 4173 --strictPort
```

### 포트가 이미 사용 중임

```powershell
Get-NetTCPConnection -LocalPort 3000,4173,5432,6379 -ErrorAction SilentlyContinue
```

기존 개발 서버를 정상 종료하거나 다른 포트를 지정합니다. 운영 중인 프로세스를 확인 없이 강제 종료하지 않습니다.

Windows의 예약 포트 범위도 확인할 수 있습니다.

```powershell
netsh interface ipv4 show excludedportrange protocol=tcp
```

`5432`가 예약 범위에 포함되면 다음처럼 PostgreSQL 호스트 포트를 변경합니다.

```powershell
$env:POSTGRES_HOST_PORT = "55432"
docker compose up -d database
```

### API readiness가 실패함

```powershell
docker compose ps
docker compose logs --tail 100 database redis api
npm --prefix server run db:deploy
```

DB·Redis가 `healthy`인지, `DATABASE_URL`과 `RATE_LIMIT_REDIS_URL`이 올바른지 확인합니다.

### Playwright 브라우저가 없음

```powershell
npx playwright install chromium firefox webkit
```

### Docker 컨테이너만 정지하고 싶음

```powershell
docker compose down
```

`docker compose down -v`는 로컬 PostgreSQL·Redis 볼륨의 데이터를 삭제하므로, 데이터를 폐기하려는 경우에만 사용합니다. 운영 서버에서는 실행하지 않습니다.

## 11. 최종 완료 체크리스트

- [ ] Node.js 24, npm, Docker와 Compose 버전을 확인함
- [ ] 루트와 `server` 의존성을 `npm ci`로 설치함
- [ ] 웹이 `4173`에서 열리고 주요 화면에 잘림·콘솔 오류가 없음
- [ ] PostgreSQL·Redis가 healthy 상태임
- [ ] DB 마이그레이션과 API readiness가 통과함
- [ ] `npm run ci`가 종료 코드 0으로 완료됨
- [ ] 전체 Playwright E2E가 통과함
- [ ] Core Web Vitals 성능 예산 검사가 통과함
- [ ] 테스트 결과에 Secret·개인정보가 포함되지 않음
- [ ] 운영 설치라면 프리플라이트·HTTPS·백업·SMTP·법무 증빙을 확인함
