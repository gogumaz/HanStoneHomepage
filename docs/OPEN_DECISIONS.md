# 채택 권장안과 남은 검토 사항

기준일: 2026-09-13

## 0. 운영 전환 현황과 우선순위

2026-09-11 실제 운영 환경을 기준으로 확인한 상태입니다. 아래 순서의 선행 조건이
충족되기 전에는 후보 인수·운영 배포 검증·closeout 워크플로를 임의로 실행하지 않습니다.

| 우선순위 | 항목 | 확인 결과 | 다음 완료 조건 |
|---|---|---|---|
| 1 | 카카오 로그인 | `KOE004`의 원인이던 TEST 앱 로그인 비활성화를 해소했고, TEST 앱의 닉네임·이메일 필수 동의도 활성화함. 운영 서버의 REST API 키와 클라이언트 시크릿을 정식 운영 앱 값으로 함께 전환했으며, 운영 앱의 로그인 ON·필수 동의·정확한 콜백 URI·클라이언트 시크릿 활성 상태를 확인함. 운영 URL은 정식 운영 앱과 `https://handol-edu.com/api/v1/auth/oauth/kakao/callback`으로 정상 전환되고, 비로그인 흐름이 `accounts.kakao.com` HTTP 200에 도달하며 `KOE004`가 재발하지 않음 | 실제 카카오 계정으로 동의→콜백→서비스 세션 발급→로그아웃→재로그인까지 브라우저 검증하고 TEST 앱 의존 제거를 최종 확인 |
| 2 | 운영 API·웹 배포 | 운영 서버 소스를 `e25dd90694f14afdfd94f67ae63d0980747d2855`로 fast-forward하고 새 API 이미지를 빌드·재기동함. 이전 API 이미지는 `rollback-906ade5` 태그로 보존했으며 Docker health, 외부 liveness, DB readiness가 모두 정상임. SHA-256과 공식 설치기 검사를 통과한 같은 커밋의 정적 호스팅 번들을 원자적으로 배포했고, `current`는 `e25dd906…`, `previous`는 `15f5743…`로 보존됨. Nginx 검사·reload, 외부 웹 매니페스트, 핵심 페이지 HTTP 200, 배포 `config.js`와 검증 산출물 일치를 확인함. 2026-09-12 외부 재점검에서도 홈페이지·liveness·DB readiness가 모두 HTTP 200이고 TLS 1.3·HSTS가 정상임 | 완료. 다음 운영 변경 전 현재 API 이미지 digest와 정적 `current`/`previous` 커밋을 배포 기록에 함께 남기고 동일 절차로 롤백 가능성 유지 |
| 3 | 릴리스 준비 감사 | CodeQL을 아홉 번째 필수 워크플로로 추가하고 첫 두 분석과 전체 CI가 통과함. 첫 분석 경고 14건 중 실제 코드 9건을 수정하고 설계상 안전한 5건은 항목별 근거와 함께 오탐 종료해 열린 CodeQL 경고가 0건임. Dependabot 주간 정책, 취약점 경고와 자동 보안 업데이트도 활성화했고 열린 취약점 경고는 0건임. 초기 버전 점검이 업데이트 PR 15개를 생성했으며 메이저 업데이트는 자동 병합하지 않음. 남은 감사 실패 조건은 저장소 Secret 6개와 production Secret 9개임 | Dependabot PR을 호환성·CI 결과에 따라 분리 검토하고, 최소 권한 `RELEASE_READINESS_TOKEN`과 실제 스테이징·격리 복구·메일 반송·법무 승인 자료를 준비해 Secret 15개를 등록한 뒤 공식 감사를 재실행 |
| 4 | 스테이징·인수 증빙 | 최신 CI run `34413191522`는 성공했고 웹·브라우저·SBOM artifact가 존재함. 실제 스테이징 부하·워커 soak·후보 인수 실행은 없음 | 스테이징 URL·메트릭 토큰·불변 이미지 digest·격리 복구 DB를 준비하고 부하→soak→후보 인수 순으로 성공 artifact 생성 |
| 5 | 결제 운영 전환 | 프런트 설정은 토스 테스트 모드이며 실제 결제 운영키·웹훅은 미등록. 소액 승인·중복 승인·웹훅·전액 환불·토스 취소를 봉인하는 12개 판정과 릴리스별 임시 Secret 수명주기 도구는 구현됨 | 토스 운영 클라이언트 키·Secret Key·웹훅 Secret을 비밀 저장소에 등록하고, 실제 후보에서 소액 왕복 증빙을 생성해 임시 Secret 등록→운영 검증→제거 순서로 완료 |
| 6 | 메일·DNS·TLS | 운영 SMTP 공급자를 Resend로 확정하고 Compose 기본값을 `smtp.resend.com:587` STARTTLS·사용자명 `resend`로 고정함. 거래 메일 발신 도메인은 `notify.handol-edu.com`을 사용함. Resend MAIL FROM SPF 도메인 분리, 여러 DKIM CNAME 검증과 Svix 서명 기반 `email.bounced` 전용 엔드포인트까지 구현됨. 기존 루트 도메인의 DMARC는 `p=none`이고 Resend 발급 DNS·API 키·웹훅 Secret은 아직 미등록 | Resend에서 `notify.handol-edu.com`을 생성하고 대시보드가 발급한 `send.notify.handol-edu.com` SPF·MX와 DKIM CNAME을 DNS에 그대로 등록. `MAIL_SPF_DOMAIN`과 `MAIL_DKIM_SELECTORS`에 실제 값을 입력하고 발신 도메인의 DMARC를 `quarantine` 또는 `reject`로 강화. 제한된 운영 API 키와 `RESEND_WEBHOOK_SECRET`을 비밀 저장소에 등록하고 `https://handol-edu.com/api/v1/mail/webhooks/resend`의 `email.bounced` 구독, SMTP TLS·인증·영구 반송 시험 통과 |
| 7 | 법무·사업자 정보 | 상호·대표자·사업자번호·통신판매업·고객센터·정책 승인값이 확정되지 않음 | 실제 값을 입력하고 이용약관·개인정보·환불·보호자 동의문 법률 검토와 승인 기록 완료 |
| 8 | 최종 릴리스 종료 | 운영 배포 검증과 closeout 실행 이력 없음 | 성공한 후보 인수→실제 배포→운영 검증→closeout을 동일 릴리스 ID·후보 SHA·이미지 digest로 연결해 90일 보관 |

2026-09-12 운영 컨테이너에서 실행한 프리플라이트에서 확인된 실패 항목에는
`OBJECT_STORAGE_NOT_CONFIGURED`, `MALWARE_SCANNER_NOT_CONFIGURED`,
`MAIL_DOMAIN_AUTH_NOT_CONFIGURED`가 있습니다. 전체 9개 판정의 재수집은 서버 SSH 인증 후
진행하며, 확인되지 않은 항목을 통과로 간주하지 않습니다.

객체 저장소 프리플라이트는 이제 환경변수의 버전 관리 선언만 신뢰하지 않고 S3 호환
`GetBucketVersioning` 응답이 실제 `Enabled`인지 확인합니다. 이어서 비공개 임시 객체의
쓰기·읽기·삭제와 익명 접근 차단을 검사하며, 버전 관리가 중지됐거나 상태 조회 권한이
없으면 실패합니다. 저장소 구현 검증은 완료됐지만 실서버의
`OBJECT_STORAGE_NOT_CONFIGURED` 해소에는 실제 HTTPS endpoint·region·bucket·최소 권한
자격정보와 버전 관리 활성화가 필요합니다. 런타임 역할 또는 키에는 객체 작업 권한 외에
버킷의 `GetBucketVersioning` 조회 권한도 부여해야 합니다.

같은 날 저장소의 운영 Compose에는 사설망 전용 ClamAV 서비스, 서명 DB 영속 볼륨,
4GB 메모리 상한, 2GB 영상 검사용 2200MB 제한, 헬스체크 기반 API·영상 워커 시작 순서를
반영했습니다. 호스트 준비 점검도 API·ClamAV 이미지의 불변 digest, Compose 유효성,
ClamAV 헬스와 호스트 3310 포트 미노출을 검사합니다. 이는 저장소 구현 완료 상태이며,
실서버의 `MALWARE_SCANNER_NOT_CONFIGURED` 해소는 커스텀 ClamAV 이미지를 레지스트리에
게시하고 실제 `CLAMAV_IMAGE=repository@sha256:...`를 등록한 뒤 재배포·프리플라이트해야
완료로 판정합니다.

메일 도메인 프리플라이트는 SPF의 마지막 `all`이 `~all` 또는 `-all`인지, DMARC 정책이
중복 없이 `quarantine` 또는 `reject`인지, 레거시 `pct`가 있으면 `100`인지까지 검사하도록
강화했습니다. 2026-09-12 재조회한 `handol-edu.com` SPF는
`v=spf1 ip4:115.71.237.165 ~all`로 이 기준을 통과하지만 DMARC는
`v=DMARC1; p=none;`이어서 실패합니다. `notify.handol-edu.com`과
`_dmarc.notify.handol-edu.com`은 현재 와일드카드 영향으로 `handol-edu.com`을 가리키는
CNAME으로 응답하며 Resend 전용 SPF·DMARC가 아닙니다. 확인한 `mail2026`·`default`·`selector1`
DKIM 선택자에는 TXT 공개키가 없었고 `mail.handol-edu.com`의 25·465·587 포트도 외부에서
연결되지 않았습니다. Resend가 발급한 `send.notify.handol-edu.com` MX·SPF와 세 DKIM CNAME,
명시적인 `_dmarc.notify.handol-edu.com` 정책을 등록해 와일드카드보다 우선하게 하고
`MAIL_SPF_DOMAIN=send.notify.handol-edu.com`과 모든 DKIM 선택자를 입력한 뒤 재검증해야 합니다.

운영 Secret의 값은 이 문서나 Git 이력에 기록하지 않고 GitHub Environment Secret 및
서버의 권한 제한 환경 파일로만 전달합니다.

## 1. 채택한 기본안

아래 권장안은 개발과 운영의 기본안으로 채택했습니다. 실제 계약값과 사업자 정보는
준비되는 시점에 입력하되 구현 구조는 아래 기준으로 진행합니다.

- 백엔드: Node.js 24 LTS + NestJS + PostgreSQL + Prisma
- 구조: 초기에는 도메인 모듈형 단일 API 서버
- 게임 진입: 홈페이지 모달 기본, 직접 URL 딥링크 병행
- 바둑미션 점수: 100점 기본, 오답 -20점, 힌트 단계별 -10점, 최저 0점
- 재도전: 기본 무제한, 연속 수순은 서버 확정 체크포인트 사용
- 초기 콘텐츠: 선사시대 1강 6문항, 9줄 4개·13줄 1개·19줄 1개
- 결제: 토스페이먼츠 SDK v2 + Core API로 통일
- 운영정책: 분류·번호·통계·추천·파일·게시판·개인정보·알림·분석
- 개발환경: local·test·staging·production 분리
- 테스트: Vitest + Playwright
- CI/CD: GitHub Actions, 스테이징 자동·운영 승인 배포
- 배포: 정적 프런트엔드 + Docker API + 관리형 PostgreSQL + 비공개 객체 저장소
- 관측성·백업: 구조화 로그, 감사로그, PITR, 일일 백업, 분기 복구훈련

상세 내용은 [서비스 운영 정책 초안](./OPERATIONS_POLICY.md)과
[구현·개발·배포 제안서](./IMPLEMENTATION_PROPOSAL.md)를 실행 기준으로 사용합니다.

## 2. 의도적으로 남겨둔 기술 미확정

| ID | 항목 | 현재 제안 범위 | 결정 시점 |
|---|---|---|---|
| R-01 | 자동 HLS 변환 운영 규모 | FFmpeg 영속 큐 워커, 원본 이하 최대 360p·720p fMP4 HLS, 재시도·경쟁 방지 구현됨 | GPU 변환·1080p 이상·동시 처리량과 비용은 실제 영상량 측정 후 확정 |
| R-02 | CDN 운영 활성화 | CloudFront·신뢰 키 그룹 기반 SHA-256 서명 URL 어댑터와 S3 폴백 구현됨 | 운영 AWS 계정의 배포·OAC·도메인·인증서·캐시 정책과 비용 확정 후 활성화 |

## 3. 사업자가 값을 제공해야 하는 항목

다음은 정책 미확정이 아니라 실제 운영값과 문서가 필요한 항목입니다.

- 기본 도메인과 운영·스테이징 주소
- 네이버·카카오·Google 운영 앱과 Redirect URI
- 토스페이먼츠 운영 클라이언트 키·Secret Key·웹훅
- 실제 상호·대표자·사업자번호·통신판매업·고객센터 정보
- 이용약관, 개인정보처리방침, 결제·환불정책, 보호자 동의문
- 영상·PPT·PDF·이미지·문제·교재 콘텐츠 권리대장

상상바둑 공식 사이트를 참고해 작성한 초안은 [사업자·운영자 작성안](./EXTERNAL_PREPARATION.md)을 검토합니다.

## 4. 구현 진행 범위

1. 회원·OAuth·세션·역할·보호자 연결 데이터 기반 **구현됨**, 실제 인증 API는 다음 단계
2. React 화면 이전과 API 연결
3. 바둑 규칙·수순 엔진, 9·13·19줄 플레이어
4. 미션·강의 CMS와 학습기록
5. 토스 주문·승인·조회·웹훅·환불·구독
6. 게시판·문의·신고·파일 저장
7. 학생·보호자·지도자 대시보드
8. 알림·통계·추천·개인정보 파기 배치

구현 순서와 완료 조건은 [구현·개발·배포 제안서](./IMPLEMENTATION_PROPOSAL.md)를 따릅니다.
