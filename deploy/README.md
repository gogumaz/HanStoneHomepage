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

각 환경의 DB, OAuth Secret, PortOne V1 REST API Secret과 객체 저장소 자격증명은 서로 공유하지 않습니다.
Secret은 저장소나 프런트 빌드에 넣지 않고 배포 플랫폼의 비밀 관리 기능으로 주입합니다.
필수 배포 변수의 이름은 `production.env.example`, 결제 세부 변수의 이름은
`../payment/portone-v1.server.example.env`를 기준으로 등록합니다. AWS 역할 기반 자격증명을 사용하면 객체 저장소 Access Key 두 항목은 비워 두고 런타임 역할에 대상 접두사의 `GetObject`·`PutObject`·`DeleteObject` 권한을 부여합니다. 버킷 공개 접근은 차단하고 프런트 운영 도메인의 업로드 `POST`와 HLS 세그먼트 `GET`·`HEAD`를 허용하는 CORS 규칙을 설정합니다. CloudFront에는 비공개 S3 origin과 OAC, `lesson-videos/*`·`lesson-hls/*` behavior, 신뢰 키 그룹, HTTPS 도메인·인증서를 설정하고 키 ID와 base64 PEM 개인키를 배포 Secret으로 주입합니다.

계정 보안 토큰의 기본 유효기간은 비밀번호 재설정 30분, 이메일 인증 24시간입니다. 운영 응답에는 개발용 토큰이 포함되지 않으며 SMTP로 `PUBLIC_APP_URL`의 계정 링크를 발송합니다. 운영 배포에는 `SMTP_HOST`, `MAIL_FROM`, `PUBLIC_APP_URL`이 필수입니다. 587 포트는 STARTTLS를 강제하고 465 포트는 implicit TLS 설정을 사용합니다. 발송 결과는 감사로그에 남지만 영속 발송 큐, 자동 재시도, 반송·불만 신고 처리는 운영 고도화 항목입니다.

OAuth 제공사는 client ID·secret·redirect URI가 모두 있을 때만 등록됩니다. Redirect URI는 제공사 콘솔 값과 정확히 일치해야 하며 운영 주소는 HTTPS만 허용합니다. 실제 공급자 앱이 승인되기 전에는 프런트 `oauthEnabled=false`를 유지합니다. OAuth와 PortOne 코드는 `server/src/components`의 CBD 모듈로 분리되어 있으므로 현재 DB 모델과 무관하게 다른 NestJS 서비스에서도 같은 계약을 사용할 수 있습니다.

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
2. API 이미지를 커밋 SHA 태그로 빌드·보관합니다.
3. 같은 이미지를 사용해 `npm run db:deploy`를 한 번 실행합니다.
4. 같은 이미지와 운영 환경변수로 `node dist/production-preflight.js`를 실행하고 모든 점검이 `pass`인지 확인합니다.
5. `deploy/compose.production.yaml` 또는 선택한 플랫폼에서 API와 같은 이미지의 `video-scan-worker`, `hls-transcode-worker`, `video-cleanup-worker`를 함께 교체합니다. 이미지에는 FFmpeg·FFprobe가 포함되어야 합니다.
6. `/api/v1/health/live`, `/api/v1/health/ready`와 핵심 사용자 경로를 확인합니다.
7. 오류율이 기준을 넘으면 이전 이미지로 되돌립니다. 적용된 DB 마이그레이션은 되돌리지 않고 호환 마이그레이션으로 복구합니다.

실제 자동 배포 연결에는 호스팅 사업자, 리전, 도메인, 이미지 저장소와 GitHub 환경 Secret 확정이 필요합니다.

Compose 템플릿에서는 다음과 같이 프리플라이트를 일회성 컨테이너로 실행합니다. 종료 코드가 0이어야 배포를 계속합니다.

```powershell
docker compose --env-file deploy/production.env -f deploy/compose.production.yaml run --rm api node dist/production-preflight.js
```

프리플라이트는 최신 DB 스키마, 객체 저장소의 임시 객체 쓰기·읽기·삭제, 설정된 CloudFront 서명 URL의 실제 바이트 조회, FFmpeg·FFprobe 실행 가능 여부, ClamAV 정상 스트림 검사, SMTP DNS·TCP·TLS·인증, PortOne 접근 토큰 발급과 필수 OAuth 설정을 점검합니다. 메일·결제 변경은 발생시키지 않으며 결과 JSON에는 Secret, CDN 서명 URL과 공급자 접근 토큰을 기록하지 않습니다. 임시 저장소 키는 `lesson-videos/preflight/` 또는 `lesson-hls/preflight/` 아래에 만들고 성공·실패와 관계없이 삭제를 시도합니다. 운영에서 CDN을 필수화하려면 `PREFLIGHT_REQUIRE_CDN=true`로 두고, 일부 OAuth 공급자를 의도적으로 제외하려면 `PREFLIGHT_REQUIRED_OAUTH_PROVIDERS`를 실제 제공 목록으로 조정합니다.

## 악성 파일 검사

소형 학습자료는 운영 API가, MP4 영상은 독립 `video-scan-worker`가 `MALWARE_SCANNER_HOST`의 ClamAV `clamd`에 TCP `INSTREAM`으로 격리 파일을 전송합니다. 3310 포트는 인증·암호화를 제공하지 않으므로 공개 인터넷에 노출하지 않고 API·워커와 같은 사설망에서만 허용합니다. 공식 ClamAV 컨테이너는 서명 데이터 볼륨을 영속화하고 최소 3GB, 권장 4GB 이상의 메모리를 배정합니다.

ClamAV `StreamMaxLength`, `MaxFileSize`, `MaxScanSize`는 `VIDEO_UPLOAD_MAX_BYTES` 이상이어야 합니다. 로컬 `deploy/clamav/Dockerfile`은 2GB 업로드 상한에 맞춰 2200MB로 설정합니다. 운영 ClamAV도 같은 기준의 `clamd.conf`를 배포해야 합니다. 영상 워커는 기본 5초 간격으로 작업을 가져오고 1분·5분·30분 간격으로 최대 3회 재시도합니다. `VIDEO_SCAN_POLL_INTERVAL_MS`, `VIDEO_SCAN_MAX_ATTEMPTS`, `VIDEO_SCAN_LOCK_TIMEOUT_MS`로 조정하며 검사 통과 전에는 새 영상이 재생 자산에 연결되지 않습니다.

`video-cleanup-worker`는 24시간 지난 미완료 업로드와 교체 후 24시간 보존기간이 지난 이전 관리형 영상을 영속 DB 큐로 삭제합니다. 삭제 직전 현재 강의 참조를 재검사하고 장애 시 최대 5회 재시도합니다. `VIDEO_UPLOAD_ABANDONED_AFTER_HOURS`, `VIDEO_REPLACED_RETENTION_HOURS`, `VIDEO_CLEANUP_*`로 정책을 조정합니다. 저장소 자격증명에는 `DeleteObject` 권한이 필요합니다. 버전 관리 버킷에서는 단순 삭제가 삭제 마커를 만들므로 비현재 버전 만료는 별도 Lifecycle 규칙으로 운영합니다.
