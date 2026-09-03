# 정적 홈페이지 배포 후 검증

설치 또는 롤백 직후에는 실제 인터넷 응답이 설치된 파일과 같은지 확인합니다. 이 검증기는
서버 설정과 홈페이지를 변경하지 않으며 결과만 JSON으로 출력합니다.

## 실행 전 확인

현재 설치된 커밋을 조회합니다.

```bash
readlink -f /var/www/hanstone/current
```

출력 경로의 마지막 40자리 커밋을 복사합니다. HTTPS 인증서와 Nginx 설정이 완료된 뒤 다음
명령을 실행합니다.

```bash
sudo python3 deploy/verify-hosting-release.py \
  --base-url https://uzdream.com \
  --expected-commit 현재_40자리_커밋
```

JSON 보고서를 새 파일로 보관하려면 `--output`을 추가합니다. 기존 파일은 덮어쓰지 않습니다.

```bash
sudo python3 deploy/verify-hosting-release.py \
  --base-url https://uzdream.com \
  --expected-commit 현재_40자리_커밋 \
  --output /var/log/hanstone/hosting-verification-YYYYMMDD.json
```

먼저 `/var/log/hanstone` 디렉터리를 만들어 두거나 쓰기 가능한 다른 보관 경로를 지정합니다.

## 자동 검사 항목

- `current`가 예상 커밋의 릴리스를 가리키는지 확인
- 저장된 배포 매니페스트와 설치 파일 전체의 크기·SHA-256 재검증
- `/`, `/app.html`, `/config.js`, 결제 성공·실패 화면 확인
- `/dashboard` 새로고침이 `app.html`과 같은 내용을 반환하는지 확인
- 공개 웹 매니페스트와 대표 해시 자산의 실제 응답 바이트 확인
- Content-Type과 Cache-Control 정책 확인
- CSP, HSTS, 프레임 차단 등 주요 보안 헤더 확인
- HTTP가 같은 도메인의 HTTPS로 영구 이동하는지 확인
- 운영 인증서 체인·호스트명과 TLS 1.2 이상 검증

JavaScript는 Nginx 배포판에 따라 `text/javascript` 또는 `application/javascript`로 제공될
수 있어 두 표준 MIME 형식을 같은 정책으로 인정합니다. 다른 파일 형식은 매니페스트와 정확히
일치해야 합니다.

## 결과 판정

정상 결과는 다음 값을 포함하고 종료 코드는 `0`입니다.

```json
{"ok":true,"rollbackRecommended":false}
```

한 항목이라도 실패하면 `ok`는 `false`, `rollbackRecommended`는 `true`이고 종료 코드는
`1`입니다. 이 경우 새 배포를 정상으로 확정하지 말고 `failures`의 오류 코드를 확인합니다.
설치된 파일이 손상됐거나 이전 버전이 검증된 상태라면 `HOSTING_INSTALL.md`의 롤백 절차를
사용합니다.

`--ca-file`은 공개 운영 사이트가 아닌 사설 테스트 환경의 자체 CA를 검증할 때만 사용합니다.
인증서 검증을 비활성화하는 옵션은 제공하지 않습니다.
