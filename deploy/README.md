# 배포 실행안

제안서의 확정 기준은 프런트 정적 호스팅, Docker API, 관리형 PostgreSQL입니다.
클라우드 사업자와 도메인이 정해지기 전까지 이 디렉터리는 사업자 중립 배포 기준으로 사용합니다.

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

계정 보안 토큰의 기본 유효기간은 비밀번호 재설정 30분, 이메일 인증 24시간입니다. 운영 응답에는 개발용 토큰이 포함되지 않으며 SMTP로 `PUBLIC_APP_URL`의 계정 링크를 발송합니다. 운영 배포에는 `SMTP_HOST`, `MAIL_FROM`, `PUBLIC_APP_URL`이 필수입니다. 587 포트는 STARTTLS를 강제하고 465 포트는 implicit TLS 설정을 사용합니다. 발송 결과는 감사로그에 남지만 영속 발송 큐, 자동 재시도, 반송·불만 신고 처리는 운영 고도화 항목입니다.

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

프리플라이트는 최신 DB 스키마, 객체 저장소의 임시 객체 쓰기·읽기·삭제, 설정된 CloudFront 서명 URL의 실제 바이트 조회, FFmpeg·FFprobe 실행 가능 여부, ClamAV 정상 스트림 검사, SMTP DNS·TCP·TLS·인증, 토스페이먼츠 Secret Key 설정과 필수 OAuth 설정을 점검합니다. 메일·결제 변경은 발생시키지 않으며 결과 JSON에는 Secret과 CDN 서명 URL을 기록하지 않습니다. 임시 저장소 키는 `lesson-videos/preflight/` 또는 `lesson-hls/preflight/` 아래에 만들고 성공·실패와 관계없이 삭제를 시도합니다. 운영에서 CDN을 필수화하려면 `PREFLIGHT_REQUIRE_CDN=true`로 두고, 일부 OAuth 공급자를 의도적으로 제외하려면 `PREFLIGHT_REQUIRED_OAUTH_PROVIDERS`를 실제 제공 목록으로 조정합니다.

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

별도 제어 부하가 실행되는 동안 보호된 Prometheus 메트릭을 반복 수집해 5개 영속 큐의 적체 증가, 오래된 잠금, 최종 실패 증가, `critical` 상태와 메트릭 응답 p95를 판정합니다. 이 도구 자체는 작업·메일·영상·결제를 생성하거나 변경하지 않는 읽기 전용 관측기입니다.

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

기본 실행은 약 10분이며 샘플 실패, 갱신되지 않거나 역행한 메트릭 시각, `critical` 1회 이상, stale lock 1건 이상, 큐별 대기 작업 증가 또는 관측 기간 중 최종 실패 증가가 있으면 종료 코드 1을 반환합니다. 관측 시작 전에 이미 존재한 최종 실패 건수는 기준선으로만 기록합니다. 대상은 localhost 또는 호스트명에 `staging`, `stage`, `test`, `sandbox`, `load`, `perf` 표식이 있는 환경으로 제한되고 결과에는 대상 URL·토큰·원시 메트릭을 기록하지 않습니다. GitHub Actions의 `Staging worker queue soak` 수동 워크플로는 동일한 스테이징 Secret을 사용하며 결과를 30일 artifact로 보관합니다.

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

기본 유효기간은 프리플라이트 24시간, 복구훈련 100일, 부하·워커 soak·웹 배포·현장 브라우저·공급망 증빙 각각 7일입니다. 필요하면 `RELEASE_PREFLIGHT_MAX_AGE_HOURS`, `RELEASE_RECOVERY_MAX_AGE_HOURS`, `RELEASE_LOAD_MAX_AGE_HOURS`, `RELEASE_WORKER_SOAK_MAX_AGE_HOURS`, `RELEASE_WEB_DEPLOYMENT_MAX_AGE_HOURS`, `RELEASE_FIELD_VALIDATION_MAX_AGE_HOURS`, `RELEASE_SUPPLY_CHAIN_MAX_AGE_HOURS`로 더 엄격하게 줄일 수 있습니다. 웹 배포 증빙은 CI의 `web-release-{commitSha}` artifact 안에 있는 `web-deployment-manifest.json`, 현장 증빙은 `browser-field-validation-{runId}` artifact 안의 `field-validation-report.json`, 공급망 증빙은 `release-supply-chain-{commitSha}` artifact 안의 `manifest.json`을 사용합니다. 가변 이미지 태그, 후보 커밋 불일치, 미래 시각, 웹 파일 해시·캐시 정책 불일치, 취약점 정책 불일치, 웹·API SBOM 누락, 필수 브라우저 규격 누락·실패·flaky, 미완료 표본 또는 실패 임계값이 있으면 종료 코드 1을 반환합니다. 성공 결과에는 정확한 이미지 불변 참조, 일곱 원본 증빙의 SHA-256과 이를 다시 결합한 `manifestSha256`이 포함됩니다. 보고서 파일 경로와 원본 상세는 복제하지 않으므로 `release-acceptance.json`을 최종 변경승인 기록에 첨부하고 같은 `imageReference`를 `API_IMAGE`로 배포합니다.

### GitHub 릴리스 착수 준비 감사

후보 인수 워크플로를 실행하기 전에 로컬 후보와 GitHub 설정을 읽기 전용으로 점검합니다.

```powershell
npm --prefix server run build
npm --prefix server run audit:release-readiness | Tee-Object release-readiness.json
```

감사 도구는 로컬 후보 커밋이 원격 기본 브랜치에 게시되었는지, 작업 트리가 깨끗한지, 일곱 개 필수 워크플로가 활성 상태인지, `production` 환경에 승인 검토자와 필수 Secret 이름이 등록되었는지 검사합니다. 승인 규칙은 본인 승인을 차단해야 하며, 배포 브랜치는 보호된 브랜치만 허용하거나 기본 브랜치 하나만 정확히 허용해야 합니다. 저장소에는 `RELEASE_READINESS_TOKEN` Secret도 필요합니다. Secret 값은 조회하거나 결과에 기록하지 않습니다. 모든 항목이 통과하면 `ok: true`와 종료 코드 0을 반환하고, 누락 항목이 있으면 각 항목의 안정적인 오류 코드와 종료 코드 1을 반환합니다. 후보 인수 실행은 `ok: true`를 확인한 뒤에만 시작합니다.

GitHub Actions의 `Release readiness audit` 수동 워크플로도 같은 감사를 실행합니다. 이 워크플로는 `production` 환경에 진입하지 않으므로 환경 자체가 없거나 승인 설정이 잘못된 경우도 진단할 수 있습니다. `RELEASE_READINESS_TOKEN`에는 대상 저장소의 Metadata·Actions·Contents·Environments·Secrets 읽기 권한만 부여한 fine-grained PAT 또는 동등한 단기 GitHub App 토큰을 등록합니다. 결과는 성공 여부와 관계없이 `release-readiness-{commitSha}-{runId}` artifact로 30일간 보관한 뒤 감사 판정이 실패했으면 워크플로도 실패 처리합니다.

### 후보 커밋 인수 자동화

GitHub Actions의 `Release candidate acceptance` 수동 워크플로는 `production` 환경 승인을 받은 뒤 불변 후보 이미지를 직접 실행합니다. 프리플라이트와 격리 복구훈련은 해당 이미지에서 새로 생성하고, 성공한 `Staging read-only load test`, `Staging worker queue soak`, CI 실행의 run ID로 부하·워커·현장 브라우저·공급망 증빙을 내려받습니다. 후보 커밋은 소문자 40자리 SHA만, 이미지는 `repository@sha256:<64자리>` 형식만 허용합니다.

저장소의 `production` 환경에는 승인 검토자와 다음 Secret을 설정합니다.

- `PRODUCTION_PREFLIGHT_ENV_FILE_BASE64`: 운영 환경 파일 전체를 base64로 인코딩한 값. 원본에는 프리플라이트에 필요한 DB·Redis·OAuth·토스페이먼츠·SMTP·객체 저장소·CDN·ClamAV·복구 정책 설정이 들어가야 합니다.
- `PRODUCTION_DATABASE_URL`: 복구 대상이 운영 DB와 다른지 비교할 때만 사용하는 운영 DB 주소입니다.
- `RECOVERY_DATABASE_URL`: 실제 운영 DB와 분리되고 이름에 `recovery`, `restore`, `drill`, `staging`, `test` 또는 `sandbox` 표식이 있는 복원 DB 주소입니다.
- `CONTAINER_REGISTRY_USERNAME`, `CONTAINER_REGISTRY_PASSWORD`: 외부 또는 별도 권한이 필요한 비공개 레지스트리에만 등록합니다. 생략하면 GitHub 실행 주체와 작업 토큰을 사용합니다.

GitHub 실행기가 DB·Redis·객체 저장소·CDN·ClamAV·SMTP와 격리 복원 DB에 접근할 수 있어야 합니다. 프리플라이트 환경 파일은 권한 `0600`으로 잠시 복원하고 실행 직후 삭제하며 artifact 업로드 목록에서도 명시적으로 제외합니다. 결과 artifact `release-acceptance-{releaseId}-{runId}`에는 최종 인수 보고서와 일곱 원본 증빙만 포함되고 90일간 보관됩니다. 세 검증 실행 ID, 백업 생성 시각과 복원 시작 시각을 변경승인 기록에도 함께 남깁니다.

### 배포 후 동일성·롤백 판정

API 컨테이너에는 인수 결과와 같은 `DEPLOYMENT_COMMIT_SHA`, `DEPLOYMENT_IMAGE_DIGEST`를 주입합니다. 전용 Bearer 토큰으로 보호된 `/api/v1/internal/release-identity`는 이 두 식별값만 반환하며 사용자 데이터·Secret·레지스트리 주소를 노출하지 않습니다.

```powershell
$env:DEPLOY_VERIFY_BASE_URL = "https://api.example.com"
$env:DEPLOY_VERIFY_WEB_BASE_URL = "https://www.example.com"
$env:OPERATIONS_METRICS_TOKEN = "운영_메트릭_토큰"
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

종료 도구는 일곱 인수 증빙 통과, 인수 매니페스트, 배포 상태 표본 완료, p95, 롤백 판정, 후보 커밋·이미지 digest와 운영 웹 매니페스트 SHA-256 일치 여부를 다시 검사합니다. 배포 검증은 인수 후에 실행되어야 하며 기본 24시간 안에 완료되어야 합니다. 두 입력 파일의 SHA-256, 인수 `manifestSha256`, 판정 정책과 결과는 `closeoutSha256`으로 결합됩니다. 원본 파일 경로·상세·대상 URL은 복제하지 않습니다. `release-closeout.json`을 배포 검증 artifact와 함께 최종 변경승인 기록에 보관합니다.

GitHub Actions의 `Release closeout` 수동 워크플로는 `production` 환경 승인 후 성공한 후보 인수 run ID와 운영 배포 검증 run ID를 입력받습니다. 두 artifact를 현재 저장소에서 정확한 이름으로 내려받고, 릴리스 ID·소문자 40자리 커밋 SHA·불변 이미지 참조와 배포 검증의 예상 digest를 먼저 대조합니다. 그 후 인수에 사용된 동일 이미지에서 종료 도구를 실행하므로 다른 이미지나 가변 태그로 종료 기록을 만들 수 없습니다. 기본 검증 지연 한도는 24시간이고 입력 가능 범위는 1~168시간입니다.

성공 결과 `release-closeout-{releaseId}-{runId}` artifact에는 `release-closeout.json`, 원본 `release-acceptance.json`, `production-deployment-verification.json`만 포함되며 90일 보관됩니다. `ok: true`와 `closeoutSha256`을 변경승인 기록에 첨부한 뒤에만 릴리스를 종료합니다. 후보 불일치, 롤백 권고, 불완전한 표본, 시간 역전·만료 또는 원본 보고서 오류가 있으면 artifact는 조사용으로 남기되 워크플로는 실패합니다.

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

### 브라우저·모바일 캡처 검증

`npm run test:e2e:field`는 Chromium·Firefox 데스크톱과 Pixel 7 Chrome·iPhone 14 WebKit 규격에서 반응형 내비게이션, 시대 탭 가로 스크롤, 지연 노출 콘텐츠, React 진입 화면의 잘림과 문서 가로 넘침을 검사합니다. Android·iPhone에서는 강의 API의 지연 응답과 최초 503 응답을 재현해 기본 셸 우선 표시와 수동 재시도 복구까지 확인합니다. 성공 시에도 환경별 전체 페이지와 모바일 메뉴·저속 로딩·장애·복구 화면을 `test-results`에 저장합니다. CI의 browser 작업은 전체 E2E와 함께 이 검사를 수행하고 캡처·실패 스크린샷·재시도 trace와 커밋에 결합된 `field-validation-report.json`을 `browser-field-validation-{run_id}` artifact로 14일 보관합니다. 보고서에는 네 필수 브라우저 규격의 통과·실패·건너뜀·flaky 건수만 기록하며 URL, 오류 상세와 캡처 경로는 포함하지 않습니다.

`OPERATIONS_METRICS_TOKEN`에는 32자 이상의 URL-safe 난수 토큰을 등록합니다. Prometheus는 `/api/v1/internal/worker-metrics`를 Bearer 인증으로 수집하고 API 네트워크 정책은 모니터링 시스템의 사설 주소만 허용합니다. 전체 상태 2, 오래된 잠금 1건 이상, 최종 실패 1건 이상을 경보로 연결하되 이 메트릭을 API 컨테이너의 liveness probe로 사용하지 않습니다.

## 악성 파일 검사

소형 학습자료는 운영 API가, MP4 영상은 독립 `video-scan-worker`가 `MALWARE_SCANNER_HOST`의 ClamAV `clamd`에 TCP `INSTREAM`으로 격리 파일을 전송합니다. 3310 포트는 인증·암호화를 제공하지 않으므로 공개 인터넷에 노출하지 않고 API·워커와 같은 사설망에서만 허용합니다. 공식 ClamAV 컨테이너는 서명 데이터 볼륨을 영속화하고 최소 3GB, 권장 4GB 이상의 메모리를 배정합니다.

ClamAV `StreamMaxLength`, `MaxFileSize`, `MaxScanSize`는 `VIDEO_UPLOAD_MAX_BYTES` 이상이어야 합니다. 로컬 `deploy/clamav/Dockerfile`은 2GB 업로드 상한에 맞춰 2200MB로 설정합니다. 운영 ClamAV도 같은 기준의 `clamd.conf`를 배포해야 합니다. 영상 워커는 기본 5초 간격으로 작업을 가져오고 1분·5분·30분 간격으로 최대 3회 재시도합니다. `VIDEO_SCAN_POLL_INTERVAL_MS`, `VIDEO_SCAN_MAX_ATTEMPTS`, `VIDEO_SCAN_LOCK_TIMEOUT_MS`로 조정하며 검사 통과 전에는 새 영상이 재생 자산에 연결되지 않습니다.

`video-cleanup-worker`는 24시간 지난 미완료 업로드와 교체 후 24시간 보존기간이 지난 이전 관리형 영상을 영속 DB 큐로 삭제합니다. 삭제 직전 현재 강의 참조를 재검사하고 장애 시 최대 5회 재시도합니다. `VIDEO_UPLOAD_ABANDONED_AFTER_HOURS`, `VIDEO_REPLACED_RETENTION_HOURS`, `VIDEO_CLEANUP_*`로 정책을 조정합니다. 저장소 자격증명에는 `DeleteObject` 권한이 필요합니다. 버전 관리 버킷에서는 단순 삭제가 삭제 마커를 만들므로 비현재 버전 만료는 별도 Lifecycle 규칙으로 운영합니다.
