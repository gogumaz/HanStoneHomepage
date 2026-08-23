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

브라우저에서 Vite가 안내하는 주소로 접속합니다. 기존 정적 홈페이지는 `/index.html`, React 전환 진입점은 `/app.html`, 실제 계정 API 연결 화면은 `/account`, 보호자 연결 화면은 `/guardian`, 공개 강의 탐색은 `/lessons`입니다. Vite 개발·미리보기 서버는 React 경로와 `/lessons/{lessonId}` 직접 진입을 React 앱으로 되돌립니다. 운영 정적 호스팅에도 같은 rewrite 규칙을 설정해야 합니다. 개발 서버의 `/api` 요청은 `http://127.0.0.1:3000`으로 전달되므로 API 연결 화면을 사용할 때는 API도 함께 실행합니다.

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

현재 인증 API는 이메일 회원가입·로그인·로그아웃·세션 갱신과 `/me` 조회, 이메일 인증, 비밀번호 재설정을 지원합니다. 세션과 계정 보안 토큰 원문은 데이터베이스에 저장하지 않고 해시만 저장합니다. 공개 회원가입은 `student`와 `guardian` 역할만 허용하며 운영 권한은 관리 절차를 통해 별도로 부여해야 합니다. `/account`에서 인증과 복구 흐름을 확인할 수 있고 개발·테스트 환경에서는 SMTP를 설정하지 않아도 검증용 토큰이 화면에 표시됩니다.

SMTP 발송을 확인하려면 `PUBLIC_APP_URL`, `SMTP_HOST`, `SMTP_PORT`, `MAIL_FROM`을 설정하고 인증이 필요한 서버에는 `SMTP_USER`, `SMTP_PASSWORD`를 함께 입력합니다. 587 포트는 `SMTP_SECURE=false`, `SMTP_REQUIRE_TLS=true`, 465 포트는 `SMTP_SECURE=true`, `SMTP_REQUIRE_TLS=false`를 사용합니다. 계정 API는 메일 서버 응답을 기다리지 않으며 발송 결과는 감사로그에서 확인합니다.

OAuth는 제공사별 client ID·secret·redirect URI 세 항목을 모두 설정한 경우에만 활성화됩니다. React 설정의 `oauthEnabled`와 `oauthProviders`는 버튼 표시만 제어하며 secret을 포함하지 않습니다. API는 10분 기본 만료의 해시 state, PKCE와 nonce를 사용하고 콜백을 한 번만 소비합니다. 동일 이메일의 기존 계정은 자동 병합하지 않고 명시적 연결을 요구합니다. OAuth·결제 공급자 모듈을 다른 NestJS 앱에서 사용하는 방법은 [재사용 통합 컴포넌트](../server/src/components/README.md)를 참고합니다.

학생 계정은 `/guardian`에서 보호자 이메일 초대를 만들 수 있습니다. 개발·테스트 환경에서는 화면에 개발용 토큰이 표시됩니다. 보호자는 같은 화면에서 토큰을 확인하고 필수 학습정보 조회 범위에 동의한 뒤 연결합니다. 초대 유효기간은 `GUARDIAN_INVITATION_TTL_HOURS`로 설정하며 기본값은 72시간입니다.

`/lessons`는 `GET /eras`와 `GET /eras/{eraId}/lessons`를 사용하여 공개 강의를 표시합니다. `/lessons/{lessonId}`는 공개 강의 상세와 단계 구성을 조회합니다. 재생 권한 판정과 계정별 진도 저장까지 서버 API에 연결되어 있습니다.

강의 상세에서는 `GET /lessons/{lessonId}/playback`으로 무료 샘플·활성 구독·운영자 미리보기 권한을 확인합니다. 로그인 사용자는 강의를 시작하고 6개 단계를 완료한 뒤 최종 완료 상태를 서버에 저장할 수 있습니다. 영상 키가 없으면 `asset_pending`, 저장소 설정이 없으면 `signer_pending`, 서명이 완료되면 `ready`, `format`, `delivery`, 짧게 만료되는 URL을 반환합니다. React 플레이어는 MP4를 기본 `<video>`로 재생하고 HLS는 HLS.js 우선·브라우저 네이티브 HLS 대체 경로를 사용합니다. 준비된 HLS 패키지는 `lesson-hls/{lessonId}/{version}/master.m3u8` 규칙으로 저장하고 CMS에서 연결합니다.

S3 또는 S3 호환 비공개 저장소를 연결하려면 `server/.env`에 `OBJECT_STORAGE_BUCKET`과 리전을 설정합니다. 호환 사업자는 `OBJECT_STORAGE_ENDPOINT`와 필요 시 `OBJECT_STORAGE_FORCE_PATH_STYLE=true`를 추가합니다. 로컬 키는 `OBJECT_STORAGE_ACCESS_KEY_ID`, `OBJECT_STORAGE_SECRET_ACCESS_KEY`를 함께 사용하며 운영에서는 정적 키 대신 런타임 역할을 권장합니다. `PLAYBACK_URL_TTL_SECONDS`와 `VIDEO_UPLOAD_URL_TTL_SECONDS`의 기본값은 300초, 최대값은 900초입니다. `VIDEO_UPLOAD_MAX_BYTES`는 기본 2GB입니다. 버킷 공개 접근은 차단하고 프런트 도메인의 업로드 `POST`와 HLS.js 세그먼트 조회 `GET`·`HEAD`를 허용하는 CORS 규칙을 설정해야 합니다.

CloudFront를 사용하려면 `PLAYBACK_CDN_PROVIDER=cloudfront`, 경로 없는 HTTPS origin인 `PLAYBACK_CDN_BASE_URL`, 신뢰 키 그룹의 `PLAYBACK_CDN_KEY_PAIR_ID`, PEM 개인키를 base64로 인코딩한 `PLAYBACK_CDN_PRIVATE_KEY_BASE64`를 함께 설정합니다. 운영 배포에서 CDN을 필수로 강제하려면 `PREFLIGHT_REQUIRE_CDN=true`를 사용합니다. 사전점검은 임시 HLS 객체를 저장하고 CloudFront 서명 URL로 실제 바이트를 조회한 뒤 삭제하므로 배포·OAC·키 그룹·origin behavior 오류까지 검출합니다. 개인키 원문이나 base64 값은 저장소, 로그, 프런트 환경변수에 넣지 말고 비밀 관리 기능으로 주입합니다.

운영자·관리자로 로그인한 강의 상세 화면에는 MP4 업로드 영역이 표시됩니다. 브라우저가 서명된 POST 정책으로 저장소에 직접 업로드한 뒤 API가 선언 MIME, 예상·실제 크기, 강의 귀속 메타데이터와 MP4 첫 박스의 `ftyp`를 확인합니다. 영상은 DB 격리 작업으로 등록되고 별도 `npm --prefix server run start:video-scan-worker` 프로세스가 S3 스트림을 ClamAV로 검사합니다. 검사 통과 후 `start:hls-transcode-worker`가 FFprobe로 스트림을 확인하고 원본보다 높지 않은 최대 360p·720p H.264/AAC fMP4 VOD를 생성합니다. CMS는 변환 상태와 오류·시도 횟수를 표시하고 최종 오류는 운영자가 재시도할 수 있습니다. `start:video-cleanup-worker`는 미완료·교체 영상과 HLS로 전환된 원본을 보존기간 뒤 정리합니다.

`/admin/lessons`는 운영자·관리자 전용 React 강의 CMS입니다. 신규 강의는 비공개로 등록되고 역사 이야기·바둑 개념·바둑 미션·역사 미션·생각 한 수·보상 6단계가 자동 생성됩니다. 영상 연결과 6단계가 확인된 뒤에만 공개할 수 있으며, 공개 중단은 `draft`, 삭제 대체는 `archived` 상태를 사용합니다.

CMS의 썸네일·학습자료는 최대 `LESSON_ASSET_MAX_BYTES`까지 허용하며 기본값은 20MB입니다. 지원 형식은 썸네일 JPG·PNG·WebP, 자료 PDF·PPT·PPTX·DOC·DOCX·HWP·HWPX입니다. HWP/HWPX의 브라우저 MIME 편차는 확장자를 기준으로 각각 `application/x-hwp`, `application/hwp+zip`으로 정규화하며 서버가 내부 CFB/ZIP 구조를 다시 검증합니다. `MALWARE_SCANNER_HOST`, `MALWARE_SCANNER_PORT`, `MALWARE_SCANNER_TIMEOUT_MS`로 ClamAV `clamd`를 연결합니다. 스캐너가 없거나 오류가 발생하면 파일은 활성화되지 않고 격리 상태를 유지합니다. 한도를 늘릴 때는 ClamAV `StreamMaxLength`도 더 크게 설정해야 합니다.

로컬 ClamAV는 약 3GB 이상의 메모리를 확보한 뒤 선택 프로필로 실행할 수 있습니다.

```powershell
docker compose --profile malware-scan up -d clamav video-scan-worker hls-transcode-worker video-cleanup-worker
$env:MALWARE_SCANNER_HOST = "127.0.0.1"
```

HLS 워커 설정은 `HLS_TRANSCODE_POLL_INTERVAL_MS=5000`, 최대 시도 `HLS_TRANSCODE_MAX_ATTEMPTS=3`, stale lock `HLS_TRANSCODE_LOCK_TIMEOUT_MS=14400000`, 조각 길이 `HLS_SEGMENT_DURATION_SECONDS=6`이 기본입니다. Docker 이미지에는 FFmpeg·FFprobe가 포함됩니다. 로컬 바이너리 위치가 다르면 `FFMPEG_PATH`, `FFPROBE_PATH`를 지정하며 실제 변환 스모크는 서버 빌드 후 `npm --prefix server run smoke:hls-transcode`로 실행합니다.

정리 주기는 `VIDEO_CLEANUP_POLL_INTERVAL_MS`, 재시도는 `VIDEO_CLEANUP_MAX_ATTEMPTS`, 오래된 작업 잠금 회수는 `VIDEO_CLEANUP_LOCK_TIMEOUT_MS`로 조정합니다. 미완료 업로드 기준은 `VIDEO_UPLOAD_ABANDONED_AFTER_HOURS`, 교체 영상 보존기간은 `VIDEO_REPLACED_RETENTION_HOURS`이며 기본값은 모두 24시간입니다. 정리 워커의 저장소 권한에는 `DeleteObject`가 필요합니다.

```powershell
npm run ci
npm run test:e2e
```

운영 환경 연동값을 준비한 뒤 빌드된 API 이미지 또는 로컬 `server/dist`에서 다음 명령으로 외부 의존성 프리플라이트를 실행합니다. 임시 S3 객체 외에는 데이터를 생성하지 않으며 해당 객체도 즉시 삭제합니다.

```powershell
npm --prefix server run build
npm --prefix server run preflight:production
```

점검 대상은 최신 DB 스키마, 객체 저장소 쓰기·읽기·삭제, 설정된 CDN의 서명 URL 실제 조회, FFmpeg·FFprobe 실행 가능 여부, ClamAV, SMTP DNS·TLS·인증, PortOne 인증과 필수 OAuth 설정입니다. 하나라도 실패하면 JSON의 `ok`가 `false`이고 프로세스 종료 코드는 1입니다.

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
│  ├─ hero-journey.png        # 메인 및 CTA 배경 이미지
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

게시판 입력 필드와 권한 규칙은 [게시판 입력·권한 설계](./BOARD_CMS.md)를 참고합니다.

사용자가 직접 착수하는 9·13·19줄 바둑미션, 문제 카드·확대창, 문제 입력기, 규칙 엔진, 상대 자동 응수와 학습기록은 [사용자 착수형 바둑문제·바둑미션 게임 기획](./BADUK_MISSION_GAME.md)을 참고합니다. 현재 `.board-point` A/B/C 선택은 개념 검증용 데모이며 실제 게임 엔진 구현으로 대체해야 합니다.

### `lecture.html` / `lecture.js`

- 관리자(`admin`)와 운영자(`operator`)만 강의를 등록·수정·공개·보관할 수 있습니다.
- 일반 회원은 1·3·6·12개월 계정 구독이 유효할 때 모든 공개 강의를 볼 수 있습니다.
- 강의 등록 시 `무료 공개 여부`를 선택하며 무료 샘플은 비회원·비구독자도 볼 수 있습니다.
- 구독은 결제 승인 시점에 시작하고 마지막 이용일 다음 날 한국시간 00시에 종료됩니다.
- 강의별 가격·판매기간·시청일수는 사용하지 않으며 구독 플랜이 결제 기준입니다.
- React `/subscriptions`는 서버 주문 생성, PortOne 결제 요청·검증, 주문·구독 내역을 사용합니다. 레거시 강의 데모만 브라우저 `localStorage` 임시 저장을 유지합니다.
- 실제 결제 검증에는 서버 환경 변수 `PORTONE_V1_REST_API_KEY`, `PORTONE_V1_REST_API_SECRET`이 필요합니다.
- PortOne 콘솔의 V1 웹훅 URL은 `/api/v1/payments/portone/webhook`으로 설정합니다. 서버는 웹훅 본문을 받은 뒤 PortOne 결제를 다시 조회합니다.
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
