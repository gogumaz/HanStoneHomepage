# 구현·개발·배포 제안서

기준일: 2026-08-22

> 이 문서는 채택된 권장안을 기준으로 한 구현 제안서입니다. 기술 기준과 개발·배포 방식은
> 이 제안서대로 진행하며, HLS 변환의 운영 처리 규모와 실제 CloudFront 배포·클라우드 계정·도메인만 별도로 확정합니다.

## 0. 적용 상태

- **구현됨**: React·TypeScript·Vite 전환 골격, NestJS API 골격, Prisma 초기 스키마와 마이그레이션
- **구현됨**: 회원·역할·OAuth 연결·세션·학생–보호자 연결·감사로그 데이터 모델
- **구현됨**: API 생존·준비 상태 확인, Docker 로컬 구성, 운영 Compose 템플릿, GitHub Actions CI, Playwright 스모크 테스트
- **구현됨**: 이메일 회원가입·로그인·로그아웃·세션 갱신·`/me`, 해시 세션 쿠키, 공개 역할 제한, 역할 가드 기반
- **구현됨**: 공통 성공·오류 응답과 요청 ID, React `/account` 인증 연결 화면, Vite 로컬 API 프록시
- **구현됨**: 보호자 초대·조회·동의·학생 연결·연결 해제 API, 동의 이력 모델, React `/guardian` 관리 화면
- **구현됨**: 시대·강의 카탈로그 모델, 6개 시대와 `PRE-01` 초기 데이터, 공개 목록·상세 API, React `/lessons` 탐색 화면
- **구현됨**: 고정 구독 플랜·계정 구독·6단계 강의·진도 모델, 무료·구독·운영자 재생 접근 판정, 단계·완료 저장
- **구현됨**: 서버 가격 기준 구독 주문, PortOne V1 결제 조회·검증, 멱등 구독 발급, 주문·구독 내역, React `/subscriptions`
- **구현됨**: PortOne V1 웹훅 재검증·실패/취소 동기화, 운영자 전액 환불, 부분 환불 누적과 전액 환불 시 권한 회수
- **구현됨**: S3 호환 비공개 저장소 설정, 공급자 중립 전송 계층과 CloudFront SHA-256 서명 URL·S3 폴백, MP4 단기 서명과 HLS 권한 재생목록·세그먼트별 서명, HLS.js/native React 영상 플레이어
- **구현됨**: ClamAV 통과 MP4를 최대 360p·720p H.264/AAC fMP4 VOD로 만드는 FFmpeg 영속 큐 워커, 재시도·최신 영상 경쟁 방지·원본 지연 정리
- **구현됨**: 운영자 MP4 직접 업로드, 비동기 스트리밍 ClamAV 검사, 통과 후 연결, 미완료·교체 영상 영속 큐 자동 정리
- **구현됨**: 운영자·관리자 강의 목록·등록·수정, 6개 기본 단계 자동 생성, 영상·단계 확인 후 공개·비공개·보관 워크플로
- **구현됨**: 썸네일·PDF·PPT/PPTX·DOC/DOCX·HWP/HWPX 격리 업로드, 형식·크기·컨테이너 구조 검사, ClamAV 검사 후 활성화·거부
- **구현됨**: 공개 강의 썸네일 서명 표시와 강의 접근 권한 기반 학습자료 다운로드
- **구현됨**: 관리자 결제 대사·불일치 표시·PortOne 수동 동기화·전액 환불 화면
- **구현됨**: 활성 연결·현재 동의 범위를 확인하는 보호자용 학생 강의·단계 진도 리포트
- **구현됨**: 학생용 전체·시대별 진도·최근 학습·다음 강의 추천 여행지도
- **다음 구현**: OAuth 운영 앱 심사·실연동, 운영 AWS 계정의 CloudFront 배포·OAC·키 그룹·도메인 연결
- **외부값 대기**: 관리형 PostgreSQL·정적 호스팅·객체 저장소 사업자와 버킷, 도메인, 운영 Secret

## 1. 확정 기술 기준

| 영역 | 확정안 |
|---|---|
| 프런트엔드 | React, TypeScript, Vite, React Router, TanStack Query |
| API | Node.js 24 LTS, NestJS |
| 데이터베이스 | 관리형 PostgreSQL |
| ORM·마이그레이션 | Prisma ORM, Prisma Migrate |
| 세션 | HttpOnly·Secure·SameSite 쿠키 기반 서버 세션 |
| 파일 | 비공개 S3 호환 객체 저장소 |
| 결제 | PortOne V1 + 토스페이 |
| 컨테이너 | Docker, 로컬은 Docker Compose |
| 단위·통합 테스트 | Vitest |
| 브라우저 테스트 | Playwright |
| CI/CD | GitHub Actions |

Node.js는 Current보다 LTS 버전을 사용합니다. 2026-08-21 기준
운영 기준선은 Node.js 24 LTS이며, 지원 종료 전에 다음 LTS로 올리는 정책입니다.

## 2. 목표 구조

```text
브라우저 React 앱
    │ HTTPS/JSON
    ▼
NestJS API
    ├─ 인증·회원·권한
    ├─ 강의·콘텐츠·게시판
    ├─ 바둑 규칙·수순·미션
    ├─ 주문·PortOne V1 결제·구독
    └─ 알림·감사로그
       │          │
       ▼          ▼
 PostgreSQL   비공개 객체 저장소
```

API는 도메인 모듈로 나누되 초기에는 하나의 배포 단위인 모듈러 모놀리스로
구현합니다. 트래픽이나 조직 규모가 실제로 커지기 전에는
마이크로서비스로 분리하지 않는 편이 운영비와 복잡도를 줄일 수 있습니다.

## 3. 구현 단계

### 1단계: 기반과 회원

- NestJS 프로젝트, Prisma 스키마, PostgreSQL 마이그레이션 구성
- 로컬·테스트·스테이징·운영 설정 분리
- 회원, OAuth, 서버 세션, 역할·권한, 보호자 초대 구현
- 공통 오류 응답, 요청 ID, 감사로그 구현
- 기존 정적 화면을 기능 단위로 React에 이전

완료 기준: 로그인 후 역할에 맞는 보호 API를 호출하고, DB 마이그레이션을
새 환경에 반복 적용할 수 있어야 합니다.

### 2단계: 바둑미션과 CMS

- 프레임워크 독립 TypeScript 규칙 엔진
- 9·13·19줄 SVG 렌더러와 좌표 입력
- 수순 트리, 복수 정답, 상대 자동 응수, 체크포인트
- 미션 시도·점수·힌트·오답노트 API
- 문제·강의 CMS와 공개 전 검증

완료 기준: 선사시대 1강 6문항을 CMS에서 등록하고 학생이 모바일과 PC에서
완료하며, 중복 제출에도 점수와 보상이 한 번만 저장되어야 합니다.

### 3단계: 결제와 구독

- 서버 검증을 거친 주문 생성과 금액 확정
- PortOne V1 JavaScript SDK 결제 요청
- `imp_uid` 결제 단건 조회 및 주문번호·금액·상태 검증
- 테스트·실연동 웹훅, 중복 이벤트 멱등 처리
- 결제·구독 발급 트랜잭션, 취소·환불 및 운영 화면

완료 기준: 결제 성공·실패·취소·웹훅 재시도·금액 변조·중복 승인 테스트를
모두 통과해야 합니다.

### 4단계: 콘텐츠와 운영

- 강의 업로드, 비공개 파일 접근, 진도 저장
- 게시판·문의·상담·신고·재심
- 학생·보호자·지도자 대시보드
- 알림, 운영 통계, 추천 1차 규칙
- 개인정보 파기와 법정 보존 배치

HLS 전달 기반, FFmpeg 자동 변환 워커, CloudFront 서명 URL 어댑터와 실제 전달 사전점검을 구현했습니다. GPU 가속·1080p 이상·동시 처리량 고도화와 실제 CloudFront 배포는 계정·영상량·비용을 확인한 뒤 확정합니다.

## 4. 테스트 기준

- 규칙 엔진, 수순 트리, 점수, 구독 종료일은 Vitest 단위테스트를 필수로 작성합니다.
- API는 인증·권한·금액 변조·멱등성·트랜잭션 통합테스트를 작성합니다.
- Playwright로 로그인, 무료 강의, 결제 테스트, 바둑미션, CMS 핵심 경로를 검사합니다.
- 접근성은 키보드, 포커스, 화면 읽기 이름, 색상 외 상태 표현을 검사합니다.
- 모든 버그 수정에는 같은 문제를 재현하는 회귀 테스트를 추가합니다.

## 5. 환경과 배포 확정안

### 환경

- `local`: 개발자 PC와 로컬 Docker Compose
- `test`: CI에서 생성되는 격리 DB와 자동 테스트
- `staging`: 운영과 같은 구조, 테스트 결제·테스트 OAuth 사용
- `production`: 운영 자격증명과 실데이터 사용

DB, OAuth, PortOne Secret은 환경별로 완전히 분리합니다. Secret은 GitHub Secrets
또는 배포 플랫폼의 비밀 관리 기능으로 주입하고 저장소와 프런트 빌드에 넣지 않습니다.

### CI/CD

Pull Request마다 GitHub Actions에서 다음 순서로 실행합니다.

1. `npm ci`
2. 타입 검사와 정적 검사
3. Vitest 단위·통합 테스트
4. Vite 프로덕션 빌드
5. Playwright 핵심 브라우저 테스트
6. 의존성·Secret 검사

기본 브랜치 병합 후 스테이징은 자동 배포합니다. 운영은 스테이징 검증 결과와
마이그레이션 계획을 확인한 뒤 승인 배포합니다. Prisma 운영 마이그레이션은
CI/CD에서 `prisma migrate deploy`로만 실행하고 개발자 PC에서 운영 DB에 직접 적용하지 않습니다.

### 배포 단위

- 프런트엔드: 정적 호스팅
- API: Docker 이미지 한 개
- DB: 관리형 PostgreSQL
- 파일: 비공개 S3 호환 객체 저장소
- 스케줄 작업: API와 같은 코드베이스의 별도 작업 프로세스

## 6. 관측성·백업·복구

- 애플리케이션 로그는 구조화 JSON과 요청 ID를 사용합니다.
- 결제, 권한, 게시물 상태 변경은 별도 감사로그로 남깁니다.
- 오류 추적, API 지연시간, 오류율, DB 연결, 웹훅 실패 알림을 설정합니다.
- 일반 운영 로그는 90일, 결제 법정 기록은 5년 보관합니다.
- PostgreSQL은 PITR을 활성화하고 일일 스냅샷을 30일 보관합니다.
- 객체 저장소는 버전 관리와 삭제 보호를 활성화합니다.
- 목표는 데이터 RPO 15분, 서비스 RTO 4시간입니다.
- 분기마다 스테이징 환경에서 DB·파일 복구 훈련을 수행합니다.

## 7. 도메인 규칙

실제 기본 도메인은 사업자가 확정하며 다음 구조를 권장합니다.

```text
운영 웹       https://www.{base-domain}
운영 API      https://api.{base-domain}
스테이징 웹   https://staging.{base-domain}
스테이징 API  https://api-staging.{base-domain}
```

OAuth Callback과 PortOne 웹훅은 API 도메인 아래 고정 경로를 사용합니다.

## 8. 기술 근거

- [Node.js 릴리스와 LTS 현황](https://nodejs.org/en/about/previous-releases)
- [NestJS 시작 요구사항](https://docs.nestjs.com/first-steps)
- [Prisma Migrate 운영 배포](https://docs.prisma.io/docs/cli/migrate)
- [GitHub Actions Node.js 빌드·테스트](https://docs.github.com/en/actions/tutorials/build-and-test-code/nodejs)
- [Playwright CI](https://playwright.dev/docs/ci)
- [Docker Compose 운영 사용](https://docs.docker.com/compose/how-tos/production/)
