# 개발 가이드

## 1. 프로젝트 개요

바둑 학습과 한국사 스토리를 하나의 시대 여행으로 연결하는 초등학생 대상 에듀테인먼트 서비스입니다. 현재 결과물은 서비스 방향과 핵심 사용자 흐름을 검증하기 위한 정적 프론트엔드 프로토타입이며, 실서비스는 React + TypeScript와 Vite 기반으로 점진 이전합니다. 목표 스택은 [React 프런트엔드 기술 스택](./FRONTEND_STACK.md)을 참고합니다.

### 주요 사용자

- 학생: 시대별 강의, 바둑 미션, 역사 퀴즈, 보상 수집
- 학부모: 진도와 영역별 성취도 확인
- 지도자: 반 관리, 과제 배포, 수업 자료 활용
- 운영자: 강의·퀴즈·교재·회원·상담 관리

## 2. 기술 구성

| 구분 | 현재·전환 기술 |
|---|---|
| 기존 프로토타입 | HTML5, CSS3, Vanilla JavaScript |
| 실서비스 UI | React + TypeScript |
| 빌드·개발 서버 | Vite |
| 라우팅 | React Router |
| 서버 상태 | TanStack Query |
| API | Node.js 24 LTS, NestJS, Prisma, PostgreSQL |
| 테스트 | Vitest, Testing Library, jsdom, Playwright |
| 배포 기반 | Docker Compose, GitHub Actions |
| 기존 개발 서버 | Node.js 기본 `http` 모듈, 하위 호환용 |

Node.js 24 LTS를 개발·운영 기준으로 사용합니다.

## 3. 로컬 실행

React 전환 개발환경은 프로젝트 루트에서 다음 명령을 실행합니다.

```powershell
npm install
npm run dev
```

브라우저에서 Vite가 안내하는 주소로 접속합니다. 기존 정적 홈페이지는 `/index.html`, React 전환 진입점은 `/app.html`, 실제 계정 API 연결 화면은 `/account`, 보호자 연결 화면은 `/guardian`, 공개 강의 탐색은 `/lessons`, 개인 알림함은 `/notifications`입니다. Vite 개발·미리보기 서버는 React 경로와 `/lessons/{lessonId}` 직접 진입을 React 앱으로 되돌립니다. 운영 정적 호스팅에도 같은 rewrite 규칙을 설정해야 합니다. 개발 서버의 `/api` 요청은 `http://127.0.0.1:3000`으로 전달되므로 API 연결 화면을 사용할 때는 API도 함께 실행합니다.

기존 정적 프로토타입만 확인하려면 다음 명령도 유지합니다.

```powershell
node dev-server.mjs
```

브라우저에서 `http://127.0.0.1:4173`으로 접속합니다.

검증 명령:

```powershell
npm run typecheck
npm test
npm run build
```

API를 함께 개발하려면 로컬 PostgreSQL을 실행하고 예제 환경 파일을 복사합니다.

```powershell
docker compose up -d database
Copy-Item server/.env.example server/.env
npm --prefix server install
npm --prefix server run db:deploy
npm run dev:api
```

API 주소는 `http://127.0.0.1:3000/api/v1`이며 상태 확인 경로는
`/health/live`와 `/health/ready`입니다. 전체 검증은 다음 명령을 사용합니다.

운영자 계정의 `GET /admin/operations/worker-health`는 5개 영속 작업 큐의 적체와 오래된 잠금을 조회합니다. `WORKER_HEALTH_BACKLOG_MINUTES`는 기한이 지난 작업을 `critical`로 판단하는 시간이며 기본값은 15분입니다. API 준비 상태와 분리되어 있으므로 이 결과는 API 컨테이너 재시작 조건 대신 운영 알림과 워커 재시작 판단에 사용합니다.

Prometheus 수집기는 `OPERATIONS_METRICS_TOKEN`을 Bearer 토큰으로 사용해 `/api/v1/internal/worker-metrics`를 조회합니다. `baduk_worker_health_status >= 2`, `baduk_worker_queue_stale_locks > 0`, `baduk_worker_queue_terminal_errors > 0`을 운영 경보 기준으로 사용합니다. 메트릭 토큰은 OAuth·세션·결제 Secret과 분리하고 정기 교체합니다.

현재 인증 API는 이메일 회원가입·로그인·로그아웃·세션 갱신과 `/me` 조회, 이메일 인증, 비밀번호 재설정, 로그인 계정의 소셜 연결 조회·연결·해제와 계정 탈퇴를 지원합니다. 세션과 계정 보안 토큰 원문은 데이터베이스에 저장하지 않고 해시만 저장합니다. 공개 회원가입은 `student`와 `guardian` 역할만 허용하며 운영 권한은 관리 절차를 통해 별도로 부여해야 합니다. `/account`에서 인증·복구·소셜 연결과 탈퇴 흐름을 확인할 수 있고 개발·테스트 환경에서는 SMTP를 설정하지 않아도 검증용 토큰이 화면에 표시됩니다.

비밀번호 계정 탈퇴는 `DELETE /me`에 확인 문구 `회원탈퇴`와 현재 비밀번호를 전송합니다. 소셜 전용 계정은 `GET /me/account-deletion/oauth/{provider}/start`에서 연결된 제공사 ID를 다시 확인합니다. 완료 시 모든 세션과 로그인 수단을 제거하고 이메일을 비우므로 같은 이메일로 다시 가입할 수 있습니다. 결제·환불·감사 기록은 삭제하지 않고 익명화된 내부 계정 ID와 함께 보존 정책을 적용합니다.

SMTP 발송을 확인하려면 `PUBLIC_APP_URL`, `SMTP_HOST`, `SMTP_PORT`, `MAIL_FROM`, `MAIL_DKIM_SELECTOR`, `MAIL_BOUNCE_WEBHOOK_SECRET`을 설정하고 인증이 필요한 서버에는 `SMTP_USER`, `SMTP_PASSWORD`를 함께 입력합니다. 587 포트는 `SMTP_SECURE=false`, `SMTP_REQUIRE_TLS=true`, 465 포트는 `SMTP_SECURE=true`, `SMTP_REQUIRE_TLS=false`를 사용합니다. 발신 도메인에는 SPF TXT 레코드가 정확히 하나 있어야 하고, `{MAIL_DKIM_SELECTOR}._domainkey.{발신도메인}`에는 공개키가 있는 DKIM TXT 레코드, `_dmarc.{발신도메인}`에는 `p=quarantine` 또는 `p=reject` 정책이 필요합니다. API 빌드 후 `npm --prefix server run preflight:production`은 SMTP DNS·TLS·인증과 세 레코드를 실시간 확인하며 테스트 메일은 보내지 않습니다. 결과에는 DNS 원문 대신 DMARC 정책과 발신 도메인·DKIM 선택자·정규화된 세 레코드 집합의 SHA-256을 기록하므로, 인수 증빙에서 DNS 변경 여부를 대조할 수 있습니다.

SMTP 공급자나 정규화 게이트웨이는 영구 반송을 `POST /api/v1/mail/webhooks/bounce`에 `Authorization: Bearer {MAIL_BOUNCE_WEBHOOK_SECRET}`과 `{ "event": "permanent_bounce", "eventId": "<provider event id>", "messageId": "<SMTP message id>" }` JSON으로 전달합니다. `eventId`는 영문·숫자와 `._:-`만 사용하는 200자 이하의 안정적인 공급자 식별자여야 합니다. 서버는 일치하는 계정 메일 또는 문의 알림 작업을 멱등하게 `BOUNCED`로 바꾸고 감사로그에 반송 유형과 event ID의 SHA-256만 기록합니다. 최초 상태 변경 응답의 `auditLogId`와 `eventIdSha256`을 보관하고, 운영 프리플라이트 JSON·웹훅 응답 JSON을 `npm --prefix server run verify:mail-operations`로 교차 검증하면 비식별 `mail-operations-evidence.json`을 생성할 수 있습니다. 결과에는 공급자 event ID 원문도 포함되지 않습니다. 수신자 주소, event ID 원문과 공급자의 원문 오류는 감사로그에 저장하지 않습니다. 계정 API와 문의 답변 API는 메일 서버 응답을 기다리지 않으며 발송·반송 결과는 감사로그에서 확인합니다. 문의 알림에는 문의 제목·본문·답변을 포함하지 않고 `PUBLIC_APP_URL`의 본인 문의함 링크만 제공합니다.

OAuth는 제공사별 client ID·secret·redirect URI 세 항목을 모두 설정한 경우에만 활성화됩니다. React 설정의 `oauthEnabled`와 `oauthProviders`는 버튼 표시만 제어하며 secret을 포함하지 않습니다. API는 10분 기본 만료의 해시 state, PKCE와 nonce를 사용하고 콜백을 한 번만 소비합니다. 동일 이메일의 기존 계정은 자동 병합하지 않고 `/account`의 명시적 연결을 요구합니다. 한 계정에는 제공사별 연결 하나만 허용하며 타 계정 소유 ID와 마지막 로그인 수단의 해제를 차단합니다. OAuth·결제 공급자 모듈을 다른 NestJS 앱에서 사용하는 방법은 [재사용 통합 컴포넌트](../server/src/components/README.md)를 참고합니다.

인증 API는 클라이언트 IP와 기능별 고정 윈도우로 회원가입 10회/10분, 로그인 10회/5분, 비밀번호·이메일 복구 5회/15분, OAuth 시작 20회/5분을 제한하고 `RateLimit-*` 및 차단 시 `Retry-After` 헤더를 반환합니다. 로컬은 `TRUST_PROXY_HOPS=0`이며 운영 템플릿은 단일 역방향 프록시를 가정해 기본 1입니다. 실제 로드밸런서 수와 다르면 정확히 조정하고, 다중 API 인스턴스에서는 게이트웨이 또는 공유 저장소 기반 제한을 함께 적용합니다.

세션 쿠키가 포함된 `POST`, `PUT`, `PATCH`, `DELETE` 요청은 `CORS_ORIGINS` 또는 `PUBLIC_APP_URL`과 일치하는 웹 Origin만 허용합니다. 브라우저가 명시한 교차 사이트 요청은 `CSRF_ORIGIN_REJECTED`(403)로 차단합니다. 세션 쿠키가 없는 공개 API·결제 웹훅과 Origin 메타데이터를 보내지 않는 서버·CLI 클라이언트에는 이 검사가 적용되지 않으므로, 비브라우저 클라이언트는 TLS로 보호된 신뢰 경로에서만 세션 쿠키를 취급해야 합니다.

API 응답은 실행 가능한 문서 자원을 모두 거부하는 CSP와 `nosniff`, 프레이밍 차단, Referrer Policy를 전송하며 운영에서만 1년 HSTS와 `upgrade-insecure-requests`를 활성화합니다. Vite 개발·미리보기 서버도 [웹 보안 헤더 정책](../src/security/web-security-headers.ts)을 적용해 인라인 이벤트 스크립트·플러그인 콘텐츠·외부 프레이밍을 차단하고 토스페이먼츠 SDK만 외부 스크립트로 허용합니다. React Fast Refresh 초기화가 필요한 개발 서버만 `script-src 'unsafe-inline'` 예외가 있고 미리보기·운영 정책에는 이 예외가 없습니다. 실제 정적 호스팅/CDN에도 엄격한 미리보기 헤더를 복제하고, 운영에서는 `connect-src`, `media-src`, `frame-src`의 포괄적인 `https:`를 확정된 API·미디어·결제 도메인 목록으로 축소해야 합니다. 새 외부 SDK를 추가할 때는 CSP 허용 목록과 회귀 테스트를 함께 갱신합니다.

API의 JSON·URL 인코딩 본문은 `REQUEST_BODY_MAX_BYTES`로 제한하며 기본값은 1MiB, 허용 설정 범위는 1KiB~10MiB입니다. 초과 요청은 컨트롤러 실행 전에 `PAYLOAD_TOO_LARGE`(413)로 거부됩니다. 영상·학습자료 본문을 API 서버로 직접 업로드하지 말고 기존 비공개 객체 저장소 사전 서명 흐름을 사용합니다. 데이터베이스 조회는 Prisma의 구조화된 필터 또는 태그드 `$queryRaw`만 사용하고 `$queryRawUnsafe`, `$executeRawUnsafe`는 정책 테스트에서 금지합니다. PostgreSQL 통합 스모크는 SQL 공격 문자열이 바인딩 값으로만 처리되고 트랜잭션 롤백 뒤 데이터가 남지 않는지 확인합니다.

학생 계정은 `/guardian`에서 보호자 이메일 초대를 만들 수 있습니다. 개발·테스트 환경에서는 화면에 개발용 토큰이 표시됩니다. 보호자는 같은 화면에서 토큰을 확인하고 필수 학습정보 조회 범위에 동의한 뒤 연결합니다. 초대 유효기간은 `GUARDIAN_INVITATION_TTL_HOURS`로 설정하며 기본값은 72시간입니다.

`/lessons`는 `GET /eras`와 `GET /eras/{eraId}/lessons`를 사용하여 공개 강의를 표시합니다. `/lessons/{lessonId}`는 공개 강의 상세와 단계 구성을 조회합니다. 재생 권한 판정과 계정별 진도 저장까지 서버 API에 연결되어 있습니다.

강의 상세에서는 `GET /lessons/{lessonId}/playback`으로 무료 샘플·활성 구독·운영자 미리보기 권한을 확인합니다. 로그인 사용자는 강의를 시작하고 6개 단계를 완료한 뒤 최종 완료 상태를 서버에 저장할 수 있습니다. 영상 키가 없으면 `asset_pending`, 저장소 설정이 없으면 `signer_pending`, 서명이 완료되면 `ready`, `format`, `delivery`, 짧게 만료되는 URL을 반환합니다. React 플레이어는 MP4를 기본 `<video>`로 재생하고 HLS는 단일 영상 스트림에 필요한 HLS.js light 빌드를 재생 시점에 지연 로딩하며, 브라우저 네이티브 HLS를 대체 경로로 사용합니다. 준비된 HLS 패키지는 `lesson-hls/{lessonId}/{version}/master.m3u8` 규칙으로 저장하고 CMS에서 연결합니다.

S3 또는 S3 호환 비공개 저장소를 연결하려면 `server/.env`에 `OBJECT_STORAGE_BUCKET`과 리전을 설정합니다. 호환 사업자는 `OBJECT_STORAGE_ENDPOINT`와 필요 시 `OBJECT_STORAGE_FORCE_PATH_STYLE=true`를 추가합니다. 로컬 키는 `OBJECT_STORAGE_ACCESS_KEY_ID`, `OBJECT_STORAGE_SECRET_ACCESS_KEY`를 함께 사용하며 운영에서는 정적 키 대신 런타임 역할을 권장합니다. `PLAYBACK_URL_TTL_SECONDS`와 `VIDEO_UPLOAD_URL_TTL_SECONDS`의 기본값은 300초, 최대값은 900초입니다. `VIDEO_UPLOAD_MAX_BYTES`는 기본 2GB입니다. 버킷 공개 접근은 차단하고 프런트 도메인의 업로드 `POST`와 HLS.js 세그먼트 조회 `GET`·`HEAD`를 허용하는 CORS 규칙을 설정해야 합니다.

CloudFront를 사용하려면 `PLAYBACK_CDN_PROVIDER=cloudfront`, 경로 없는 HTTPS origin인 `PLAYBACK_CDN_BASE_URL`, 신뢰 키 그룹의 `PLAYBACK_CDN_KEY_PAIR_ID`, PEM 개인키를 base64로 인코딩한 `PLAYBACK_CDN_PRIVATE_KEY_BASE64`를 함께 설정합니다. 운영 배포에서 CDN을 필수로 강제하려면 `PREFLIGHT_REQUIRE_CDN=true`를 사용합니다. 사전점검은 임시 HLS 객체를 저장하고 CloudFront 서명 URL로 실제 바이트를 조회한 뒤 삭제하므로 배포·OAC·키 그룹·origin behavior 오류까지 검출합니다. 개인키 원문이나 base64 값은 저장소, 로그, 프런트 환경변수에 넣지 말고 비밀 관리 기능으로 주입합니다.

운영자·관리자로 로그인한 강의 상세 화면에는 MP4 업로드 영역이 표시됩니다. 브라우저가 서명된 POST 정책으로 저장소에 직접 업로드한 뒤 API가 선언 MIME, 예상·실제 크기, 강의 귀속 메타데이터와 MP4 첫 박스의 `ftyp`를 확인합니다. 영상은 DB 격리 작업으로 등록되고 별도 `npm --prefix server run start:video-scan-worker` 프로세스가 S3 스트림을 ClamAV로 검사합니다. 검사 통과 후 `start:hls-transcode-worker`가 FFprobe로 스트림을 확인하고 원본보다 높지 않은 최대 360p·720p H.264/AAC fMP4 VOD를 생성합니다. CMS는 변환 상태와 오류·시도 횟수를 표시하고 최종 오류는 운영자가 재시도할 수 있습니다. `start:video-cleanup-worker`는 미완료·교체 영상과 HLS로 전환된 원본을 보존기간 뒤 정리합니다.

`/admin/lessons`는 운영자·관리자 전용 React 강의 CMS입니다. 신규 강의는 비공개로 등록되고 역사 이야기·바둑 개념·바둑 미션·역사 미션·생각 한 수·보상 6단계가 자동 생성됩니다. 영상 연결과 6단계가 확인된 뒤에만 공개할 수 있으며, 공개 중단은 `draft`, 삭제 대체는 `archived` 상태를 사용합니다.

CMS의 썸네일·학습자료는 최대 `LESSON_ASSET_MAX_BYTES`까지 허용하며 기본값은 20MB입니다. 지원 형식은 썸네일 JPG·PNG·WebP, 자료 PDF·PPT·PPTX·DOC·DOCX·HWP·HWPX입니다. HWP/HWPX의 브라우저 MIME 편차는 확장자를 기준으로 각각 `application/x-hwp`, `application/hwp+zip`으로 정규화하며 서버가 내부 CFB/ZIP 구조를 다시 검증합니다. `MALWARE_SCANNER_HOST`, `MALWARE_SCANNER_PORT`, `MALWARE_SCANNER_TIMEOUT_MS`로 ClamAV `clamd`를 연결합니다. 스캐너가 없거나 오류가 발생하면 파일은 활성화되지 않고 격리 상태를 유지합니다. 한도를 늘릴 때는 ClamAV `StreamMaxLength`도 더 크게 설정해야 합니다.

1:1 문의 첨부는 같은 비공개 저장소와 ClamAV를 사용하며 `INQUIRY_ATTACHMENT_MAX_BYTES` 기본 10MB, JPG·PNG·WebP·PDF 형식만 허용합니다. 로컬에서 실제 첨부 완료 API를 시험하려면 객체 저장소와 `MALWARE_SCANNER_HOST`를 모두 연결해야 하며 둘 중 하나라도 없으면 파일은 문의에 연결되지 않고 격리 상태로 남습니다.

로컬 ClamAV는 약 3GB 이상의 메모리를 확보한 뒤 선택 프로필로 실행할 수 있습니다.

```powershell
docker compose --profile malware-scan up -d clamav video-scan-worker hls-transcode-worker video-cleanup-worker
$env:MALWARE_SCANNER_HOST = "127.0.0.1"
```

HLS 워커 설정은 `HLS_TRANSCODE_POLL_INTERVAL_MS=5000`, 최대 시도 `HLS_TRANSCODE_MAX_ATTEMPTS=3`, stale lock `HLS_TRANSCODE_LOCK_TIMEOUT_MS=14400000`, 조각 길이 `HLS_SEGMENT_DURATION_SECONDS=6`이 기본입니다. Docker 이미지에는 FFmpeg·FFprobe가 포함됩니다. 로컬 바이너리 위치가 다르면 `FFMPEG_PATH`, `FFPROBE_PATH`를 지정하며 실제 변환 스모크는 서버 빌드 후 `npm --prefix server run smoke:hls-transcode`로 실행합니다.

정리 주기는 `VIDEO_CLEANUP_POLL_INTERVAL_MS`, 재시도는 `VIDEO_CLEANUP_MAX_ATTEMPTS`, 오래된 작업 잠금 회수는 `VIDEO_CLEANUP_LOCK_TIMEOUT_MS`로 조정합니다. 미완료 영상 기준은 `VIDEO_UPLOAD_ABANDONED_AFTER_HOURS`, 교체 영상 보존기간은 `VIDEO_REPLACED_RETENTION_HOURS`, 문의에 연결되지 않은 첨부 보존기간은 `INQUIRY_ATTACHMENT_RETENTION_HOURS`이며 기본값은 모두 24시간입니다. 같은 `video-cleanup-worker`가 영상과 문의 첨부의 영속 삭제 큐를 처리합니다. 정리 워커의 저장소 권한에는 `DeleteObject`가 필요합니다.

```powershell
npm run ci
npm run test:e2e
npm run test:e2e:performance
```

브라우저 현장 검증만 빠르게 반복하려면 `npm run test:e2e:field`를 실행합니다. Chromium·Firefox 데스크톱, Pixel 7 Chrome, iPhone 14 WebKit에서 홈페이지와 React 진입 화면의 문서 가로 넘침, 모바일 메뉴 열기·선택 후 닫기, 시대 탭 가로 스크롤, 지연 노출 구간을 확인합니다. 모바일 프로젝트는 강의 API를 지연시켜 제목·기본 안내·로딩 상태가 데이터보다 먼저 표시되는지 확인하고, 최초 503 응답 뒤 수동 재시도로 강의 목록이 복구되는지도 검증합니다. 각 환경의 전체 페이지, 모바일 메뉴, 저속 로딩·장애·복구 화면은 `test-results`에 저장되며 CI에서는 14일 동안 artifact로 보관합니다. 로컬에 브라우저 실행 파일이 없으면 `npx playwright install chromium firefox webkit`을 먼저 실행합니다.

`npm run test:e2e:performance`는 프로덕션 웹 빌드와 미리보기 서버를 자동으로 준비한 뒤 Chromium의 독립된 브라우저 컨텍스트에서 홈페이지를 세 번 콜드 스타트합니다. LCP·상호작용 지연·CLS의 중앙값이 각각 2.5초·200ms·0.1 이하인지 검사하고 JSON 측정값을 `test-results/performance`에 남깁니다. 이 검사는 배포 전 랩 회귀 게이트이며 실제 사용자 75백분위수는 운영 RUM에서 별도로 관찰해야 합니다.

운영 환경 연동값을 준비한 뒤 빌드된 API 이미지 또는 로컬 `server/dist`에서 다음 명령으로 외부 의존성 프리플라이트를 실행합니다. 임시 S3 객체 외에는 데이터를 생성하지 않으며 해당 객체도 즉시 삭제합니다.

```powershell
npm --prefix server run build
npm --prefix server run preflight:production
```

문의 답변 이메일은 API 프로세스에서 직접 발송하지 않습니다. 답변과 함께 생성된 DB 아웃박스를 처리하려면 빌드 후 `npm --prefix server run start:inquiry-notification-worker`를 실행합니다. Docker Compose에서는 `inquiry-notification-worker`가 기본 서비스로 실행되며 폴링·재시도·잠금 회수는 `INQUIRY_NOTIFICATION_POLL_INTERVAL_MS`, `INQUIRY_NOTIFICATION_MAX_ATTEMPTS`, `INQUIRY_NOTIFICATION_LOCK_TIMEOUT_MS`로 조정합니다.

빈 PostgreSQL에 마이그레이션을 적용한 뒤 실제 관계·제약조건을 확인하려면 같은 `DATABASE_URL`로 `npm --prefix server run smoke:database`를 실행합니다. 이 검사는 트랜잭션 안에서 OAuth 연결, 미션 시도, 즐겨찾기·보상 지급, 개인정보 동의가 포함된 상담, 비공개 1:1 문의와 답변 알림 아웃박스, 공지 편집 콘텐츠, 공개 수업 팁·신고·검사 완료 첨부를 생성해 조회한 후 항상 롤백하므로 업무 데이터를 남기지 않습니다.

DB 사전검증은 `_prisma_migrations`에서 최신 필수 마이그레이션의 완료 상태를 확인하고, OAuth 연결·바둑미션·보상·즐겨찾기·상담 동의·비공개 문의·공지와 FAQ·검토형 커뮤니티 글·신고·첨부·교재 상품과 주문의 핵심 스키마를 실제로 조회합니다. 새 마이그레이션을 추가하면 `REQUIRED_PRODUCTION_MIGRATION`도 함께 갱신해야 하며, 이를 누락하면 API 단위 테스트가 실패합니다.

점검 대상은 최신 DB 스키마, Redis 속도 제한 카운터의 원자 증가·만료·삭제, 객체 저장소 쓰기·읽기·삭제, 설정된 CDN의 서명 URL 실제 조회, FFmpeg·FFprobe 실행 가능 여부, ClamAV, SMTP DNS·TLS·인증, 토스페이먼츠 Secret Key와 필수 OAuth 설정입니다. 하나라도 실패하면 JSON의 `ok`가 `false`이고 프로세스 종료 코드는 1입니다.

분기별 PostgreSQL 복구훈련은 빌드 후 `npm --prefix server run drill:recovery`로 검증합니다. 이 명령은 `RECOVERY_DATABASE_URL`, `RECOVERY_BACKUP_CREATED_AT`, `RECOVERY_RESTORE_STARTED_AT`을 필수로 받고 `RECOVERY_RPO_MINUTES`(기본 15분), `RECOVERY_RTO_MINUTES`(기본 240분)를 판정합니다. 운영 DB와 같은 대상 또는 격리 표식이 없는 대상을 연결 전에 거부하고, 복원 DB에서는 읽기 전용 트랜잭션으로 최신 마이그레이션·핵심 테이블·관계 무결성만 검사합니다. 실행 절차와 증빙 갱신 기준은 [배포 실행안](../deploy/README.md#분기별-postgresql-복구훈련)을 따릅니다.

스테이징 부하 검증은 빌드 후 `npm --prefix server run test:load:read-only`로 실행합니다. 쓰기·인증·결제 API를 제외한 4개 GET 시나리오를 제한된 요청 수와 동시성으로 실행하며, 메트릭 토큰이 있으면 워커 집계 경로를 추가합니다. 전체 및 시나리오별 처리량·오류율·p50·p95·p99를 JSON으로 출력하고 기준 실패 시 종료 코드 1을 반환합니다. 로컬 실행값과 GitHub Actions 수동 실행 방법은 [스테이징 읽기 전용 부하 검증](../deploy/README.md#스테이징-읽기-전용-부하-검증)을 따릅니다.

워커 큐 내구성 관측은 별도 스테이징 제어 부하가 실행되는 동안 `npm --prefix server run test:worker:soak`으로 수행합니다. 보호된 메트릭만 반복 조회하며 큐별 적체 증가·stale lock·최종 실패 증가, `critical` 표본 수와 응답 p95를 JSON 증빙으로 남깁니다. 관측기는 작업을 생성하지 않으며 운영 호스트는 기본 차단됩니다. 설정값과 수동 GitHub Actions 절차는 [스테이징 워커 큐 내구성 관측](../deploy/README.md#스테이징-워커-큐-내구성-관측)을 따릅니다.

최종 배포 인수는 `npm --prefix server run accept:release`로 프리플라이트·복구훈련·읽기 전용 부하·워커 soak·웹 배포 매니페스트·현장 브라우저 검증·공급망 SBOM JSON을 함께 검증합니다. 필수 하위 점검, 표본 완료 수, 5개 큐 상태, 후보 커밋 일치, 웹 파일·캐시 정책, 현장 브라우저 결과, 취약점 정책, 웹·API SBOM 목록과 증빙 유효기간 중 하나라도 충족하지 않으면 종료 코드 1을 반환합니다. GitHub Actions는 `GITHUB_SHA`를 증빙에 자동 기록하며 수동 실행은 모든 증빙 생성 명령에 같은 `EVIDENCE_COMMIT_SHA`를 주입합니다. `RELEASE_IMAGE_REFERENCE`는 `repository@sha256:<64자리>` 형식만 허용하며 최종 매니페스트는 이미지 digest와 일곱 증빙 파일의 SHA-256을 결합합니다. 실행 환경변수와 결과 보관 기준은 [배포 인수 증빙 게이트](../deploy/README.md#배포-인수-증빙-게이트)를 따릅니다.

배포 후에는 `npm --prefix server run verify:deployment`로 보호된 API 배포 식별값과 liveness·readiness를 반복 확인하고, 운영 웹 매니페스트·대표 HTML·해시 자산의 SHA-256과 CDN 캐시 정책을 인수 증빙에 대조합니다. 실제 커밋·이미지 digest·웹 파일이 인수 결과와 다르거나 상태·p95·캐시 기준이 실패하면 JSON의 `rollbackRecommended`가 `true`가 되고 종료 코드 1을 반환합니다. 운영 승인형 워크플로와 환경변수는 [배포 후 동일성·롤백 판정](../deploy/README.md#배포-후-동일성롤백-판정)을 따릅니다.

최종 종료는 `npm --prefix server run close:release`로 인수 매니페스트와 배포 검증 결과를 결합합니다. 후보 동일성, 실행 순서, 기본 24시간 유효기간, 상태 표본과 롤백 판정을 모두 재검사하며 두 파일의 SHA-256을 포함한 `closeoutSha256`을 생성합니다. 실행과 보관 기준은 [최종 릴리스 종료 기록](../deploy/README.md#최종-릴리스-종료-기록)을 따릅니다.

배포 검증 실패 시 `npm --prefix server run plan:rollback`으로 현재 인수 결과·실패 검증·직전 정상 closeout을 교차 검사합니다. 다른 이전 불변 API 이미지와 해당 웹 매니페스트 SHA-256, 24시간 이내 실패 증빙, forward-only DB 전략과 정확한 승인 문자열이 모두 있어야 `rollbackAuthorized`가 `true`가 됩니다. 도구는 플랫폼을 변경하지 않으며 승인된 API·웹 artifact로 함께 교체한 뒤 동일한 배포 검증을 다시 실행합니다. 절차는 [안전한 이미지 롤백 승인](../deploy/README.md#안전한-이미지-롤백-승인)을 따릅니다.

인증·공개 상담·회원 1:1 문의 속도 제한은 개발·테스트에서 프로세스 메모리를 사용하고, `NODE_ENV=production`에서는 `RATE_LIMIT_REDIS_URL`이 필수입니다. Redis 카운터는 Lua 스크립트로 증가와 만료를 원자적으로 처리하므로 여러 API 인스턴스가 같은 제한량을 공유합니다. Redis 연결 장애 시 요청을 무제한 허용하지 않고 구조화된 `RATE_LIMIT_UNAVAILABLE` 503 응답을 반환합니다.

다른 포트를 사용하려면 환경 변수를 지정합니다.

```powershell
$env:PORT = 8080
node dev-server.mjs
```

## 4. 디렉터리 구조

```text
F:\Home Page
├─ index.html                 # 전체 페이지 마크업과 모달
├─ board.html                 # 공통 게시판 목록·상세·글쓰기 화면
├─ lecture.html               # 구독 플랜·구독내역·강의 CMS·수강 화면
├─ styles.css                 # 디자인 토큰, 컴포넌트, 반응형 규칙
├─ script.js                  # 화면 인터랙션과 데모 상태
├─ board.js                   # 게시판 유형·필드·권한·임시 저장
├─ lecture.js                 # 계정 구독·종료·전체영상 권한·진도·CMS
├─ config.js                  # 공개 런타임 설정, 키는 비밀 값 제외
├─ config.example.js          # 배포 환경 설정 예시
├─ dev-server.mjs             # 로컬 정적 파일 서버
├─ compose.yaml               # 로컬 PostgreSQL·API 컨테이너
├─ server/                    # NestJS·Prisma API와 Docker 이미지
├─ deploy/                    # 사업자 중립 운영 배포 템플릿
├─ e2e/                       # Playwright 핵심 경로 테스트
├─ .github/workflows/         # 웹·API·브라우저·컨테이너 CI
├─ README.md                  # 프로젝트 빠른 안내
├─ assets/
│  ├─ hero-journey.png        # 편집용 원본 이미지
│  ├─ hero-journey.webp       # 메인 및 CTA 배포용 배경 이미지
│  └─ favicon.svg             # 파비콘
├─ payment/
│  ├─ success.html            # 토스 결제 성공 리다이렉트
│  ├─ fail.html               # 토스 결제 실패 리다이렉트
│  └─ result.js               # 승인 요청과 결과 표시
└─ docs/
   ├─ README.md
   ├─ DEVELOPMENT_GUIDE.md
   ├─ ARCHITECTURE.md
   ├─ FEATURE_SPEC.md
   ├─ BACKEND_INTEGRATION.md
   ├─ SOCIAL_LOGIN_PAYMENT.md
   ├─ BOARD_CMS.md
   ├─ LECTURE_CMS.md
   ├─ BADUK_MISSION_GAME.md
   └─ QA_CHECKLIST.md
```

## 5. 주요 코드 위치

### `index.html`

- `#journey`: 시대 여행 선택 및 상세 정보
- `#mission`: 현재 A/B/C 바둑판 연습 데모. 실제 서비스에서는 사용자 착수형 미션 게임으로 교체
- `board.html?type=classHelper`: 영상·PPT·활동지·퀴즈·미션·해설·가이드를 한 게시물에 묶은 지도자 수업도우미
- `#dashboard`: 학생 학습 현황 예시
- `#materials`: 교재·체험 키트
- `#community`: 공지, 수업 팁, 여행기
- `#loginModal`: 로그인 데모
- `#trialModal`: 사용자 역할별 무료 체험 진입
- `#missionModal`: 샘플 역사 퀴즈
- `#consultModal`: 기관 상담 신청

### `styles.css`

상단 `:root`에 컬러, 그림자, 반경, 콘텐츠 최대 폭을 정의합니다.

```css
:root {
  --cream: #f7f1e5;
  --ink: #27221e;
  --red: #b84232;
  --green: #3f6b51;
  --container: min(1180px, calc(100% - 40px));
}
```

주요 반응형 기준은 다음과 같습니다.

- `1080px 이하`: 내비게이션 간격과 다단 레이아웃 축소
- `860px 이하`: 모바일 메뉴 사용, 주요 2단 레이아웃을 1단으로 변경
- `600px 이하`: 휴대전화 전용 히어로, 카드, 모달 배치 적용

### `script.js`

- `eraData`: 시대 탭에 표시할 데모 콘텐츠
- `openModal()` / `closeModal()`: 공통 모달 제어
- `showToast()`: 데모 작업 결과 알림
- `.board-point`: 바둑 문제 정답 판정
- `.role-card`: 무료 체험 사용자 역할 선택
- `.quiz-options`: 역사 퀴즈 정답 판정
- `.social-login`: 제공사별 OAuth 서버 시작 경로로 이동
- `.payment-open`: 서버 주문 생성 후 토스 결제위젯 실행

간편 로그인과 결제 설정은 [간편 로그인·토스페이먼츠 연동](./SOCIAL_LOGIN_PAYMENT.md)을 참고합니다.

OAuth와 결제 연동의 CBD 패키지는 `server/src/components`에 있으며 `npm run pack:components`로 빌드, 공개 API, 타입 선언, 패키지 포함 파일을 검증합니다. 설치 및 버전 규칙은 [재사용 통합 컴포넌트](../server/src/components/README.md)를 참고합니다.

계정 이메일 인증·비밀번호 재설정 메일은 운영에서 `AccountMailJob` 영속 아웃박스로 전달됩니다. 32바이트 난수 키를 base64로 인코딩해 `ACCOUNT_MAIL_ENCRYPTION_KEY_BASE64`에 등록하고 `npm --prefix server run start:account-mail-worker`를 별도 프로세스로 실행합니다. 키를 분실하면 대기 중 암호문을 복호화할 수 없으므로 Secret 백업·교체 절차에 포함해야 하며, 키를 변경할 때는 기존 대기 작업을 모두 처리한 뒤 API와 워커를 함께 교체합니다.

게시판 입력 필드와 권한 규칙은 [게시판 입력·권한 설계](./BOARD_CMS.md)를 참고합니다.

사용자가 직접 착수하는 9·13·19줄 바둑미션, 문제 카드·확대창, 문제 입력기, 규칙 엔진, 상대 자동 응수, 완료 보상, 무기록 미리보기와 운영 통계는 [사용자 착수형 바둑문제·바둑미션 게임 기획](./BADUK_MISSION_GAME.md)을 참고합니다. 기존 홈페이지의 `.board-point` A/B/C 선택은 개념 검증용 데모이고 실제 학습은 React `/missions`에서 진행합니다.

### `lecture.html` / `lecture.js`

- 관리자(`admin`)와 운영자(`operator`)만 강의를 등록·수정·공개·보관할 수 있습니다.
- 일반 회원은 1·3·6·12개월 계정 구독이 유효할 때 모든 공개 강의를 볼 수 있습니다.
- 강의 등록 시 `무료 공개 여부`를 선택하며 무료 샘플은 비회원·비구독자도 볼 수 있습니다.
- 구독은 결제 승인 시점에 시작하고 마지막 이용일 다음 날 한국시간 00시에 종료됩니다.
- 강의별 가격·판매기간·시청일수는 사용하지 않으며 구독 플랜이 결제 기준입니다.
- React `/subscriptions`는 서버 주문 생성, 토스 결제 요청·승인, 주문·구독 내역을 사용합니다. 레거시 강의 데모만 브라우저 `localStorage` 임시 저장을 유지합니다.
- 실제 결제 승인에는 서버 환경 변수 `TOSS_PAYMENTS_SECRET_KEY`가 필요합니다.
- 교재 상점의 토스페이먼츠 직접 승인에는 브라우저 공개값 `tossPayments.clientKey`와 서버 전용 `TOSS_PAYMENTS_SECRET_KEY`가 필요합니다.
- 토스페이먼츠 개발자센터의 구독 웹훅 URL은 `/api/v1/payments/toss/subscriptions/webhook`으로 설정합니다. 서버는 웹훅 본문을 받은 뒤 토스 결제를 다시 조회합니다.
- 전액 환불 API는 운영자·관리자만 호출할 수 있으며 전액 환불이 확인되면 구독 재생 권한이 즉시 사라집니다.
- 실제 서버 연동 기준은 [계정 구독형 강의 CMS·시청 권한 설계](./LECTURE_CMS.md)를 참고합니다.

## 6. 코딩 규칙

### HTML

- 섹션에는 의미 있는 `id`와 제목을 부여합니다.
- 클릭 동작은 `a`와 `button`을 목적에 맞게 구분합니다.
- 아이콘만 있는 버튼에는 `aria-label`을 제공합니다.
- 비동기 결과와 문제 피드백에는 `role="status"` 또는 `aria-live`를 적용합니다.

### CSS

- 색상과 공통 수치는 `:root` 변수로 관리합니다.
- 클래스 이름은 역할을 설명하는 영문 케밥 표기법을 사용합니다.
- 고정 픽셀 폭보다 `min()`, `clamp()`, Grid, Flexbox를 우선합니다.
- 애니메이션을 추가할 때 `prefers-reduced-motion` 대응을 유지합니다.

### JavaScript

- 전역 상태는 최소화하고 DOM 이벤트 단위로 기능을 분리합니다.
- 서버 연동 전까지 데모 데이터는 별도 객체로 모읍니다.
- 사용자 입력값을 HTML 문자열로 직접 삽입하지 않습니다.
- API 도입 시 요청·응답 코드는 `api/` 또는 `services/` 모듈로 분리합니다.

## 7. 변경 작업 권장 순서

1. 기능 명세와 데이터 요구사항 확인
2. HTML 구조와 접근성 속성 수정
3. CSS의 모바일 레이아웃까지 함께 수정
4. JavaScript 또는 API 연동 구현
5. [QA 체크리스트](./QA_CHECKLIST.md) 수행
6. 관련 개발 문서 갱신

## 8. 배포

프런트엔드는 정적 사이트로 다음 서비스에 배포할 수 있습니다.

- GitHub Pages
- Cloudflare Pages
- Netlify
- Vercel 정적 배포
- Nginx 또는 Apache 정적 호스팅

`dev-server.mjs`는 개발 편의용입니다. 운영에서는 정적 호스팅 또는 애플리케이션 서버의 정적 파일 기능을 사용합니다.

API는 `server/Dockerfile`로 빌드하고 관리형 PostgreSQL과 연결합니다. 운영 절차와
환경 분리는 `deploy/README.md`를 따릅니다. 프런트엔드 환경별 API 주소를 코드에
직접 작성하지 말고 환경 설정 파일이나 빌드 변수로 주입해야 합니다.
