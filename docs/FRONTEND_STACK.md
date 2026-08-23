# React 프런트엔드 기술 스택

기준일: 2026-08-21

## 1. 확정 사항

실서비스 프런트엔드는 **React + TypeScript**로 개발합니다. 현재 정적 HTML·CSS·JavaScript 프로토타입은 화면과 사용자 흐름을 검증하는 기준으로 유지하고, 기능 단위로 React에 점진 이전합니다.

| 영역 | 확정 기술 | 적용 기준 |
|---|---|---|
| UI | React + TypeScript | 모든 신규 화면과 상태가 있는 기능 |
| 빌드 | Vite | 개발 서버, 번들, 환경변수, 운영 빌드 |
| 라우팅 | React Router | 공개·학생·보호자·지도자·관리자 경로 |
| 서버 상태 | TanStack Query | API 조회, 캐시, 재시도, 무효화 |
| 지역 UI 상태 | React state/context | 모달, 필터, 입력 중인 착수와 폼 상태 |
| 바둑판 | SVG 기반 React 컴포넌트 | 9·13·19줄 좌표, 확대, 키보드 접근성 |
| 규칙 코어 | 프레임워크 독립 TypeScript 모듈 | 클라이언트 즉시 검사와 서버 최종 판정에서 공유 |
| 폼 | 스키마 기반 검증 | 강의·문제·게시판·수업도우미 CMS |
| 테스트 | 단위·컴포넌트·브라우저 E2E | 규칙, 권한, 결제, 주요 사용자 흐름 |

React는 화면과 사용자 입력을 담당합니다. 구독 권한, 역할·소속·이용권 계산, 바둑미션 최종 판정, 결제 승인은 서버가 담당합니다.

## 2. 목표 폴더 구조

```text
src/
├─ app/                     # Router, QueryClient, 오류 경계, 앱 설정
├─ components/              # 공통 버튼, 모달, 카드, 표, 접근성 UI
├─ features/
│  ├─ auth/                 # OAuth, 회원가입, 역할 전환
│  ├─ guardian/             # 학생의 보호자 초대와 동의 상태
│  ├─ journey/              # 시대지도와 강의 목록
│  ├─ lesson/               # 강의 플레이어와 역사 퀴즈
│  ├─ baduk-mission/        # 문제 카드, 바둑판, 착수와 피드백
│  ├─ problem-author/       # 관리자 문제 입력기와 공개 검수
│  ├─ subscription/         # 플랜, 주문, 구독 권한
│  ├─ organization/         # 기관, 멤버십, 반, 담당 학생
│  ├─ classroom/            # 과제와 수업도우미
│  └─ cms/                  # 강의·게시판·첨부자료 관리
├─ lib/
│  ├─ go-rules/             # 따냄, 자충, 패, 판 해시
│  ├─ authz/                # 화면 표시용 권한 계산
│  └─ date-time/            # Asia/Seoul 구독 종료 계산
├─ services/                # 타입이 지정된 API 클라이언트
├─ styles/                  # 기존 디자인 토큰과 반응형 스타일
└─ types/                   # API DTO와 도메인 타입
```

서버는 동일 규칙을 재구현해 다르게 판정하지 않도록 `go-rules`의 순수 TypeScript 코어를 공유할 수 있습니다. 다만 브라우저 결과는 편의용이며 서버 결과가 항상 최종값입니다.

## 3. React 전환 순서

1. Vite·TypeScript·React Router·테스트 하네스를 구성합니다.
2. 기존 CSS 토큰과 정적 레이아웃을 유지한 채 공통 앱 셸을 이전합니다.
3. `BadukProblemPlayer`와 규칙 코어를 가장 먼저 React 컴포넌트로 구현합니다.
4. 강의 플레이어와 관리자 문제·강의 CMS를 이전합니다.
5. 로그인·구독·학생·보호자·지도자 화면을 API와 연결합니다.
6. 게시판과 공개 홈페이지를 이전하고 기존 전역 스크립트를 제거합니다.

전환 중에는 기존 페이지와 React 페이지의 URL을 명확히 분리하고, 동일 기능을 두 구현에서 동시에 수정하는 기간을 최소화합니다.

## 4. 라우트 기준

```text
/                              공개 홈페이지
/lessons                       강의 목록
/lessons/:lessonId             강의 플레이어
/missions                      바둑미션 목록
/missions/:missionId           직접 진입·딥링크
/dashboard                     학생 대시보드
/guardian                      보호자 리포트·동의 관리
/teacher                       지도자 교실
/admin/lessons                 강의 CMS
/admin/missions                문제 CMS
```

보호 화면은 React에서 메뉴만 숨기지 않고 `/me` 응답과 각 API의 서버 권한 판정을 기준으로 처리합니다.

## 5. 환경변수 경계

브라우저 번들에는 공개 값만 포함합니다.

```text
VITE_API_BASE_URL=
VITE_OAUTH_ENABLED=false
VITE_TOSS_CLIENT_KEY=
VITE_TOSS_MID=tosstest
VITE_PAYMENT_CHANNEL_KEY=channel-key-...
```

OAuth Client Secret, 토스 Secret Key, 웹훅 Secret, 세션 서명 키, DB 접속정보는 서버 환경변수와 비밀 관리 서비스에만 저장합니다.

## 6. 완료 기준

- TypeScript 엄격 모드에서 빌드 오류가 없습니다.
- 9·13·19줄 바둑판이 동일한 좌표 모델을 사용합니다.
- 키보드와 화면 읽기 도구로 바둑판을 조작할 수 있습니다.
- API 로딩·오류·재시도·로그아웃 상태가 모든 보호 화면에서 일관됩니다.
- 역할·기관 소속·이용권을 클라이언트 단일 값으로 합치지 않습니다.
- 규칙·구독 종료·권한 계산의 단위 테스트와 핵심 E2E가 통과합니다.

