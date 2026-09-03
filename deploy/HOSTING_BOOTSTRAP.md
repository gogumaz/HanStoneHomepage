# 512MB 정적 호스팅 서버 준비

이 문서는 새 Ubuntu 서버에 정적 홈페이지 운영에 필요한 최소 구성만 설치하는 절차입니다.
Docker API·PostgreSQL·Redis는 512MB 서버에서 함께 실행하지 않습니다.

## 1. 운영체제 선택

권장 기준은 Ubuntu 24.04 LTS입니다. 다만 PHPS의 재설치 목록은 Ubuntu 20.04까지만
제공하므로, 이 서버에서는 Ubuntu Pro의 `esm-infra`와 `esm-apps`를 활성화한 경우에만
20.04를 **정적 홈페이지 테스트 전용**으로 허용합니다. API·DB·결제 운영에는 사용하지
않습니다. 상세 ESM 절차는 `../docs/UZDREAM_PHPS_HOSTING_TEST_MANUAL.md`를 따릅니다.

OS 재설치는 서버 데이터를 삭제합니다. 이미 20.04가 설치되어 있고 초기화할 이유가 없다면
재설치하지 않습니다.

## 2. 실행 전 준비

- 호스팅 계약과 공인 IP 발급이 완료돼 있어야 합니다.
- SSH 접속 포트를 관리 화면에서 확인합니다. 변경하지 않았다면 일반적으로 `22`입니다.
- 검증된 배포 패키지를 서버의 별도 임시 디렉터리에 압축 해제합니다.
- SSH 연결이 끊겼을 때 사용할 호스팅 업체의 웹 콘솔 또는 복구 방법을 확인합니다.

## 3. 변경 없는 설치 계획 확인

압축을 푼 `hanstone-hosting` 디렉터리에서 실행합니다.

```bash
bash deploy/bootstrap-static-host.sh --ssh-port 22
```

PHPS Ubuntu 20.04 테스트 서버에서는 다음 명령을 사용합니다.

```bash
bash deploy/bootstrap-static-host.sh --allow-ubuntu-20-test --ssh-port 22
```

이 단계는 패키지를 설치하거나 설정을 변경하지 않습니다. Ubuntu 버전, 보존할 SSH 포트,
설치 패키지와 방화벽 추가 규칙을 보여 줍니다. 실제 SSH 포트가 다르면 `22` 대신 해당 값을
입력합니다.

## 4. 명시적으로 승인하고 적용

계획이 정확할 때만 다음 확인 문자열을 사용합니다.

```bash
sudo bash deploy/bootstrap-static-host.sh \
  --apply \
  --ssh-port 22 \
  --confirm INSTALL_STATIC_HOSTING
```

PHPS Ubuntu 20.04에서는 ESM 활성화 후 별도 확인 문자열을 사용합니다.

```bash
sudo bash deploy/bootstrap-static-host.sh \
  --apply \
  --allow-ubuntu-20-test \
  --ssh-port 22 \
  --confirm INSTALL_STATIC_HOSTING_TEST
```

도구가 수행하는 작업은 다음과 같습니다.

- Nginx, Certbot Nginx 플러그인, Python 3, UFW, 인증서·통신 도구 설치
- `/var/www/hanstone` 릴리스·매니페스트 디렉터리 생성
- 배포 검증 보고서를 위한 `/var/log/hanstone` 생성
- HTTP 단계 Nginx 설정 설치 및 문법 검사
- 현재 SSH 포트를 먼저 허용한 후 HTTP 80·HTTPS 443 포트 허용
- Nginx 시작과 UFW 활성화

Ubuntu 전체 업그레이드, SSH 설정 변경, 인증서 발급, 홈페이지 설치는 자동으로 수행하지
않습니다. 기존 Nginx 대상 파일의 내용이 다르면 덮어쓰지 않고
`STATIC_BOOTSTRAP_CONFIG_CONFLICT`로 중단합니다.

## 5. 홈페이지와 인증서 설치

부트스트랩 성공 후 다음 순서로 진행합니다.

1. `HOSTING_INSTALL.md`에 따라 정적 릴리스를 설치합니다.
2. 도메인 A 레코드가 서버 공인 IP를 가리키는지 확인합니다.
3. `nginx/README.md`에 따라 인증서만 발급하고 HTTPS 설정을 적용합니다.
4. `HOSTING_VERIFY.md`로 실제 HTTPS 응답을 검증합니다.
5. `HOSTING_READINESS.md`의 `static` 모드가 `READY`인지 확인합니다.

## 6. 중단되었을 때

패키지 설치 중 연결이 끊기면 호스팅 웹 콘솔로 접속해 다음을 확인합니다.

```bash
sudo ufw status verbose
sudo nginx -t
sudo systemctl status nginx --no-pager
```

SSH 포트·80·443 허용 규칙을 임의로 삭제하지 말고 현재 상태를 기록한 뒤 원인을 확인합니다.
부트스트랩 도구는 기존 설정을 덮어쓰지 않으므로 충돌 오류가 발생하면 해당 파일을 먼저
백업하고 관리자 검토 후 처리합니다.
