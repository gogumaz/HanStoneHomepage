# 배포 실행안

제안서의 확정 기준은 프런트 정적 호스팅, Docker API, 관리형 PostgreSQL입니다.
클라우드 사업자와 도메인이 정해지기 전까지 이 디렉터리는 사업자 중립 배포 기준으로 사용합니다.

## 호스팅 준비 상태 자동 점검

신규 512MB 서버의 운영체제 선택과 Nginx·방화벽 최소 설치는
[`HOSTING_BOOTSTRAP.md`](./HOSTING_BOOTSTRAP.md)를 따릅니다. 기본 명령은 읽기 전용 계획만
출력합니다. 24.04 LTS를 권장하지만 PHPS의 Ubuntu 20.04는 Ubuntu Pro ESM이 활성화된
경우에만 `--allow-ubuntu-20-test`로 정적 테스트를 허용합니다.

`uzdream.com` 호스팅 설치 후에는 읽기 전용 점검 스크립트로 단계별 상태를 확인합니다.
스크립트는 서버 설정을 바꾸지 않으며 OS·자원·DNS·방화벽·Nginx·Docker·HTTPS·API
상태만 검사합니다. 사용법은 [`HOSTING_READINESS.md`](./HOSTING_READINESS.md)를 따릅니다.

```bash
./deploy/check-host-readiness.sh --mode base --expected-ip SERVER_IP
./deploy/check-host-readiness.sh --mode static --expected-ip SERVER_IP
./deploy/check-host-readiness.sh --mode full --expected-ip SERVER_IP
```

실제 Nginx 파일은 [`nginx/README.md`](./nginx/README.md)의 순서대로 HTTP 부트스트랩,
Certbot 인증서 발급, 운영 HTTPS 설정을 적용합니다. 설정은 정적 해시 자산만 장기 캐시하고
HTML·`config.js`는 항상 재검증하며 `/api/`는 `127.0.0.1:3000`으로만 전달합니다.

웹 산출물과 이 배포 설정을 서버에 전송할 때는 [`HOSTING_BUNDLE.md`](./HOSTING_BUNDLE.md)의
`npm run bundle:hosting`을 사용합니다. 도구는 깨끗한 Git 후보와 웹 매니페스트 해시를
검증한 뒤 Secret을 제외한 `.tgz`와 SHA-256 체크섬을 생성합니다.

패키지를 서버에 전송한 뒤에는 [`HOSTING_INSTALL.md`](./HOSTING_INSTALL.md)의 설치 도구로
내부 파일을 다시 검증하고 정적 웹 릴리스를 원자적으로 전환합니다. 512MB 호스팅에서는
`python3 deploy/install-hosting-release.py --check` 후 `sudo ... --apply` 순서로 진행합니다.
장애 롤백도 같은 도구를 사용하되 현재·이전 커밋 확인값이 모두 일치하고 이전 파일 해시가
정상일 때만 `--rollback` 전환을 허용합니다.

설치 또는 롤백 직후에는 [`HOSTING_VERIFY.md`](./HOSTING_VERIFY.md)의 읽기 전용 검증기로
설치 파일과 실제 HTTPS 응답의 SHA-256, 필수 화면, 캐시·보안 헤더 및 HTTP→HTTPS 이동을
확인합니다. 실패 보고서의 `rollbackRecommended`가 `true`이면 정상 배포로 확정하지 않습니다.

## 환경 분리

| 환경 | 결제·OAuth | 데이터 | 배포 |
|---|---|---|---|
| local | 테스트 키 | 로컬 PostgreSQL | Docker Compose |
| test | mock 또는 테스트 키 | CI 임시 DB | GitHub Actions |
| staging | 테스트 키 | 운영과 분리된 DB | 기본 브랜치 자동 배포 대상 |
| production | 운영 키 | 운영 관리형 DB | 승인 후 배포 |

각 환경의 DB, OAuth Secret, 토스페이먼츠 Secret Key와 객체 저장소 자격증명은 서로 공유하지 않습니다.
Secret은 저장소나 프런트 빌드에 넣지 않고 배포 플랫폼의 비밀 관리 기능으로 주입합니다.
필수 배포 변수의 이름은 `production.env.example`, 결제 세부 변수의 이름은
`../server/.env.example`의 토스페이먼츠 설정을 기준으로 등록합니다. AWS 역할 기반 자격증명을 사용하면 객체 저장소 Access Key 두 항목은 비워 두고 런타임 역할에 대상 접두사의 `GetObject`·`PutObject`·`DeleteObject` 권한을 부여합니다. 버킷 공개 접근은 차단하고 프런트 운영 도메인의 업로드 `POST`와 HLS 세그먼트 `GET`·`HEAD`를 허용하는 CORS 규칙을 설정합니다. CloudFront에는 비공개 S3 origin과 OAC, `lesson-videos/*`·`lesson-hls/*` behavior, 신뢰 키 그룹, HTTPS 도메인·인증서를 설정하고 키 ID와 base64 PEM 개인키를 배포 Secret으로 주입합니다.

정적 웹 배포물은 CI의 `web-release-{commitSha}` artifact를 사용합니다. 포함된 `web-deployment-manifest.json`은 모든 파일의 SHA-256·크기·Content-Type·Cache-Control을 후보 커밋에 결합합니다. `assets/` 아래의 Vite 해시 자산만 `public,max-age=31536000,immutable`로 배포하고 HTML·`config.js`·기타 진입 파일은 `public,max-age=0,must-revalidate`로 배포합니다. CDN 업로드 도구는 매니페스트의 해시를 대조한 뒤 헤더를 그대로 적용해야 하며, 이전 HTML이 새 해시 자산을 참조하지 않도록 진입 파일은 자산 업로드 후 마지막에 교체합니다.

`npm run verify:web-artifacts`는 소스맵·TypeScript·환경 파일을 차단하고 `config.js`의 공개 런타임 스키마를 검사합니다. API 주소는 상대 경로·HTTPS·로컬 HTTP만 허용하며 OAuth 제공사와 토스페이먼츠 모드/공개 클라이언트 키의 조합을 검증합니다. `*_gsk_` Secret Key, 개인키 또는 secret·password·token 계열 필드는 웹 산출물에 포함할 수 없습니다.

계정 보안 토큰의 기본 유효기간은 비밀번호 재설정 30분, 이메일 인증 24시간입니다. 운영 응답에는 개발용 토큰이 포함되지 않으며 SMTP로 `PUBLIC_APP_URL`의 계정 링크를 발송합니다. 운영 배포에는 `SMTP_HOST`, `MAIL_FROM`, `PUBLIC_APP_URL`, `MAIL_DKIM_SELECTOR`, `MAIL_BOUNCE_WEBHOOK_SECRET`이 필수입니다. 587 포트는 STARTTLS를 강제하고 465 포트는 implicit TLS 설정을 사용합니다. 영속 큐가 자동 재시도하며 발송·영구 반송 상태를 감사로그에 기록합니다. SMTP 공급자 반송 알림은 인증된 `POST /api/v1/mail/webhooks/bounce` 계약으로 연결하고, 배포 프리플라이트에서 SPF·DKIM·DMARC와 SMTP 연결이 모두 통과해야 합니다.

운영 메일 인수 시에는 공급자 콘솔에서 실제 영구 반송 시험을 한 번 실행하고 최초 웹훅 응답 JSON을 보관합니다. 요청에는 공급자가 발급한 안정적인 `eventId`가 필요하며 서버는 원문 대신 SHA-256만 응답과 감사로그에 기록합니다. 응답의 `data.action`은 `bounced`이고 `data.auditLogId`가 있어야 합니다. 같은 이벤트의 재전송은 멱등하게 `unchanged`가 되므로 최초 응답을 사용합니다. 다음 도구는 24시간 이내 운영 프리플라이트의 SMTP DNS·TLS·인증 성공, DMARC 정책, 발신 도메인·DKIM 선택자·정규화된 SPF/DKIM/DMARC 레코드 집합의 SHA-256, 후보 SHA, 입력한 공급자 이벤트 ID와 웹훅 응답의 이벤트 해시 일치, 최초 반송 감사기록 ID와 두 원본 파일의 SHA-256을 결합합니다. DNS 레코드 원문, 공급자 이벤트 ID 원문, 메시지 ID·수신자·SMTP 자격증명은 결과에 포함하지 않습니다.

```powershell
$env:MAIL_EVIDENCE_PREFLIGHT_REPORT = "production-preflight.json"
$env:MAIL_EVIDENCE_BOUNCE_RESPONSE = "mail-bounce-webhook-response.json"
$env:MAIL_EVIDENCE_PROVIDER_EVENT_ID = "공급자_시험_이벤트_ID"
$env:MAIL_EVIDENCE_MAX_AGE_HOURS = "24"
npm --prefix server run build
npm --prefix server run verify:mail-operations |
  Out-File -LiteralPath "mail-operations-evidence.json" -Encoding utf8
```

모든 활성 운영 통신의 TLS 인수는 운영 환경 파일 원문을 출력하지 않고 다음 도구로 검증합니다. 웹·API·공개 앱·CORS·OAuth는 HTTPS, PostgreSQL은 `sslmode=require|verify-ca|verify-full`, Redis는 `rediss://`, 사용자 지정 객체 저장소와 CDN은 HTTPS, SMTP는 465 implicit TLS 또는 587 STARTTLS여야 합니다. 같은 후보의 24시간 이내 성공한 운영 프리플라이트와 배포 검증이 필요합니다. 도구는 API와 웹에 인증서 검증을 강제한 별도 TLS 핸드셰이크를 수행하고 TLS 1.2 이상, 대상 출처 일치, 인증서 유효기간과 기본 14일 이상의 만료 여유를 확인합니다. 결과에는 공개 호스트명·자격증명·환경값 대신 출처와 인증서의 SHA-256, 협상된 TLS 버전, 인증서 유효기간만 기록합니다. `NODE_TLS_REJECT_UNAUTHORIZED=0`으로 인증서 검증이 비활성화된 실행은 거부합니다.

```powershell
$env:TRANSPORT_EVIDENCE_ENV_FILE = "C:\secure\production.env"
$env:TRANSPORT_EVIDENCE_PREFLIGHT_REPORT = "production-preflight.json"
$env:TRANSPORT_EVIDENCE_DEPLOYMENT_REPORT = "production-deployment-verification.json"
$env:TRANSPORT_EVIDENCE_API_BASE_URL = "https://api.example.com"
$env:TRANSPORT_EVIDENCE_WEB_BASE_URL = "https://www.example.com"
$env:TRANSPORT_EVIDENCE_MAX_AGE_HOURS = "24"
$env:TRANSPORT_EVIDENCE_MIN_CERT_VALIDITY_DAYS = "14"
$env:TRANSPORT_EVIDENCE_TLS_TIMEOUT_MS = "5000"
npm --prefix server run build
npm --prefix server run verify:transport-security |
  Out-File -LiteralPath "transport-security-evidence.json" -Encoding utf8
```

승인형 `Production deployment verification` 워크플로는 성공한 후보 인수 run의 `production-preflight.json`, 보호된 운영 환경 파일·최초 반송 응답·법무 승인 JSON을 사용해 HTTPS·메일·법무 결합 검증을 자동 실행합니다. 세 보호 입력 파일은 권한 `0600`으로 잠시 복원한 뒤 artifact 업로드 전에 삭제합니다. 배포 검증 artifact에는 `production-deployment-verification.json`, `transport-security-evidence.json`, 비식별 `mail-operations-evidence.json`, `legal-approval-binding.json`이 함께 90일 보관되며, 하나라도 실패하면 운영 검증 run도 실패합니다.

OAuth 제공사는 client ID·secret·redirect URI가 모두 있을 때만 등록됩니다. Redirect URI는 제공사 콘솔 값과 정확히 일치해야 하며 운영 주소는 HTTPS만 허용합니다. 실제 공급자 앱이 승인되기 전에는 프런트 `oauthEnabled=false`를 유지합니다. OAuth와 토스페이먼츠 코드는 `server/src/components`의 CBD 모듈로 분리되어 있으므로 현재 DB 모델과 무관하게 다른 NestJS 서비스에서도 같은 계약을 사용할 수 있습니다.

## 로컬 API

```powershell
docker compose up -d database
Copy-Item server/.env.example server/.env
npm --prefix server run db:deploy
npm --prefix server run dev
```

전체 컨테이너를 확인하려면 `docker compose up --build`를 실행합니다. 최초 DB에는 API 시작 전에
`npm --prefix server run db:deploy`를 실행합니다.

## 운영 배포 순서

실제 후보의 실행 ID·artifact SHA-256·법무·메일·HTTPS·롤백 증적은 [`docs/RELEASE_CHANGE_APPROVAL_TEMPLATE.md`](../docs/RELEASE_CHANGE_APPROVAL_TEMPLATE.md)를 후보별로 복제해 변경승인 시스템에 기록합니다. Secret과 환경 파일 원문은 기록하지 않습니다.

1. 관리형 PostgreSQL과 비공개 객체 저장소를 생성합니다.
2. API 이미지를 커밋 SHA 태그로 빌드·보관하고 레지스트리가 반환한 `repository@sha256:<64자리>` 불변 참조를 기록합니다. 운영 Compose의 `API_IMAGE`에는 태그가 아니라 이 참조만 사용합니다.
3. 같은 이미지를 사용해 `npm run db:deploy`를 한 번 실행합니다.
4. 같은 이미지와 운영 환경변수로 `node dist/production-preflight.js`를 실행하고 모든 점검이 `pass`인지 확인합니다.
5. 프리플라이트·복구훈련·읽기 전용 부하·워커 soak·공급망 SBOM 매니페스트 JSON을 `npm --prefix server run accept:release`로 검증하고 인수 결과의 `ok`가 `true`인지 확인합니다.
6. `deploy/compose.production.yaml` 또는 선택한 플랫폼에서 API와 같은 이미지의 `account-mail-worker`, `inquiry-notification-worker`, `video-scan-worker`, `hls-transcode-worker`, `video-cleanup-worker`를 함께 교체합니다. 이미지에는 FFmpeg·FFprobe가 포함되어야 합니다.
7. 인수 결과의 커밋 SHA와 이미지 digest로 `npm --prefix server run verify:deployment`를 실행해 실제 API의 배포 식별값, liveness, readiness를 반복 확인합니다.
8. 핵심 사용자 경로를 확인하고 운영자 인증으로 `/api/v1/admin/operations/worker-health`를 조회해 모든 큐가 `healthy`인지 확인합니다.
9. 인수 매니페스트와 배포 검증 JSON을 `npm --prefix server run close:release`로 결합하고 최종 종료 결과의 `ok`가 `true`인지 확인합니다.
10. 배포 검증 결과가 `rollbackRecommended: true`이거나 오류율이 기준을 넘으면 `npm --prefix server run plan:rollback`의 승인을 받은 이전 불변 이미지 참조로 되돌립니다. 적용된 DB 마이그레이션은 되돌리지 않고 호환 마이그레이션으로 복구합니다.

실제 자동 배포 연결에는 호스팅 사업자, 리전, 도메인, 이미지 저장소와 GitHub 환경 Secret 확정이 필요합니다.

Compose 템플릿에서는 다음과 같이 프리플라이트를 일회성 컨테이너로 실행합니다. 종료 코드가 0이어야 배포를 계속합니다.

```powershell
docker compose --env-file deploy/production.env -f deploy/compose.production.yaml run --rm api node dist/production-preflight.js
```

프리플라이트는 최신 DB 스키마, 객체 저장소의 임시 객체 쓰기·읽기·삭제와 무서명 원본 URL 접근 차단, 설정된 CloudFront 서명 URL의 실제 바이트 조회, FFmpeg·FFprobe 실행 가능 여부, ClamAV 정상 스트림 검사, SMTP DNS·TCP·TLS·인증, 토스페이먼츠 Secret Key 설정과 필수 OAuth 설정을 점검합니다. 익명 요청으로 임시 영상 객체가 조회되면 비공개 버킷 정책 위반으로 배포를 실패시킵니다. 메일·결제 변경은 발생시키지 않으며 결과 JSON에는 Secret과 CDN 서명 URL을 기록하지 않습니다. 임시 저장소 키는 `lesson-videos/preflight/` 또는 `lesson-hls/preflight/` 아래에 만들고 성공·실패와 관계없이 삭제를 시도합니다. 운영에서 CDN을 필수화하려면 `PREFLIGHT_REQUIRE_CDN=true`로 두고, 일부 OAuth 공급자를 의도적으로 제외하려면 `PREFLIGHT_REQUIRED_OAUTH_PROVIDERS`를 실제 제공 목록으로 조정합니다.

복구 정책 점검은 PostgreSQL PITR 활성화, 30일 이상 백업 보존, 객체 저장소 버전 관리, RPO 15분·RTO 4시간 이하, 최근 100일 이내 복구훈련 완료 선언을 배포 게이트로 검사합니다. `DATABASE_PITR_ENABLED`와 `OBJECT_STORAGE_VERSIONING_ENABLED`는 클라우드 설정을 자동 변경하거나 공급자 API로 검증하는 값이 아니므로 운영자가 실제 콘솔 설정과 복구 결과를 확인한 뒤에만 `true`로 등록해야 합니다.

### 분기별 PostgreSQL 복구훈련

1. 운영 백업 또는 PITR 시점을 운영과 네트워크·계정이 분리된 스테이징 PostgreSQL로 복원합니다. 호스트명이나 DB 이름에는 `recovery`, `restore`, `staging`, `drill`, `test`, `sandbox` 중 하나가 포함되어야 합니다.
2. 복원 DB 전용 읽기 권한 계정을 만들고 아래 명령을 실행합니다. 검사는 `BEGIN TRANSACTION READ ONLY` 안에서 최신 마이그레이션, 12개 핵심 테이블, 계정 메일·구독·바둑미션·문의 알림 관계 무결성을 확인합니다.
3. 종료 코드가 0이고 JSON의 `ok`, `rpoMet`, `rtoMet`가 모두 `true`인지 확인합니다. JSON에는 접속 문자열, Secret, 업무 데이터 건수가 포함되지 않으므로 내부 변경관리 시스템에 증빙으로 보관합니다.
4. 성공한 증빙의 `completedAt`만 `RECOVERY_DRILL_LAST_COMPLETED_AT`에 등록합니다. 실패 결과나 수동 추정 시각으로 갱신하지 않습니다.

```powershell
npm --prefix server run build
$env:DATABASE_URL = "postgresql://운영_DB_식별용_주소"
$env:RECOVERY_DATABASE_URL = "postgresql://복원_DB_읽기전용_계정@staging-db.example.com/baduk_recovery"
$env:RECOVERY_BACKUP_CREATED_AT = "2026-08-24T12:00:00+09:00"
$env:RECOVERY_RESTORE_STARTED_AT = "2026-08-24T12:10:00+09:00"
$env:RECOVERY_DRILL_ID = "quarterly-2026-q3"
node server/dist/recovery-drill.js | Tee-Object recovery-drill-2026-q3.json
```

`DATABASE_URL`은 복원 대상이 운영 DB와 같은지 비교하는 안전장치에만 사용되며 이 명령이 운영 DB에 연결하지는 않습니다. `RECOVERY_DATABASE_URL`은 API·워커의 상시 환경변수나 저장소 파일에 등록하지 말고 훈련 실행 시 비밀 관리 기능으로만 주입합니다. 운영과 동일한 대상, `prod`·`production`으로 표시된 대상, 격리 표식이 없는 대상은 연결 전에 거부됩니다.

### 스테이징 읽기 전용 부하 검증

부하 검증은 `GET` 전용으로 liveness, readiness, 시대·강의 공개 조회를 순환 호출합니다. `OPERATIONS_METRICS_TOKEN`을 주입하면 보호된 워커 메트릭 조회도 시나리오에 포함해 큐 상태 집계 경로의 부하를 함께 측정합니다. 기본 기준은 총 500회, 동시 요청 20개, 요청별 5초 제한, 전체 p95 500ms 이하, 오류율 1% 이하입니다.

```powershell
npm --prefix server run build
$env:LOAD_TEST_BASE_URL = "https://api.staging.example.com"
$env:OPERATIONS_METRICS_TOKEN = "스테이징_메트릭_토큰"
$env:LOAD_TEST_REQUESTS = "500"
$env:LOAD_TEST_CONCURRENCY = "20"
$env:LOAD_TEST_MAX_P95_MS = "500"
$env:LOAD_TEST_MAX_ERROR_RATE_PERCENT = "1"
node server/dist/read-only-load-test.js | Tee-Object staging-load-report.json
```

결과 JSON은 전체·시나리오별 처리량, 오류율, p50·p95·p99·최대 지연을 기록하며 대상 URL과 인증 토큰은 기록하지 않습니다. 기준을 넘으면 종료 코드 1을 반환합니다. 요청은 최대 100,000회, 동시성은 최대 200으로 제한됩니다. 기본적으로 localhost 또는 호스트명에 `staging`, `stage`, `test`, `sandbox`, `load`, `perf` 표식이 있는 대상만 허용합니다.

GitHub Actions의 `Staging read-only load test` 수동 워크플로를 사용하려면 `STAGING_API_BASE_URL`, `STAGING_OPERATIONS_METRICS_TOKEN` 저장소 Secret을 등록합니다. 실행 결과 JSON은 30일 보관되는 artifact로 업로드되고 임계값 실패는 워크플로 실패로 처리됩니다. 운영 대상 실행은 기본 차단되어 있으므로 정기 검증은 트래픽과 데이터베이스가 분리된 스테이징에서 수행합니다.

### 스테이징 워커 큐 내구성 관측

제어된 읽기 전용 부하가 실행되는 동안 보호된 Prometheus 메트릭을 반복 수집해 5개 영속 큐의 적체 증가, 오래된 잠금, 최종 실패 증가, `critical` 상태와 메트릭 응답 p95를 판정합니다. 관측기 자체는 작업·메일·영상·결제를 생성하거나 변경하지 않습니다.

```powershell
npm --prefix server run build
$env:WORKER_SOAK_BASE_URL = "https://api.staging.example.com"
$env:OPERATIONS_METRICS_TOKEN = "스테이징_메트릭_토큰"
$env:WORKER_SOAK_SAMPLES = "60"
$env:WORKER_SOAK_INTERVAL_MS = "10000"
$env:WORKER_SOAK_MAX_P95_MS = "500"
$env:WORKER_SOAK_MAX_BACKLOG_GROWTH = "0"
npm --prefix server run test:worker:soak | Tee-Object staging-worker-soak-report.json
```

기본 실행은 약 10분이며 샘플 실패, 갱신되지 않거나 역행한 메트릭 시각, `critical` 1회 이상, stale lock 1건 이상, 큐별 대기 작업 증가 또는 관측 기간 중 최종 실패 증가가 있으면 종료 코드 1을 반환합니다. 관측 시작 전에 이미 존재한 최종 실패 건수는 기준선으로만 기록합니다. 대상은 localhost 또는 호스트명에 `staging`, `stage`, `test`, `sandbox`, `load`, `perf` 표식이 있는 환경으로 제한되고 결과에는 대상 URL·토큰·원시 메트릭을 기록하지 않습니다. GitHub Actions의 `Staging worker queue soak` 수동 워크플로는 동일한 스테이징 Secret을 사용해 관측기를 백그라운드로 시작한 뒤 기본 2,000회의 제한된 읽기 전용 부하를 동시 실행합니다. 워커 보고서, 동시 부하 보고서, 두 프로세스의 성공 여부를 결합한 실행 보고서를 하나의 30일 artifact로 보관하며 둘 중 하나라도 실패하면 워크플로를 실패 처리합니다. 후보 인수 워크플로는 `verify:staging-evidence`를 실행해 독립 부하와 워커 artifact의 후보 SHA·run ID·원본 해시·임계값·유효기간을 확인하고, 제어 부하가 soak 관측 시간과 실제로 겹쳤을 때만 `staging-evidence-bundle.json`을 생성합니다.

### 배포 인수 증빙 게이트

운영 배포 직전에 같은 후보 버전의 프리플라이트, 복구훈련, 읽기 전용 부하, 워커 soak, 공급망 SBOM 매니페스트를 한 번에 검증합니다. 각 보고서의 최상위 `ok`뿐 아니라 필수 하위 점검과 표본 완료 여부를 다시 확인하므로 일부 항목이 빠지거나 수정된 보고서는 통과하지 않습니다. GitHub Actions에서 생성한 보고서는 `GITHUB_SHA`가 자동 포함되며 수동 실행에서는 네 실행 도구에 `$env:EVIDENCE_COMMIT_SHA = "후보_커밋_SHA"`를 동일하게 설정하고 공급망 매니페스트도 같은 커밋의 CI artifact에서 받아야 합니다.

```powershell
npm --prefix server run build
$env:RELEASE_ID = "release-2026.08.24"
$env:RELEASE_COMMIT_SHA = "배포할_Git_커밋_SHA"
$env:RELEASE_IMAGE_REFERENCE = "registry.example.com/baduk-history-api@sha256:64자리_digest"
$env:RELEASE_PREFLIGHT_REPORT = "evidence/production-preflight.json"
$env:RELEASE_RECOVERY_REPORT = "evidence/recovery-drill.json"
$env:RELEASE_LOAD_REPORT = "evidence/staging-read-only-load-report.json"
$env:RELEASE_WORKER_SOAK_REPORT = "evidence/staging-worker-soak-report.json"
$env:RELEASE_WEB_DEPLOYMENT_REPORT = "evidence/web-deployment-manifest.json"
$env:RELEASE_FIELD_VALIDATION_REPORT = "evidence/field-validation-report.json"
$env:RELEASE_SUPPLY_CHAIN_REPORT = "evidence/supply-chain/manifest.json"
npm --prefix server run accept:release | Tee-Object release-acceptance.json
```

기본 유효기간은 프리플라이트 24시간, 복구훈련 100일, 부하·워커 soak·스테이징 번들·웹 배포·현장 브라우저·공급망 증빙 각각 7일입니다. 필요하면 `RELEASE_PREFLIGHT_MAX_AGE_HOURS`, `RELEASE_RECOVERY_MAX_AGE_HOURS`, `RELEASE_LOAD_MAX_AGE_HOURS`, `RELEASE_WORKER_SOAK_MAX_AGE_HOURS`, `RELEASE_STAGING_BUNDLE_MAX_AGE_HOURS`, `RELEASE_WEB_DEPLOYMENT_MAX_AGE_HOURS`, `RELEASE_FIELD_VALIDATION_MAX_AGE_HOURS`, `RELEASE_SUPPLY_CHAIN_MAX_AGE_HOURS`로 더 엄격하게 줄일 수 있습니다. 웹 배포 증빙은 CI의 `web-release-{commitSha}` artifact 안에 있는 `web-deployment-manifest.json`, 현장 증빙은 `browser-field-validation-{runId}` artifact 안의 `field-validation-report.json`, 공급망 증빙은 `release-supply-chain-{commitSha}` artifact 안의 `manifest.json`을 사용합니다. 가변 이미지 태그, 후보 커밋 불일치, 미래 시각, 스테이징 번들의 자체 digest·원본 SHA 불일치, 웹 파일 해시·캐시 정책 불일치, 취약점 정책 불일치, 웹·API SBOM 누락, 필수 브라우저 규격 누락·실패·flaky, 미완료 표본 또는 실패 임계값이 있으면 종료 코드 1을 반환합니다. 성공 결과에는 정확한 이미지 불변 참조, 일곱 원본 증빙과 스테이징 번들의 SHA-256을 다시 결합한 `manifestSha256`이 포함됩니다. 보고서 파일 경로와 원본 상세는 복제하지 않으므로 `release-acceptance.json`을 최종 변경승인 기록에 첨부하고 같은 `imageReference`를 `API_IMAGE`로 배포합니다.

### GitHub 릴리스 착수 준비 감사

후보 인수 워크플로를 실행하기 전에 로컬 후보와 GitHub 설정을 읽기 전용으로 점검합니다.

```powershell
npm --prefix server run build
npm --prefix server run audit:release-readiness | Tee-Object release-readiness.json
```

감사 도구는 로컬 후보 커밋이 원격 기본 브랜치에 게시되었는지, 작업 트리가 깨끗한지, 여덟 개 필수 워크플로가 활성 상태인지, `production` 환경의 1인 운영 정책과 필수 Secret 이름이 등록되었는지 검사합니다. 승인 모드는 `solo`, 지정 운영자는 `gogumaz`이며 환경 승인자는 0명이어야 합니다. 후보 인수·운영 검증·closeout 수동 워크플로는 실행자가 지정 운영자와 일치하고 `AUTHORIZE_SOLO_PRODUCTION_RELEASE`를 직접 입력한 경우에만 진행합니다. 로컬 감사는 현재 `gh` 로그인 계정을 실행 주체로 사용합니다. 배포 브랜치는 보호된 브랜치만 허용하거나 기본 브랜치 하나만 정확히 허용해야 합니다. 저장소에는 `RELEASE_READINESS_TOKEN`, `STAGING_API_BASE_URL`, `STAGING_OPERATIONS_METRICS_TOKEN`, `ROLLBACK_DRILL_API_BASE_URL`, `ROLLBACK_DRILL_WEB_BASE_URL`, `ROLLBACK_DRILL_OPERATIONS_METRICS_TOKEN` Secret이 필요합니다. 스테이징 값은 읽기 전용 부하와 워커 soak에, 롤백 값은 격리 리허설 재검증에 사용합니다. Secret 값은 조회하거나 결과에 기록하지 않습니다. 모든 항목이 통과하면 `ok: true`와 종료 코드 0을 반환하고, 누락 항목이 있으면 각 항목의 안정적인 오류 코드와 종료 코드 1을 반환합니다. 후보 인수 실행은 `ok: true`를 확인한 뒤에만 시작합니다.

GitHub Actions의 `Release readiness audit` 수동 워크플로도 같은 감사를 실행합니다. 이 워크플로는 `production` 환경에 진입하지 않으므로 환경 자체가 없거나 승인 설정이 잘못된 경우도 진단할 수 있습니다. `RELEASE_READINESS_TOKEN`에는 대상 저장소의 Metadata·Actions·Contents·Environments·Secrets 읽기 권한만 부여한 fine-grained PAT 또는 동등한 단기 GitHub App 토큰을 등록합니다. 결과는 성공 여부와 관계없이 `release-readiness-{commitSha}-{runId}` artifact로 30일간 보관한 뒤 감사 판정이 실패했으면 워크플로도 실패 처리합니다.

다음 도구로 1인 운영용 `production` 환경 설정을 준비할 수 있습니다. 기본 실행은 GitHub를 변경하지 않는 dry-run이며, 현재 로그인 계정이 지정 운영자 `gogumaz`인지와 기존 사용자 지정 브랜치 정책에 기본 브랜치 외 항목이 없는지 검사합니다.

```powershell
npm --prefix server run build
npm --prefix server run configure:release-governance -- --solo
```

dry-run의 모든 검사가 통과한 경우에만 다음 명시적 확인으로 승인자 없는 `production` 환경과 기본 브랜치 단일 정책을 적용합니다. 예상하지 않은 기존 브랜치 정책은 자동 삭제하지 않고 실패하며, 이 도구는 Secret을 생성하거나 값을 조회하지 않습니다.

```powershell
npm --prefix server run configure:release-governance -- --solo --apply --confirm CONFIGURE_PRODUCTION_RELEASE_GOVERNANCE
```

필수 릴리스 Secret은 값이 명령행·로그에 노출되지 않도록 프로세스 환경변수와 로컬 환경 파일에서만 읽어 등록합니다. `PRODUCTION_PREFLIGHT_ENV_FILE`에는 base64 값이 아니라 원본 운영 환경 파일 경로를 지정합니다. 파일이 저장소 내부에 있으면 반드시 Git ignore 대상이어야 하며, 도구가 내용을 메모리에서 base64로 변환합니다. 기본 실행은 GitHub를 변경하지 않는 dry-run입니다.

```powershell
$env:RELEASE_READINESS_TOKEN = "발급한_읽기전용_토큰"
$env:STAGING_API_BASE_URL = "https://api.staging.example.com"
$env:STAGING_OPERATIONS_METRICS_TOKEN = "스테이징_메트릭_토큰"
$env:ROLLBACK_DRILL_API_BASE_URL = "https://api.rollback-drill.example.com"
$env:ROLLBACK_DRILL_WEB_BASE_URL = "https://web.rollback-drill.example.com"
$env:ROLLBACK_DRILL_OPERATIONS_METRICS_TOKEN = "롤백_리허설_메트릭_토큰"
$env:PRODUCTION_PREFLIGHT_ENV_FILE = "C:\secure\production.env"
$env:PRODUCTION_DATABASE_URL = "postgresql://...?...sslmode=verify-full"
$env:RECOVERY_DATABASE_URL = "postgresql://...recovery...?...sslmode=verify-full"
$env:PRODUCTION_API_BASE_URL = "https://api.example.com"
$env:PRODUCTION_WEB_BASE_URL = "https://www.example.com"
$env:PRODUCTION_OPERATIONS_METRICS_TOKEN = "운영_메트릭_토큰"
$env:PRODUCTION_MAIL_BOUNCE_RESPONSE_BASE64 = [Convert]::ToBase64String([IO.File]::ReadAllBytes("C:\secure\mail-bounce-response.json"))
$env:PRODUCTION_MAIL_PROVIDER_EVENT_ID = "공급자_시험_event_ID"
$env:PRODUCTION_LEGAL_APPROVAL_EVIDENCE_BASE64 = [Convert]::ToBase64String([IO.File]::ReadAllBytes("legal-policy-approval.json"))
npm --prefix server run build
npm --prefix server run configure:release-secrets
```

dry-run은 스테이징·롤백 리허설·운영 HTTPS, 비운영 호스트 표식, PostgreSQL TLS, 복구 DB 격리, 토큰 형식, 운영 환경 파일의 설정 유효성과 DB·웹 URL·메트릭 토큰 일치, 최초 반송 응답과 공급자 event ID 해시 일치, 법무 승인 JSON의 정책·승인일·문서 해시와 운영 환경 일치를 검사합니다. 보고서에는 Secret 이름과 판정 코드만 남고 값이나 파일 내용은 포함되지 않습니다. 모든 검사가 통과한 경우에만 아래 명시적 확인으로 저장소 Secret 6개와 `production` 환경 Secret 9개를 표준입력으로 등록한 뒤 이름만 다시 조회해 검증합니다. 빈 값이나 예시 값을 자동 생성하지 않습니다.

```powershell
npm --prefix server run configure:release-secrets -- --apply --confirm CONFIGURE_RELEASE_SECRETS
```

Secret 등록 뒤에는 다음 조정 도구로 현재 기본 브랜치 후보에 필요한 스테이징 부하·워커 soak 증빙 상태를 한 번에 확인합니다. 기본 dry-run은 로컬 HEAD와 원격 기본 브랜치의 일치, 깨끗한 작업트리, 저장소 Secret 이름, 동일 후보의 최근 7일 성공·진행 중 run을 검사합니다. 이미 성공했거나 진행 중인 워크플로는 재실행하지 않습니다.

```powershell
npm --prefix server run build
npm --prefix server run coordinate:staging-evidence
```

모든 사전조건이 통과했을 때만 명시적 확인으로 누락된 워크플로를 실행합니다. 두 워크플로에는 동일한 고유 증빙 ID가 실행명에 포함되므로 병렬 실행을 구분할 수 있습니다. 실행 후 dry-run을 다시 호출하면 후보 커밋별 run ID와 `missing`, `in-progress`, `passed` 상태를 반환하며, 두 결과가 모두 `passed`일 때 해당 run ID를 후보 인수 워크플로에 사용합니다.

```powershell
npm --prefix server run coordinate:staging-evidence -- --apply --confirm RUN_STAGING_RELEASE_EVIDENCE
```

두 스테이징 증빙이 통과하면 후보 인수 조정 도구가 동일 후보의 성공한 CI와 세 실행의 artifact 이름을 교차 검증합니다. `failure`로 끝난 CI는 artifact가 남아 있어도 사용하지 않으며, 기본 7일 유효기간을 지난 실행과 후보 SHA가 다른 실행도 제외합니다. 운영 Secret 9개, 깨끗하게 게시된 후보, 불변 이미지와 격리 복구 시각이 모두 준비되어야 합니다.

```powershell
$env:RELEASE_ID = "release-2026.08.31"
$env:RELEASE_IMAGE_REFERENCE = "ghcr.io/owner/image@sha256:64자리_digest"
$env:RELEASE_REGISTRY_HOST = "ghcr.io"
$env:RECOVERY_BACKUP_CREATED_AT = "2026-08-31T00:00:00.000Z"
$env:RECOVERY_RESTORE_STARTED_AT = "2026-08-31T00:30:00.000Z"
npm --prefix server run build
npm --prefix server run coordinate:release-acceptance
```

dry-run은 CI 공급망·웹·브라우저 artifact, 읽기 부하 artifact, 워커 soak artifact의 run ID를 자동 선택하고 같은 릴리스 ID로 진행 중이거나 성공한 인수가 있으면 중복 실행을 만들지 않습니다. 모든 검사가 통과한 경우에만 1인 운영 확인 문자열로 후보 인수를 발송합니다.

```powershell
npm --prefix server run coordinate:release-acceptance -- --apply --confirm AUTHORIZE_SOLO_PRODUCTION_RELEASE
```

### 후보 커밋 인수 자동화

GitHub Actions의 `Release candidate acceptance` 수동 워크플로는 `production` 환경 승인을 받은 뒤 불변 후보 이미지를 직접 실행합니다. 프리플라이트와 격리 복구훈련은 해당 이미지에서 새로 생성하고, 성공한 `Staging read-only load test`, `Staging worker queue soak`, CI 실행의 run ID로 부하·워커·현장 브라우저·공급망 증빙을 내려받습니다. 후보 커밋은 소문자 40자리 SHA만, 이미지는 `repository@sha256:<64자리>` 형식만 허용합니다.

저장소의 `production` 환경에는 승인자를 등록하지 않고 다음 Secret을 설정합니다.

- `PRODUCTION_PREFLIGHT_ENV_FILE_BASE64`: 운영 환경 파일 전체를 base64로 인코딩한 값. 원본에는 프리플라이트에 필요한 DB·Redis·OAuth·토스페이먼츠·SMTP·객체 저장소·CDN·ClamAV·복구 정책 설정과 법무 승인 메타데이터가 들어가야 합니다. 현재 정책 버전은 `LEGAL_POLICY_VERSION=guardian-link-v1`이며, 서명된 원본 승인 문서의 승인일을 `LEGAL_POLICY_APPROVED_AT`, SHA-256을 `LEGAL_POLICY_APPROVAL_SHA256`으로 기록합니다. 세 값이 없거나 버전이 다르거나 승인일이 미래이거나 해시 형식이 올바르지 않으면 운영 기동과 프리플라이트가 모두 실패합니다. 승인 문서 원본과 해시 대조 기록은 Secret이 아닌 변경승인 시스템에 보관합니다.
- `PRODUCTION_DATABASE_URL`: 복구 대상이 운영 DB와 다른지 비교할 때만 사용하는 운영 DB 주소입니다.
- `RECOVERY_DATABASE_URL`: 실제 운영 DB와 분리되고 이름에 `recovery`, `restore`, `drill`, `staging`, `test` 또는 `sandbox` 표식이 있는 복원 DB 주소입니다.
- `PRODUCTION_MAIL_BOUNCE_RESPONSE_BASE64`: 공급자 영구 반송 시험의 최초 `bounced` 웹훅 응답 JSON을 base64로 인코딩한 값입니다.
- `PRODUCTION_MAIL_PROVIDER_EVENT_ID`: 같은 반송 시험에 사용한 안정적인 공급자 event ID입니다. 등록 도구는 응답의 `eventIdSha256`과 일치하는지 검사하며 보고서에는 원문을 남기지 않습니다.
- `PRODUCTION_LEGAL_APPROVAL_EVIDENCE_BASE64`: 서명 원본으로 `prepare:legal-approval`을 실행해 만든 비식별 `legal-policy-approval.json`의 base64 값입니다. 등록 도구는 운영 환경의 정책 버전·승인일·문서 SHA-256과 일치하는지 검사합니다.
- `CONTAINER_REGISTRY_USERNAME`, `CONTAINER_REGISTRY_PASSWORD`: 외부 또는 별도 권한이 필요한 비공개 레지스트리에만 등록합니다. 생략하면 GitHub 실행 주체와 작업 토큰을 사용합니다.

법무 검토자가 최종 원본에 서명한 뒤에는 아래 도구로 원본 형식, 승인시각, 선택 후보 SHA와 명시적 서명 완료 확인을 검증합니다. 도구는 서명 여부를 자동 추정하지 않으며 정확한 확인 문자열 없이는 실패합니다. 성공 JSON의 `environment` 세 값을 운영 환경 파일에 옮기고 JSON과 서명 원본을 변경승인 기록에 함께 보관합니다. 파일 경로와 검토자 개인정보는 JSON에 기록하지 않습니다.

```powershell
$env:LEGAL_APPROVAL_FILE = "..\reports\법무검토_승인서_서명완료.docx"
$env:LEGAL_APPROVAL_APPROVED_AT = "2026-08-31T18:00:00+09:00"
$env:LEGAL_APPROVAL_CANDIDATE_COMMIT_SHA = (git rev-parse HEAD).Trim()
$env:LEGAL_APPROVAL_CONFIRMATION = "I_CONFIRM_THIS_IS_SIGNED_FINAL_LEGAL_APPROVAL"
npm --prefix server run build
npm --prefix server run prepare:legal-approval |
  Out-File -LiteralPath "legal-policy-approval.json" -Encoding utf8
```

후보 프리플라이트가 성공한 뒤에는 승인 JSON이 실제 운영 환경 등록값 및 같은 후보와 일치하는지 아래 도구로 다시 결합합니다. 서명 원본은 입력하지 않으며 승인 JSON의 문서 SHA-256, 정책 버전, 승인시각, 선택적 후보 제한과 운영 환경 파일·프리플라이트 원본 SHA-256을 `legal-approval-binding.json`에 고정합니다. 승인 JSON에 후보가 지정되지 않은 정책 공통 승인도 허용하지만, 후보가 지정된 경우 현재 후보와 정확히 일치해야 합니다. 결과에는 운영 환경 원문, 파일 경로와 검토자 정보가 포함되지 않습니다.

```powershell
$env:LEGAL_BINDING_ENV_FILE = "C:\secure\production.env"
$env:LEGAL_BINDING_APPROVAL_REPORT = "legal-policy-approval.json"
$env:LEGAL_BINDING_PREFLIGHT_REPORT = "production-preflight.json"
$env:LEGAL_BINDING_EXPECTED_COMMIT_SHA = (git rev-parse HEAD).Trim()
npm --prefix server run verify:legal-approval-binding |
  Out-File -LiteralPath "legal-approval-binding.json" -Encoding utf8
```

GitHub 실행기가 DB·Redis·객체 저장소·CDN·ClamAV·SMTP와 격리 복원 DB에 접근할 수 있어야 합니다. 프리플라이트 환경 파일은 권한 `0600`으로 잠시 복원하고 실행 직후 삭제하며 artifact 업로드 목록에서도 명시적으로 제외합니다. 결과 artifact `release-acceptance-{releaseId}-{runId}`에는 최종 인수 보고서와 일곱 원본 증빙만 포함되고 90일간 보관됩니다. 세 검증 실행 ID, 백업 생성 시각과 복원 시작 시각을 변경승인 기록에도 함께 남깁니다.

성공한 후보 인수 뒤에는 최종화 조정 도구가 인수 artifact를 임시 디렉터리에 내려받아 릴리스 ID·후보 SHA·불변 이미지·일곱 증빙·웹 매니페스트 SHA-256을 검증합니다. 인수 보고서의 릴리스·후보·이미지·정규 시각, 스테이징 번들 요약과 고정 순서의 일곱 증빙 이름·원본 해시·유효기간·상태를 다시 직렬화해 `manifestSha256`도 직접 재계산합니다. 일곱 증빙의 기록 해시는 artifact에 보관된 각 원본 파일의 실제 바이트 SHA-256과 대조합니다. 증빙별 필수 상세 check 순서와 통과 코드도 확인하고, 원본의 `checkedAt`·`completedAt`·`generatedAt`에서 정규 `observedAt`과 `ageHours`를 다시 계산해 유효기간을 검증합니다. 함께 보관된 `staging-evidence-bundle.json` 원본은 파일 SHA-256, 후보·run ID, 고정 순서의 9개 판정과 4개 source, 자체 `evidenceSha256`을 다시 검증하며, 4개 source 해시도 같은 artifact의 부하·soak·제어 부하·실행 원본 파일과 대조합니다. GitHub artifact 메타데이터의 만료 여부와 생성·만료 시각도 확인하며 최소 90일 보관 기간이 확인되지 않은 인수·배포 검증·closeout artifact는 사용하지 않습니다. 각 보고서의 생성 시각은 artifact 생성 시각보다 최대 5분 미래만 허용하고 artifact는 보고서 생성 후 60분 이내에 만들어져야 하므로, 오래된 보고서를 뒤늦게 재포장하거나 미래 시각으로 만든 증빙도 차단합니다. 운영 배포를 실제로 완료한 뒤에만 `PRODUCTION_DEPLOYMENT_CONFIRMED`를 설정합니다. 기본 dry-run은 GitHub를 변경하지 않으며 임시 artifact를 검사 직후 삭제합니다.

```powershell
$env:RELEASE_ID = "release-2026.08.31"
$env:RELEASE_IMAGE_REFERENCE = "ghcr.io/owner/image@sha256:64자리_digest"
$env:RELEASE_REGISTRY_HOST = "ghcr.io"
$env:PRODUCTION_DEPLOYMENT_CONFIRMED = "DEPLOYED_ACCEPTED_CANDIDATE"
$env:RELEASE_CLOSEOUT_MAX_DELAY_HOURS = "24"
npm --prefix server run build
npm --prefix server run coordinate:release-finalization
```

최종화 조정기는 인수 artifact에 보관된 일곱 원본과 스테이징 번들을 인수 시각 기준으로 동일한 판정기에 다시 입력해 인수 보고서 전체를 재현합니다. 일곱 증빙의 세부 판정·관측시각·유효기간뿐 아니라 스테이징 번들 요약의 `observedAt`·`ageHours`까지 원본과 일치해야 하므로, 원본 해시와 인수 매니페스트를 함께 다시 만든 변조도 다음 단계 전에 차단합니다.

운영 배포 검증 보고서는 스키마 2와 인수 `releaseId`를 기록하고 전체 정규 필드를 `evidenceSha256`으로 봉인합니다. 각 API 표본의 번호·지연시간·liveness·readiness·후보 일치 여부만 `probes`에 보관하며 URL·토큰·응답 본문은 기록하지 않습니다. closeout, 최종화 조정기와 롤백 리허설은 기대 릴리스 ID와 digest를 대조한 뒤 이 기록에서 완료·실패·상태·후보 불일치 수와 p50/p95/p99/max를 다시 계산합니다. 또한 정규 `startedAt`이 `completedAt`보다 늦지 않고 웹 검증의 `checkedAt`이 전체 `completedAt`과 정확히 같아야 하며, 집계·임계값·시각 계약 중 하나라도 불일치하면 증빙을 거부합니다.

HTTPS 증빙은 스키마 3, 메일·법무 결합 증빙은 스키마 2로 `releaseId`를 각 정규 입력과 `evidenceSha256`에 포함합니다. HTTPS 생성 단계는 선택한 배포 보고서의 릴리스 ID와 직접 대조하고, closeout과 최종화 조정기는 세 보조 증빙의 릴리스 ID가 인수 릴리스와 모두 같은지 다시 확인하므로 해시가 자체적으로 유효하더라도 다른 릴리스의 보조 증빙은 사용할 수 없습니다.

인수가 유효하고 아직 배포 검증이 없으면 필수 운영 Secret 9개와 배포 완료 확인을 요구한 뒤 검증을 계획합니다. 성공한 배포 검증 artifact의 주 보고서는 API 표본 계획·완료·실패 수, 상태 실패·후보 불일치 0건, 빈 실패 목록, 정렬된 p50/p95/p99/max와 p95 임계값, 정규 실행 시각, 웹 검증의 동일 완료 시각과 13개 판정을 모두 확인합니다. HTTPS 18개 판정, 메일 9개 판정, 법무 결합 7개 판정과 후보·시각·프리플라이트 원본 동일성도 확인하고, 세 보조 JSON의 정규 입력을 다시 직렬화해 각 `evidenceSha256`을 재현 검증해야 다음 dry-run이 동일한 인수·검증 run ID로 closeout을 계획합니다. HTTPS 증빙의 배포 보고서 해시는 선택된 주 보고서 원본과, 세 증빙의 프리플라이트·환경 해시는 서로 일치해야 하며 운영 검증 → HTTPS → 메일 → 법무 생성 시각은 비역행 순서와 artifact 생성 시각을 만족해야 합니다. 보조 파일이 누락·실패·교체되었거나 내부 digest·원본 계보가 불일치하거나 event ID 원문을 포함하면 조정 단계에서 차단합니다. 완료된 closeout은 19개 판정 전체 통과와 함께 보관된 인수·배포·HTTPS·메일·법무 결합 원본 다섯 파일을 실제 바이트로 다시 해시해 `artifacts` 값과 모두 일치해야 합니다. 특히 closeout에 보관된 인수·배포 주 보고서와 HTTPS·메일·법무 보조 증빙 해시는 조정기가 독립적으로 내려받은 선택 성공 run의 각 원본 바이트 해시와도 일치해야 하므로 다른 run의 원본 혼입을 차단합니다. 종료 보고서의 인수 매니페스트 SHA-256도 앞서 검증한 인수 보고서 값과 직접 대조합니다. 이어 종료 보고서의 정규 입력과 판정 순서를 재구성해 `closeoutSha256`까지 직접 재계산하며, digest를 다시 만든 인수 필드 교체나 형식만 맞는 임의 digest도 완료로 인정하지 않습니다. 진행 중이거나 완료된 동일 릴리스 실행은 중복 생성하지 않습니다. 각 계획은 아래 확인 문자열이 있을 때 한 단계만 발송하므로 운영 배포와 검증 결과 사이에서 다시 확인할 수 있습니다.

```powershell
npm --prefix server run coordinate:release-finalization -- --apply --confirm AUTHORIZE_SOLO_PRODUCTION_RELEASE
```

### 배포 후 동일성·롤백 판정

API 컨테이너에는 인수 결과와 같은 `DEPLOYMENT_COMMIT_SHA`, `DEPLOYMENT_IMAGE_DIGEST`를 주입합니다. 전용 Bearer 토큰으로 보호된 `/api/v1/internal/release-identity`는 이 두 식별값만 반환하며 사용자 데이터·Secret·레지스트리 주소를 노출하지 않습니다.

```powershell
$env:DEPLOY_VERIFY_BASE_URL = "https://api.example.com"
$env:DEPLOY_VERIFY_WEB_BASE_URL = "https://www.example.com"
$env:OPERATIONS_METRICS_TOKEN = "운영_메트릭_토큰"
$env:DEPLOY_VERIFY_RELEASE_ID = "인수_결과의_releaseId"
$env:DEPLOY_VERIFY_EXPECTED_COMMIT_SHA = "인수_결과의_commitSha"
$env:DEPLOY_VERIFY_EXPECTED_IMAGE_DIGEST = "인수_결과의_imageDigest"
$env:DEPLOY_VERIFY_EXPECTED_WEB_MANIFEST_SHA256 = "인수_결과의_webDeployment_sha256"
$env:DEPLOY_VERIFY_SAMPLES = "3"
npm --prefix server run verify:deployment | Tee-Object production-deployment-verification.json
```

기본적으로 2초 간격 3회 동안 liveness·readiness와 API 배포 식별값을 확인하고 전체 p95가 1초 이하여야 통과합니다. 이어서 운영 웹의 `web-deployment-manifest.json` 원문 SHA-256을 인수 증빙과 대조하고, 대표 `index.html`과 해시 자산의 실제 바이트·Content-Type·Cache-Control을 검증합니다. HTML과 매니페스트는 `max-age=0,must-revalidate`, 해시 자산은 `max-age=31536000,immutable`이어야 합니다. 한 번이라도 조회 실패, 상태 비정상, 후보·파일 불일치 또는 지연 임계값 초과가 발생하면 `rollbackRecommended: true`와 종료 코드 1을 반환합니다. 결과에는 대상 URL과 토큰을 기록하지 않습니다. GitHub Actions의 `Production deployment verification` 수동 워크플로에는 인수 결과의 `webDeployment.sha256`을 함께 입력합니다. production 환경 Secret에는 `PRODUCTION_API_BASE_URL`, `PRODUCTION_WEB_BASE_URL`, `PRODUCTION_OPERATIONS_METRICS_TOKEN`을 등록합니다.

### 최종 릴리스 종료 기록

배포 인수 결과와 배포 후 검증 결과를 같은 디렉터리에 내려받은 뒤 최종 종료 기록을 생성합니다.

```powershell
$env:RELEASE_CLOSEOUT_ACCEPTANCE_REPORT = "evidence/release-acceptance.json"
$env:RELEASE_CLOSEOUT_DEPLOYMENT_REPORT = "evidence/production-deployment-verification.json"
$env:RELEASE_CLOSEOUT_MAX_DELAY_HOURS = "24"
npm --prefix server run close:release | Tee-Object release-closeout.json
```

종료 도구는 일곱 인수 증빙과 스테이징 부하·soak 번들 통과, 인수 매니페스트, 배포 상태 표본 완료, p95, 롤백 판정, 후보 커밋·이미지 digest와 운영 웹 매니페스트 SHA-256 일치 여부를 다시 검사합니다. 운영 HTTPS 증빙 스키마 2, 후보 SHA, 배포 검증 시각과 18개 판정, 메일 증빙 스키마 1, 같은 후보·프리플라이트 시각과 9개 판정, 법무 결합 증빙의 같은 후보·프리플라이트 원본과 7개 판정도 모두 일치해야 합니다. 스테이징 번들 SHA-256도 `release-closeout.json`에 전달되어 최종화 단계까지 동일성을 검사합니다. 배포 검증은 인수 후에 실행되어야 하며 기본 24시간 안에 완료되어야 합니다. 인수·배포 검증·HTTPS·메일·법무 결합 증빙 다섯 입력 파일의 SHA-256, 인수 `manifestSha256`, 정규화된 인수·검증 시각, 계산된 지연시간, 판정 정책과 결과는 `closeoutSha256`으로 결합됩니다. 최종화 조정기도 타임라인을 두 원본 보고서에서 다시 계산해 일치 여부를 확인합니다. 원본 파일 경로·상세·대상 URL은 복제하지 않습니다. `release-closeout.json`을 배포 검증 artifact와 함께 최종 변경승인 기록에 보관합니다.

GitHub Actions의 `Release closeout` 수동 워크플로는 `production` 환경 승인 후 성공한 후보 인수 run ID와 운영 배포 검증 run ID를 입력받습니다. 두 artifact를 현재 저장소에서 정확한 이름으로 내려받고, 릴리스 ID·소문자 40자리 커밋 SHA·불변 이미지 참조와 배포 검증의 예상 digest를 먼저 대조합니다. 그 후 인수에 사용된 동일 이미지에서 종료 도구를 실행하므로 다른 이미지나 가변 태그로 종료 기록을 만들 수 없습니다. 기본 검증 지연 한도는 24시간이고 입력 가능 범위는 1~168시간입니다.

성공 결과 `release-closeout-{releaseId}-{runId}` artifact에는 `release-closeout.json`, 원본 `release-acceptance.json`, `production-deployment-verification.json`, `transport-security-evidence.json`, `mail-operations-evidence.json`, `legal-approval-binding.json`만 포함되며 90일 보관됩니다. `ok: true`와 `closeoutSha256`을 변경승인 기록에 첨부한 뒤에만 릴리스를 종료합니다. 후보 불일치, 롤백 권고, HTTPS·메일·법무 결합 증빙 실패, 불완전한 표본, 시간 역전·만료 또는 원본 보고서 오류가 있으면 artifact는 조사용으로 남기되 워크플로는 실패합니다.

### 안전한 이미지 롤백 승인

배포 검증이 `rollbackRecommended: true`를 반환했을 때 현재 후보의 인수 결과, 실패한 배포 검증, 직전 정상 릴리스의 `release-closeout.json`으로 롤백 계획을 생성합니다.

```powershell
$env:ROLLBACK_CURRENT_ACCEPTANCE_REPORT = "evidence/current-release-acceptance.json"
$env:ROLLBACK_FAILED_DEPLOYMENT_REPORT = "evidence/failed-deployment-verification.json"
$env:ROLLBACK_TARGET_CLOSEOUT_REPORT = "evidence/previous-release-closeout.json"
$env:ROLLBACK_DATABASE_STRATEGY = "forward-only"
$env:ROLLBACK_CONFIRMATION = "AUTHORIZE_FORWARD_ONLY_IMAGE_ROLLBACK"
$env:ROLLBACK_FAILURE_MAX_AGE_HOURS = "24"
npm --prefix server run plan:rollback | Tee-Object release-rollback-plan.json
```

`rollbackAuthorized`가 `true`일 때만 결과의 `target.imageReference`를 `API_IMAGE`로, `target.commitSha`와 `target.imageDigest`를 배포 식별 환경변수로 설정해 API와 모든 워커를 함께 교체합니다. 동시에 `target.webDeploymentManifestSha256`과 일치하는 이전 웹 artifact를 CDN에 배포해야 하며 API만 단독으로 되돌리지 않습니다. 이 도구는 배포 플랫폼을 직접 변경하지 않습니다. Prisma 운영 마이그레이션을 down하거나 복원하지 않으며 DB는 forward-only 호환 상태를 유지합니다. 교체 직후 `Production deployment verification` 워크플로를 대상 커밋·digest·웹 매니페스트 SHA-256으로 다시 실행합니다. 롤백 계획은 세 입력 파일의 SHA-256, API·웹 목표 식별값과 정책·판정을 `rollbackPlanSha256`으로 결합하며 파일 경로와 원본 오류 상세는 기록하지 않습니다.

운영 배포 전 롤백 리허설에서는 현재 후보를 인수한 뒤, 운영과 분리되고 호스트명에 `staging`, `test`, `sandbox`, `drill` 또는 `rehearsal` 표식이 있는 HTTPS 환경에 직전 정상 closeout의 API 이미지와 웹 artifact를 배포합니다. 해당 환경을 `verify:deployment`로 재검증한 다음 아래 증빙을 생성합니다.

```powershell
$env:ROLLBACK_REHEARSAL_DRILL_ID = "rollback-drill-2026-q3"
$env:ROLLBACK_REHEARSAL_ENVIRONMENT = "isolated-staging-drill"
$env:ROLLBACK_REHEARSAL_API_BASE_URL = "https://api.rollback-drill.example.com"
$env:ROLLBACK_REHEARSAL_WEB_BASE_URL = "https://web.rollback-drill.example.com"
$env:ROLLBACK_REHEARSAL_CURRENT_ACCEPTANCE_REPORT = "evidence/current-release-acceptance.json"
$env:ROLLBACK_REHEARSAL_TARGET_CLOSEOUT_REPORT = "evidence/previous-release-closeout.json"
$env:ROLLBACK_REHEARSAL_DEPLOYMENT_REPORT = "evidence/rollback-deployment-verification.json"
npm --prefix server run verify:rollback-rehearsal |
  Out-File -LiteralPath "rollback-rehearsal-evidence.json" -Encoding utf8
```

결과는 세 원본 파일의 SHA-256, 현재·이전 후보의 불변 식별값, 재검증 상태와 시간 순서를 결합합니다. 실제 URL과 원본 보고서 상세는 복제하지 않으며 `ok: true`와 `evidenceSha256`을 변경승인 기록에 첨부합니다.

동일 절차는 GitHub Actions의 `Rollback rehearsal verification` 수동 워크플로로 실행할 수 있습니다. 저장소 Secret `ROLLBACK_DRILL_API_BASE_URL`, `ROLLBACK_DRILL_WEB_BASE_URL`, `ROLLBACK_DRILL_OPERATIONS_METRICS_TOKEN`을 등록하고, 직전 정상 API·워커·웹을 격리 환경에 먼저 배포한 뒤 `AUTHORIZE_ISOLATED_ROLLBACK_REHEARSAL` 확인 문자열과 현재 인수·직전 closeout run ID를 입력합니다. 워크플로는 운영으로 보이는 호스트와 HTTP 원격 대상을 요청 전에 차단하고, 성공·실패와 관계없이 원본 및 봉인 결과를 `rollback-rehearsal-{drillId}-{runId}` artifact로 90일 보관합니다.

실행 ID 오입력과 중복 리허설을 방지하려면 조정 도구를 먼저 사용합니다. dry-run은 현재 후보의 원격 게시·깨끗한 작업트리, 지정 운영자, 활성 워크플로, 리허설 Secret 이름, 성공한 현재 인수와 직전 closeout의 정확한 artifact 이름, 동일 drill ID 실행 여부를 검사하며 GitHub를 변경하지 않습니다.

```powershell
$env:ROLLBACK_REHEARSAL_DRILL_ID = "rollback-drill-2026-q3"
$env:ROLLBACK_REHEARSAL_CURRENT_RELEASE_ID = "release-current"
$env:ROLLBACK_REHEARSAL_CURRENT_ACCEPTANCE_RUN_ID = "현재_인수_run_ID"
$env:ROLLBACK_REHEARSAL_TARGET_RELEASE_ID = "release-previous"
$env:ROLLBACK_REHEARSAL_TARGET_CLOSEOUT_RUN_ID = "직전_closeout_run_ID"
npm --prefix server run coordinate:rollback-rehearsal
```

모든 검사가 통과하고 직전 정상 버전을 격리 환경에 실제 배포한 뒤에만 한 번 발송합니다.

```powershell
npm --prefix server run coordinate:rollback-rehearsal -- --apply --confirm AUTHORIZE_ISOLATED_ROLLBACK_REHEARSAL
```

### 브라우저·모바일 캡처 검증

`npm run test:e2e:field`는 Chromium·Firefox 데스크톱과 Pixel 7 Chrome·iPhone 14 WebKit 규격에서 반응형 내비게이션, 시대 탭 가로 스크롤, 지연 노출 콘텐츠, React 진입 화면의 잘림과 문서 가로 넘침을 검사합니다. Android·iPhone에서는 강의 API의 지연 응답과 최초 503 응답을 재현해 기본 셸 우선 표시와 수동 재시도 복구까지 확인합니다. 성공 시에도 환경별 전체 페이지와 모바일 메뉴·저속 로딩·장애·복구 화면을 `test-results`에 저장합니다. CI의 browser 작업은 전체 E2E와 함께 이 검사를 수행하고 캡처·실패 스크린샷·재시도 trace와 커밋에 결합된 `field-validation-report.json`을 `browser-field-validation-{run_id}` artifact로 14일 보관합니다. 보고서에는 네 필수 브라우저 규격의 통과·실패·건너뜀·flaky 건수만 기록하며 URL, 오류 상세와 캡처 경로는 포함하지 않습니다.

`OPERATIONS_METRICS_TOKEN`에는 32자 이상의 URL-safe 난수 토큰을 등록합니다. Prometheus는 `/api/v1/internal/worker-metrics`를 Bearer 인증으로 수집하고 API 네트워크 정책은 모니터링 시스템의 사설 주소만 허용합니다. 전체 상태 2, 오래된 잠금 1건 이상, 최종 실패 1건 이상을 경보로 연결하되 이 메트릭을 API 컨테이너의 liveness probe로 사용하지 않습니다.

## 악성 파일 검사

소형 학습자료는 운영 API가, MP4 영상은 독립 `video-scan-worker`가 `MALWARE_SCANNER_HOST`의 ClamAV `clamd`에 TCP `INSTREAM`으로 격리 파일을 전송합니다. 3310 포트는 인증·암호화를 제공하지 않으므로 공개 인터넷에 노출하지 않고 API·워커와 같은 사설망에서만 허용합니다. 공식 ClamAV 컨테이너는 서명 데이터 볼륨을 영속화하고 최소 3GB, 권장 4GB 이상의 메모리를 배정합니다.

ClamAV `StreamMaxLength`, `MaxFileSize`, `MaxScanSize`는 `VIDEO_UPLOAD_MAX_BYTES` 이상이어야 합니다. 로컬 `deploy/clamav/Dockerfile`은 2GB 업로드 상한에 맞춰 2200MB로 설정합니다. 운영 ClamAV도 같은 기준의 `clamd.conf`를 배포해야 합니다. 영상 워커는 기본 5초 간격으로 작업을 가져오고 1분·5분·30분 간격으로 최대 3회 재시도합니다. `VIDEO_SCAN_POLL_INTERVAL_MS`, `VIDEO_SCAN_MAX_ATTEMPTS`, `VIDEO_SCAN_LOCK_TIMEOUT_MS`로 조정하며 검사 통과 전에는 새 영상이 재생 자산에 연결되지 않습니다.

`video-cleanup-worker`는 24시간 지난 미완료 업로드와 교체 후 24시간 보존기간이 지난 이전 관리형 영상을 영속 DB 큐로 삭제합니다. 삭제 직전 현재 강의 참조를 재검사하고 장애 시 최대 5회 재시도합니다. `VIDEO_UPLOAD_ABANDONED_AFTER_HOURS`, `VIDEO_REPLACED_RETENTION_HOURS`, `VIDEO_CLEANUP_*`로 정책을 조정합니다. 저장소 자격증명에는 `DeleteObject` 권한이 필요합니다. 버전 관리 버킷에서는 단순 삭제가 삭제 마커를 만들므로 비현재 버전 만료는 별도 Lifecycle 규칙으로 운영합니다.
