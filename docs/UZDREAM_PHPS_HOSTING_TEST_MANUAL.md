# uzdream.com PHPS 서버 테스트 설치 매뉴얼

문서 버전: 1.1
확인 기준일: 2026-09-03

대상 서버: PHPS 가상서버호스팅 `uzdream`, `115.71.237.88`, Ubuntu 20.04 64bit,
메모리 512MB, 디스크 30GB

## 1. 결론과 허용 범위

PHPS의 OS 재설치 목록에는 Ubuntu 24.04가 없으므로 **Ubuntu 20.04 64bit를 그대로 사용해
정적 홈페이지를 테스트**합니다. 다만 Ubuntu 20.04의 일반 보안 지원은 2025년 5월에 끝났기
때문에, 인터넷에 공개하기 전에 Ubuntu Pro를 연결하고 `esm-infra`와 `esm-apps`가 모두
`enabled`인지 확인해야 합니다.

이 서버에서 허용하는 범위는 HTML/CSS/JavaScript, 이미지, React 정적 빌드 결과와 Nginx
동작 확인까지입니다. 로그인, 회원가입, 관리자 저장, 결제 승인, API, PostgreSQL, Redis는
이 512MB 테스트 서버에서 운영하지 않습니다.

## 2. `:4173` 주소가 열리지 않은 이유

Windows PC에서 실행한 다음 명령은 그 PC 안의 `127.0.0.1`에만 개발 서버를 엽니다.

```powershell
npm run dev:web -- --port 4173 --strictPort
```

따라서 명령을 실행한 **같은 PC**의 브라우저에서 확인합니다.

```text
http://127.0.0.1:4173/index.html
http://127.0.0.1:4173/app.html
```

`http://www.uzdream.com:4173/index.html`은 PHPS 서버의 4173 포트로 접속하는 주소이므로
열리지 않는 것이 정상입니다. PHPS 서버 테스트는 개발 서버를 공개하지 않고, 빌드된 정적
파일을 Nginx에 설치한 뒤 아래 주소로 확인합니다.

```text
http://uzdream.com/       설치 중 임시 확인
https://uzdream.com/      인증서 설치 후 최종 확인
```

## 3. 현재 확인된 상태

| 항목 | 현재 상태 | 판단 |
|---|---|---|
| `uzdream.com` DNS | `115.71.237.88` | 정상 |
| `www.uzdream.com` DNS | 최종적으로 `115.71.237.88` | 정상 |
| HTTP 80 / HTTPS 443 | 외부 연결 불가 | Nginx·방화벽·인증서 설치 필요 |
| 서버 OS | Ubuntu 20.04 64bit | ESM 활성화 조건부 정적 테스트만 허용 |
| 서버 메모리 | 512MB | 정적 파일 테스트 전용 |

OS를 새로 설치하면 서버 데이터가 모두 삭제됩니다. 화면에 이미 Ubuntu 20.04가 설치되어
있으므로 서버를 초기화할 이유가 없다면 `OS재설치`를 누르지 말고 SSH 접속부터 진행합니다.

## 4. Ubuntu Pro ESM 활성화

아래 명령은 PHPS 서버에 SSH로 접속한 뒤 실행합니다. Ubuntu Pro 연결에는 Ubuntu 계정이
필요합니다. 개인용 무료 구독을 사용할 수 있으며, 토큰을 문서나 채팅에 기록하지 않습니다.

```bash
sudo apt update
sudo apt install -y ubuntu-advantage-tools
sudo pro attach
```

`sudo pro attach`가 표시하는 웹 주소를 본인 PC 브라우저에서 열고, 화면의 코드를 입력해
연결을 완료합니다. 이어서 ESM 두 항목을 활성화하고 상태를 확인합니다.

```bash
sudo pro enable esm-infra
sudo pro enable esm-apps
pro status
```

출력에서 다음 두 서비스의 STATUS가 반드시 `enabled`여야 합니다.

```text
esm-infra    ...    enabled
esm-apps     ...    enabled
```

둘 중 하나라도 `enabled`가 아니면 공개 설치를 중단합니다. 연결이 끝난 뒤 보안 업데이트를
적용합니다.

```bash
sudo apt update
sudo apt full-upgrade -y
sudo reboot
```

재부팅에는 잠시 시간이 걸립니다. 1~3분 뒤 다시 SSH로 접속하고 `pro status`를 한 번 더
확인합니다.

## 5. Windows PC에서 화면과 배포 파일 준비

프로젝트 루트 `F:\Home Page`의 PowerShell에서 실행합니다.

```powershell
npm ci
npm run dev:web -- --port 4173 --strictPort
```

같은 PC의 브라우저에서 `http://127.0.0.1:4173/index.html`과
`http://127.0.0.1:4173/app.html`을 확인한 뒤 터미널에서 `Ctrl+C`를 누릅니다.

배포 전 검사와 번들 생성을 실행합니다. 커밋되지 않은 변경이 있으면 번들 도구가 안전을
위해 중단될 수 있으므로 `git status --short` 결과도 확인합니다.

```powershell
git status --short
npm run typecheck
npm test
$env:WEB_RELEASE_COMMIT_SHA = (git rev-parse HEAD).Trim()
npm run build:web
npm run verify:web-artifacts
npm run manifest:web-deployment
npm run bundle:hosting
```

완료되면 `artifacts` 폴더에 `hanstone-hosting-<커밋>.tgz`와 같은 이름의
`.sha256` 파일이 생성됩니다.

## 6. 배포 파일을 PHPS 서버로 전송

PHPS 관리 화면에서 실제 SSH 사용자명과 SSH 포트를 확인합니다. 아래의 `22`와
`PHPS_SSH_USER`는 확인한 값으로 바꿉니다.

```powershell
$PackagePath = (Get-ChildItem .\artifacts\hanstone-hosting-*.tgz |
  Sort-Object LastWriteTime -Descending |
  Select-Object -First 1).FullName
$ChecksumPath = "$PackagePath.sha256"
scp -P 22 "$PackagePath" "$ChecksumPath" PHPS_SSH_USER@115.71.237.88:/tmp/
ssh -p 22 PHPS_SSH_USER@115.71.237.88
```

비밀번호는 명령줄에 적지 말고 SSH가 물을 때 직접 입력합니다.

## 7. 서버에서 파일 검증과 압축 해제

아래 명령의 `<커밋>`을 실제 파일명으로 바꿉니다.

```bash
cd /tmp
sha256sum -c hanstone-hosting-<커밋>.tgz.sha256
PACKAGE_DIR="$(mktemp -d /tmp/hanstone-package.XXXXXX)"
tar -xzf "hanstone-hosting-<커밋>.tgz" -C "$PACKAGE_DIR"
cd "$PACKAGE_DIR/hanstone-hosting"
```

검사 결과가 `OK`가 아니면 이후 설치를 중단하고 파일을 다시 전송합니다.

## 8. Nginx와 방화벽 설치

먼저 변경하지 않는 계획 모드로 검사합니다. Ubuntu 20.04 테스트 승인 옵션은 반드시
명시해야 하며, 스크립트가 ESM 두 항목도 검사합니다.

```bash
bash deploy/bootstrap-static-host.sh \
  --allow-ubuntu-20-test \
  --ssh-port 22
```

`"ok":true`, `"profile":"ubuntu20-static-test"`가 나오고 SSH 포트가 정확할 때만
적용합니다.

```bash
sudo bash deploy/bootstrap-static-host.sh \
  --apply \
  --allow-ubuntu-20-test \
  --ssh-port 22 \
  --confirm INSTALL_STATIC_HOSTING_TEST
```

주요 오류의 의미는 다음과 같습니다.

- `STATIC_BOOTSTRAP_UBUNTU_20_TEST_APPROVAL_REQUIRED`: 승인 옵션이 빠짐
- `STATIC_BOOTSTRAP_UBUNTU_20_ESM_REQUIRED`: Ubuntu Pro 또는 ESM 활성화가 확인되지 않음
- `STATIC_BOOTSTRAP_TEST_CONFIRMATION_REQUIRED`: 테스트 전용 확인 문구가 다름
- `STATIC_BOOTSTRAP_ACTIVE_SSH_PORT_MISMATCH`: 현재 접속 포트와 입력 포트가 다름

## 9. 정적 홈페이지 설치와 HTTP 확인

```bash
python3 deploy/install-hosting-release.py --check
sudo python3 deploy/install-hosting-release.py --apply
readlink -f /var/www/hanstone/current
curl -I -H 'Host: uzdream.com' http://127.0.0.1/index.html
```

마지막 결과가 `HTTP/1.1 200 OK`이면 Windows PC 브라우저에서 임시로 확인합니다.

```text
http://uzdream.com/index.html
http://www.uzdream.com/index.html
```

## 10. HTTPS 인증서 적용

두 도메인이 모두 서버 IP `115.71.237.88`을 가리키고 HTTP가 열리는 것을 확인한 뒤
진행합니다.

```bash
sudo certbot certonly --nginx -d uzdream.com -d www.uzdream.com
sudo certbot renew --dry-run
sudo install -m 644 deploy/nginx/sites-available/hanstone.conf \
  /etc/nginx/sites-available/hanstone
sudo nginx -t
sudo systemctl reload nginx
```

브라우저에서는 포트 번호 없이 확인합니다.

```text
https://uzdream.com/
https://uzdream.com/index.html
https://uzdream.com/app.html
https://uzdream.com/dashboard
https://www.uzdream.com/
```

## 11. 최종 자동 검증

`readlink`로 확인한 40자리 커밋 값을 사용합니다.

```bash
sudo python3 deploy/verify-hosting-release.py \
  --base-url https://uzdream.com \
  --expected-commit 현재_40자리_커밋

sudo bash deploy/check-host-readiness.sh \
  --mode static \
  --allow-ubuntu-20-test \
  --domain uzdream.com \
  --expected-ip 115.71.237.88 \
  --ssh-port 22
```

첫 결과는 `"ok":true`, `"rollbackRecommended":false`, 두 번째 결과는
`Result: READY`여야 합니다. Ubuntu 20.04 예외에서는 `--mode full`을 사용할 수 없습니다.

## 12. 페이지가 나오지 않을 때

Windows PC에서 확인합니다.

```powershell
Resolve-DnsName uzdream.com
Test-NetConnection uzdream.com -Port 80
Test-NetConnection uzdream.com -Port 443
```

Ubuntu 서버에서 확인합니다.

```bash
pro status
sudo nginx -t
sudo systemctl status nginx --no-pager
sudo ufw status verbose
sudo ss -ltnp | grep -E ':(80|443)[[:space:]]'
curl -I -H 'Host: uzdream.com' http://127.0.0.1/index.html
sudo journalctl -u nginx --since '10 minutes ago' --no-pager
```

- 서버 내부 `curl`도 실패하면 Nginx 설정·서비스·설치 파일을 확인합니다.
- 내부는 성공하고 외부만 실패하면 UFW와 PHPS 트래픽 차단 설정을 확인합니다.
- 80은 성공하고 443만 실패하면 인증서 경로와 HTTPS Nginx 설정을 확인합니다.
- DNS가 `115.71.237.88`이 아니면 PHPS의 `도메인추가(DNS)` 설정을 확인합니다.

## 13. 최종 체크리스트

- [ ] Ubuntu 20.04 64bit이며 정적 테스트 전용임을 확인함
- [ ] `pro status`에서 `esm-infra`, `esm-apps`가 모두 `enabled`임
- [ ] 실제 SSH 사용자명과 포트를 확인함
- [ ] 로컬 화면은 `127.0.0.1:4173`에서 확인함
- [ ] 배포 `.tgz`와 `.sha256` 파일을 생성함
- [ ] 서버의 SHA-256 검사 결과가 `OK`임
- [ ] 테스트 전용 옵션으로 Nginx·UFW 부트스트랩을 완료함
- [ ] 정적 릴리스 `--check`와 `--apply`가 성공함
- [ ] HTTP 확인 후 인증서를 발급함
- [ ] `https://uzdream.com/`에 포트 번호 없이 접속함
- [ ] 배포 검증 결과가 `ok:true`, `rollbackRecommended:false`임
- [ ] 준비 상태 검사 결과가 `READY`임

## 참고

- Ubuntu 20.04 표준 지원 종료 및 ESM 기간: <https://ubuntu.com/security/esm>
- Ubuntu Pro 연결 방법: <https://documentation.ubuntu.com/pro-client/en/docs/howtoguides/get_token_and_attach/>
- `pro status` 항목 설명: <https://documentation.ubuntu.com/pro-client/en/docs/explanations/status_columns/>
