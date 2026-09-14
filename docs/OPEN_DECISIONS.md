# 채택 권장안과 남은 검토 사항

기준일: 2026-09-14

## 0. 운영 전환 현황과 우선순위

2026-09-14 실제 운영 환경을 기준으로 확인한 상태입니다. 아래 순서의 선행 조건이
충족되기 전에는 후보 인수·운영 배포 검증·closeout 워크플로를 임의로 실행하지 않습니다.

| 우선순위 | 항목 | 확인 결과 | 다음 완료 조건 |
|---|---|---|---|
| 1 | 카카오 로그인 | `KOE004`의 원인이던 TEST 앱 로그인 비활성화를 해소했고, TEST 앱의 닉네임·이메일 필수 동의도 활성화함. 운영 서버의 REST API 키와 클라이언트 시크릿을 정식 운영 앱 값으로 함께 전환했으며, 운영 앱의 로그인 ON·필수 동의·정확한 콜백 URI·클라이언트 시크릿 활성 상태를 확인함. 운영 URL은 정식 운영 앱과 `https://handol-edu.com/api/v1/auth/oauth/kakao/callback`으로 정상 전환되고, 비로그인 흐름이 `accounts.kakao.com` HTTP 200에 도달하며 `KOE004`가 재발하지 않음 | 실제 카카오 계정으로 동의→콜백→서비스 세션 발급→로그아웃→재로그인까지 브라우저 검증하고 TEST 앱 의존 제거를 최종 확인 |
| 2 | 운영 API·웹 배포 | API·정적 웹은 배포되어 DB 마이그레이션, Docker health, 외부 liveness/readiness와 정적 번들 검증이 통과함. API·DB·Redis와 메일·문의·과제 워커는 `unless-stopped`로 실행 중이고 UFW는 외부에 SSH·HTTP·HTTPS만 허용함. 2GB 실서버에서 ClamAV 제한 기동과 정상 헬스를 실측했고, 256MB 영상·단일 검사 스레드·직렬 미디어 처리를 사용하는 compact 운영 프로필을 추가함 | 자체 호스팅 DB·Redis가 TLS를 제공하지 않고 법무 승인·객체 저장소가 미설정이므로 API는 아직 전환용 `development` 런타임임. 4GB 증설 대신 4GB 스왑을 유지한 `deploy/compose.production.compact.yaml`로 전환하고 관리형 TLS DB·Redis, 법무 승인값과 객체 저장소를 연결 |
| 3 | 릴리스 준비 감사 | CodeQL과 전체 CI가 최신 커밋에서도 통과함. 열린 CodeQL·Dependabot 취약점 경고와 업데이트 PR은 0건임. GitHub `production` 환경에는 운영 API URL·웹 URL·보호 메트릭 토큰을 등록했으며, 인증 메트릭은 `200`, 무인증 요청은 `401`, 워커 건강도는 정상임. 남은 감사 실패 조건은 저장소 Secret 6개와 production Secret 6개임 | 최소 권한 `RELEASE_READINESS_TOKEN`과 실제 스테이징·격리 복구·메일 반송·법무 승인 자료를 준비해 남은 Secret 12개를 등록한 뒤 공식 감사를 재실행 |
| 4 | 스테이징·인수 증빙 | 최신 CI run `34797563496`와 CodeQL run `34797563500`이 성공했고 웹·브라우저·SBOM artifact가 존재함. 실제 스테이징 부하·워커 soak·후보 인수 실행은 없음 | 스테이징 URL·메트릭 토큰·불변 이미지 digest·격리 복구 DB를 준비하고 부하→soak→후보 인수 순으로 성공 artifact 생성 |
| 5 | 결제 운영 전환 | 프런트 설정은 토스 테스트 모드이며 실제 결제 운영키·웹훅은 미등록. 소액 승인·중복 승인·웹훅·전액 환불·토스 취소를 봉인하는 12개 판정과 릴리스별 임시 Secret 수명주기 도구는 구현됨 | 토스 운영 클라이언트 키·Secret Key·웹훅 Secret을 비밀 저장소에 등록하고, 실제 후보에서 소액 왕복 증빙을 생성해 임시 Secret 등록→운영 검증→제거 순서로 완료 |
| 6 | 메일·DNS·TLS | Resend SMTP `smtp.resend.com:587` STARTTLS 인증이 통과했고 제한된 발송키를 사용함. `https://handol-edu.com/api/v1/mail/webhooks/resend`의 `email.bounced` 웹훅이 Resend에서 `Enabled`이며 서명 Secret도 운영 서버에 반영됨. 계정메일 워커가 암호화키와 함께 정상 실행 중이고 무서명 웹훅 요청은 `401`로 차단됨. Resend의 루트 `handol-edu.com` 도메인은 `Verified`이지만 운영 전용 `notify.handol-edu.com`은 `Not Started`임. 2026-09-14 PHPS 1:1 상담 번호 4로 전용 DKIM·반송/발송 CNAME·DMARC 등록을 요청했고 `접수중` 상태를 확인함 | PHPS 답변과 공개 DNS 전파를 확인한 뒤 Resend `Verify DNS Records`를 실행. `MAIL_FROM`·`MAIL_SPF_DOMAIN`·`MAIL_DKIM_SELECTORS`를 전용 도메인 값으로 바꾸고 운영 프리플라이트와 실제 영구 반송 시험 증빙 생성 |
| 7 | 법무·사업자 정보 | 상호·대표자·사업자번호·통신판매업·고객센터·정책 승인값이 확정되지 않음 | 실제 값을 입력하고 이용약관·개인정보·환불·보호자 동의문 법률 검토와 승인 기록 완료 |
| 8 | 최종 릴리스 종료 | 운영 배포 검증과 closeout 실행 이력 없음 | 성공한 후보 인수→실제 배포→운영 검증→closeout을 동일 릴리스 ID·후보 SHA·이미지 digest로 연결해 90일 보관 |

2026-09-14 운영 재점검에서 API·DB·Redis·계정메일·문의알림·과제알림 프로세스는 모두
실행 중이고 공개 홈페이지·liveness·readiness가 HTTP 200임을 확인했습니다. 다만 완전한
운영 Compose 전환의 선행 조건은 여전히 충족되지 않았습니다.

2026-09-14 운영 컨테이너에서 다시 실행한 전체 9개 프리플라이트 중 데이터베이스 연결·최신
마이그레이션, Redis 원자 연산, FFmpeg/FFprobe 무변경 검사와 비활성 CDN 판정은 통과했습니다.
배포 후보 SHA와 이미지 digest 전달 오류도 전환용 Compose 보강으로 제거했습니다. 남은 실패는
`TOSS_PAYMENTS_LIVE_SECRET_REQUIRED`, `DATABASE_PITR_REQUIRED`,
`OBJECT_STORAGE_NOT_CONFIGURED`, `MALWARE_SCANNER_NOT_CONFIGURED`,
`MAIL_DOMAIN_AUTH_NOT_CONFIGURED`입니다. 확인되지 않은 항목을 통과로 간주하지 않습니다.

객체 저장소 프리플라이트는 이제 환경변수의 버전 관리 선언만 신뢰하지 않고 S3 호환
`GetBucketVersioning` 응답이 실제 `Enabled`인지 확인합니다. 이어서 비공개 임시 객체의
쓰기·읽기·삭제와 익명 접근 차단을 검사하며, 버전 관리가 중지됐거나 상태 조회 권한이
없으면 실패합니다. 저장소 구현 검증은 완료됐지만 실서버의
`OBJECT_STORAGE_NOT_CONFIGURED` 해소에는 실제 HTTPS endpoint·region·bucket·최소 권한
자격정보와 버전 관리 활성화가 필요합니다. 런타임 역할 또는 키에는 객체 작업 권한 외에
버킷의 `GetBucketVersioning` 조회 권한도 부여해야 합니다.

2GB 호스트에 저장소 프로세스를 추가하지 않도록 AWS S3 서울 리전용
`deploy/aws-object-storage.yaml`과 확인 문구를 요구하는 프로비저닝 도구를 준비했습니다.
템플릿은 버전 관리·기본 암호화·공개 접근 전면 차단·HTTPS 강제·운영 도메인 CORS·비현재
버전 보존과 애플리케이션 최소 권한 IAM 사용자를 선언하며 액세스 키를 만들거나 출력하지
않습니다. 현재 작업 환경에는 인증된 AWS 계정이 없어 과금 리소스는 생성하지 않았습니다.

같은 날 저장소의 표준 운영 Compose에는 사설망 전용 ClamAV 서비스, 서명 DB 영속 볼륨,
4GB 메모리 상한, 2GB 영상 검사용 2200MB 제한, 헬스체크 기반 API·영상 워커 시작 순서를
반영했습니다. 2GB 서버용 compact 오버레이는 영상 상한을 256MB로 낮추고 ClamAV를 단일
스레드·1250MB 상한으로 실행하며 미디어 검사와 변환을 직렬화합니다. 호스트 준비 점검은
`--resource-profile compact`에서 1900MiB 메모리와 4GiB 스왑을 요구합니다.

2026-09-14 수동 승인형 `Publish managed ClamAV image` 워크플로 run `34800240067`이
성공했습니다. `ghcr.io/gogumaz/hanstone-clamav`에 SBOM·provenance가 결합된 이미지를
게시했고 익명 pull을 검증했으며, 배포용 불변 참조는
`ghcr.io/gogumaz/hanstone-clamav@sha256:d5db12ce7cd7a7365ecda2a9db990fb7eda731cbb0c42a4cdd06fc65aef3acee`입니다.
실서버 `1967 MiB` 메모리와 4GiB 스왑에서 이 digest를 1250MiB 상한·단일 스레드로
격리 기동한 결과 ClamAV가 healthy 상태와 `PONG` 응답에 도달했고, 유휴 점유량은 약
989MiB였습니다. 이 실측값을 compact 프로필에 반영했으며 해당 오버레이로 재배포하고
프리플라이트해야 `MALWARE_SCANNER_NOT_CONFIGURED`가 해소됩니다.

같은 실서버 준비 점검에서 UFW가 비활성 상태임을 확인해 SSH·Nginx와 22·80·443
리스너를 먼저 검증하고, 기존 규칙 백업·오류 시 복원·정확한 확인 문구를 강제하는
`deploy/configure-host-firewall.sh`를 추가했습니다. 2026-09-14 별도 복구용 SSH 세션을
유지한 상태에서 적용했고 새 SSH 연결과 홈페이지·liveness·readiness HTTP 200을 확인했습니다.
외부 TCP 검증에서는 22·80·443만 연결되고 3000·3310·5432·6379는 차단됐습니다. 재실행한
호스트 준비 점검은 UFW·SSH·HTTP·HTTPS 항목을 모두 통과했고, 메모리 항목은 compact
프로필로 대체했습니다.

메일 도메인 프리플라이트는 SPF의 마지막 `all`이 `~all` 또는 `-all`인지, DMARC 정책이
중복 없이 `quarantine` 또는 `reject`인지, 레거시 `pct`가 있으면 `100`인지까지 검사하도록
강화했습니다. 2026-09-14 재조회한 `handol-edu.com` SPF는
`v=spf1 ip4:115.71.237.165 ~all`로 이 기준을 통과하지만 DMARC는
`v=DMARC1; p=none;`이어서 실패합니다. `notify.handol-edu.com`과
`_dmarc.notify.handol-edu.com`은 현재 와일드카드 영향으로 `handol-edu.com`을 가리키는
CNAME으로 응답하며 Resend 전용 SPF·DMARC가 아닙니다. 확인한 `mail2026`·`default`·`selector1`
DKIM 선택자에는 TXT 공개키가 없었고 `mail.handol-edu.com`의 25·465·587 포트도 외부에서
연결되지 않았습니다. Resend가 발급한 MAIL FROM·DKIM DNS 레코드와
명시적인 `_dmarc.notify.handol-edu.com` 정책을 등록해 와일드카드보다 우선하게 하고
`MAIL_SPF_DOMAIN=send.notify.handol-edu.com`과 모든 DKIM 선택자를 입력한 뒤 재검증해야 합니다.

2026-09-14 Resend 대시보드에서 운영 전용 도메인의 실제 요구값을 다시 확인했습니다.
요구 호스트는 `resend._domainkey.notify.handol-edu.com`,
`rsend.notify.handol-edu.com`, `send.notify.handol-edu.com`이며, 별도로
`_dmarc.notify.handol-edu.com`에 `p=quarantine; pct=100` 정책을 사용합니다. 이 네 레코드를
PHPS 1:1 상담 번호 4로 접수했으며 네임서버 변경은 수행하지 않았습니다. PHPS 처리 전에는
Resend 검증 버튼이나 운영 서버 메일 도메인 환경값을 앞당겨 변경하지 않습니다.

운영 Secret의 값은 이 문서나 Git 이력에 기록하지 않고 GitHub Environment Secret 및
서버의 권한 제한 환경 파일로만 전달합니다.

## 1. 채택한 기본안

아래 권장안은 개발과 운영의 기본안으로 채택했습니다. 실제 계약값과 사업자 정보는
준비되는 시점에 입력하되 구현 구조는 아래 기준으로 진행합니다.

- 백엔드: Node.js 26 + NestJS + PostgreSQL + Prisma
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
