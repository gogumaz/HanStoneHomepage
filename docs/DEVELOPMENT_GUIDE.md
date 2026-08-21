# 개발 가이드

## 1. 프로젝트 개요

바둑 학습과 한국사 스토리를 하나의 시대 여행으로 연결하는 초등학생 대상 에듀테인먼트 서비스입니다. 현재 결과물은 서비스 방향과 핵심 사용자 흐름을 검증하기 위한 프론트엔드 프로토타입입니다.

### 주요 사용자

- 학생: 시대별 강의, 바둑 미션, 역사 퀴즈, 보상 수집
- 학부모: 진도와 영역별 성취도 확인
- 지도자: 반 관리, 과제 배포, 수업 자료 활용
- 운영자: 강의·퀴즈·교재·회원·상담 관리

## 2. 기술 구성

| 구분 | 현재 사용 기술 |
|---|---|
| 마크업 | HTML5 |
| 스타일 | CSS3, CSS Custom Properties, 반응형 미디어 쿼리 |
| 인터랙션 | Vanilla JavaScript, IntersectionObserver, Web Animations API |
| 개발 서버 | Node.js 기본 `http` 모듈 |
| 외부 의존성 | 없음 |

Node.js 18 이상을 권장합니다.

## 3. 로컬 실행

프로젝트 루트에서 다음 명령을 실행합니다.

```powershell
node dev-server.mjs
```

브라우저에서 `http://127.0.0.1:4173`으로 접속합니다.

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

게시판 입력 필드와 권한 규칙은 [게시판 입력·권한 설계](./BOARD_CMS.md)를 참고합니다.

사용자가 직접 착수하는 9·13·19줄 바둑미션, 문제 카드·확대창, 문제 입력기, 규칙 엔진, 상대 자동 응수와 학습기록은 [사용자 착수형 바둑문제·바둑미션 게임 기획](./BADUK_MISSION_GAME.md)을 참고합니다. 현재 `.board-point` A/B/C 선택은 개념 검증용 데모이며 실제 게임 엔진 구현으로 대체해야 합니다.

### `lecture.html` / `lecture.js`

- 관리자(`admin`)와 운영자(`operator`)만 강의를 등록·수정·공개·보관할 수 있습니다.
- 일반 회원은 1·3·6·12개월 계정 구독이 유효할 때 모든 공개 강의를 볼 수 있습니다.
- 강의 등록 시 `무료 공개 여부`를 선택하며 무료 샘플은 비회원·비구독자도 볼 수 있습니다.
- 구독은 결제 승인 시점에 시작하고 마지막 이용일 다음 날 한국시간 00시에 종료됩니다.
- 강의별 가격·판매기간·시청일수는 사용하지 않으며 구독 플랜이 결제 기준입니다.
- 개발 모드에서는 강의·구독·진도를 브라우저 `localStorage`에 임시 저장합니다.
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

현재 프로젝트는 정적 사이트이므로 다음 서비스에 배포할 수 있습니다.

- GitHub Pages
- Cloudflare Pages
- Netlify
- Vercel 정적 배포
- Nginx 또는 Apache 정적 호스팅

`dev-server.mjs`는 개발 편의용입니다. 운영에서는 정적 호스팅 또는 애플리케이션 서버의 정적 파일 기능을 사용합니다.

백엔드를 분리 배포할 경우 프런트엔드 환경별 API 주소를 코드에 직접 작성하지 말고 환경 설정 파일이나 빌드 변수로 주입해야 합니다.
