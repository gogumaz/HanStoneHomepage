# 서버 배포 패키지 설치

이 절차는 `hanstone-hosting-커밋.tgz`의 무결성을 확인하고 정적 홈페이지를
`/var/www/hanstone`에 안전하게 설치합니다. 512MB 호스팅에서는 API·데이터베이스 컨테이너를
함께 실행하지 말고 우선 정적 홈페이지만 설치합니다.

## 1. 압축 파일 검증

서버의 `/tmp`에 `.tgz`와 `.sha256` 파일을 함께 전송한 후 실행합니다.

```bash
cd /tmp
sha256sum -c hanstone-hosting-커밋.tgz.sha256
```

반드시 `OK`가 표시되어야 합니다. 실패하면 압축을 풀지 말고 두 파일을 다시 전송합니다.
SHA-256은 전송 오류와 파일 변경을 검출하지만 배포자의 신원을 증명하는 전자서명은 아닙니다.

## 2. 별도 디렉터리에 압축 해제

기존에 풀어 둔 파일과 섞이지 않도록 새 디렉터리를 사용합니다.

```bash
PACKAGE_DIR="$(mktemp -d /tmp/hanstone-package.XXXXXX)"
tar -xzf /tmp/hanstone-hosting-커밋.tgz -C "$PACKAGE_DIR"
cd "$PACKAGE_DIR/hanstone-hosting"
```

`커밋` 부분은 실제 받은 파일명으로 바꿉니다. `mktemp`가 매번 겹치지 않는 새 디렉터리를
만들기 때문에 이전에 압축을 푼 파일과 섞이지 않습니다.

## 3. 읽기 전용 사전 검사

다음 명령은 서버 파일을 변경하지 않습니다. Python 3가 없다면 먼저 호스팅 관리자에게 설치를
요청합니다.

```bash
python3 deploy/install-hosting-release.py --check
```

정상 결과는 `"ok":true`, `"mode":"check"`를 포함합니다. 오류가 나오면 설치를 진행하지
않습니다. 전달받은 커밋값까지 고정해 확인하려면 다음 옵션을 추가합니다.

```bash
python3 deploy/install-hosting-release.py --check \
  --expected-commit 40자리_커밋_SHA
```

검사 항목은 다음과 같습니다.

- 패키지 종류와 커밋 형식
- 매니페스트의 전체 파일 목록·크기·SHA-256
- 누락 파일과 매니페스트에 없는 추가 파일
- 심볼릭 링크와 비밀 파일명
- 홈페이지 필수 진입 파일

## 4. 정적 홈페이지 설치

사전 검사가 통과했을 때만 실행합니다.

```bash
sudo python3 deploy/install-hosting-release.py --apply
```

도구는 다음 구조를 만듭니다.

```text
/var/www/hanstone/
├── current -> releases/현재커밋
├── previous -> releases/이전커밋
├── manifests/현재커밋.json
└── releases/현재커밋/
```

새 웹 파일은 먼저 임시 릴리스에 복사·재검증되고, 성공한 경우에만 `current` 링크가
교체됩니다. 이전 릴리스는 삭제하지 않습니다. 같은 커밋을 다시 실행하면 설치 파일이 정확히
일치하는지 검사한 뒤 중복 복사하지 않습니다.

## 5. 설치 결과 확인

```bash
readlink /var/www/hanstone/current
sudo nginx -t
sudo systemctl reload nginx
curl -I http://uzdream.com
```

최초 인증서 발급 전에는 `deploy/nginx/README.md`의 HTTP 부트스트랩 절차를 먼저 따릅니다.
HTTPS 설정까지 완료했다면 다음 명령도 확인합니다.

```bash
curl -I https://uzdream.com
curl -I https://uzdream.com/config.js
```

운영 준비상태 전체 검사는 다음과 같습니다.

```bash
sudo bash deploy/check-host-readiness.sh --mode static \
  --domain uzdream.com --expected-ip 서버_공인_IP
```

## 6. 이전 정상 버전으로 롤백

현재 사이트에 장애가 있고 `previous`가 정상 버전임을 확인한 경우에만 롤백합니다. 먼저 두
링크가 가리키는 40자리 커밋을 확인합니다.

```bash
readlink -f /var/www/hanstone/current
readlink -f /var/www/hanstone/previous
```

출력된 경로의 마지막 40자리 값을 각각 정확히 복사해 다음 명령에 넣습니다.

```bash
sudo python3 deploy/install-hosting-release.py --rollback \
  --expected-current 현재_40자리_커밋 \
  --expected-previous 이전_40자리_커밋
```

도구는 입력한 두 커밋이 실제 링크와 일치하는지 확인하고, 이전 릴리스의 저장 매니페스트와
모든 웹 파일 해시를 재검증합니다. 검증이 끝난 경우에만 `current`를 이전 릴리스로 전환하며,
롤백 전 버전은 `previous`에 남겨 둡니다. Nginx 설정은 바뀌지 않으므로 일반적으로 reload가
필요하지 않지만 다음 응답은 반드시 확인합니다.

```bash
curl -I https://uzdream.com
curl -I https://uzdream.com/config.js
```

두 확인값 중 하나라도 다르거나 이전 파일이 변경됐다면 롤백은 실행되지 않습니다.

## 7. 문제 발생 시

- `HOSTING_INSTALL_FILE_MISMATCH`: 패키지가 변경됐습니다. 삭제 후 다시 전송합니다.
- `HOSTING_INSTALL_COMMIT_MISMATCH`: 전달받은 커밋과 패키지가 다릅니다.
- `HOSTING_INSTALL_CURRENT_NOT_SYMLINK`: 기존 `current`가 일반 디렉터리입니다. 자동으로
  덮어쓰지 않으므로 관리자 확인이 필요합니다.
- `HOSTING_INSTALL_ROLLBACK_CONFIRMATION_MISMATCH`: 확인한 커밋과 실제 링크가 다릅니다.
  현재·이전 링크를 다시 조회합니다.
- `HOSTING_INSTALL_WEB_COPY_MISMATCH`: 설치된 릴리스가 저장 매니페스트와 다릅니다. 해당
  버전으로 전환하지 말고 정상 배포 패키지를 다시 설치합니다.
- `HOSTING_INSTALL_IO_FAILED`: 권한 또는 디스크 공간을 확인합니다.

`previous`는 자동 복구용 포인터로 보존됩니다. 장애 시 임의 명령으로 링크를 바꾸기 전에
현재·이전 커밋과 점검 결과를 기록하고 롤백 절차를 수행해야 합니다.
