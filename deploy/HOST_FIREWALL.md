# 운영 호스트 방화벽 설정

`configure-host-firewall.sh`는 현재 SSH·HTTP·HTTPS 리스너를 먼저 검증하고, SSH 허용
규칙을 다른 정책보다 먼저 등록한 뒤 UFW를 활성화합니다. 기본 실행은 읽기 전용입니다.

## 1. 변경 전 계획 확인

현재 접속에 사용하는 SSH 포트를 지정합니다.

```bash
bash deploy/configure-host-firewall.sh --ssh-port 22
```

SSH 서비스와 지정 포트, Nginx, 80·443 리스너 중 하나라도 확인되지 않으면 중단됩니다.

## 2. 적용

SSH 세션을 하나 더 열어 둔 상태에서 다음 명령을 실행합니다.

```bash
sudo bash deploy/configure-host-firewall.sh \
  --apply \
  --ssh-port 22 \
  --confirm ACTIVATE_HOST_FIREWALL
```

스크립트는 `/etc/ufw/user.rules`와 `user6.rules`를
`/var/backups/hanstone-firewall/<UTC시각>-<PID>/`에 보관합니다. 적용이나 검증이 실패하면
두 파일과 기존 UFW 활성 상태를 복원합니다. `ufw reset`은 실행하지 않습니다.

허용되는 인바운드 포트는 다음과 같습니다.

- 현재 검증된 SSH 포트
- HTTP `80/tcp`
- HTTPS `443/tcp`

PostgreSQL `5432`, Redis `6379`, API `3000`, ClamAV `3310`은 공개 허용하지 않습니다.

## 3. 적용 후 확인

기존 세션을 닫기 전에 새 터미널에서 SSH 재접속과 공개 HTTPS를 확인합니다.

```bash
ufw status verbose
ss -ltn
curl -fsS https://handol-edu.com/api/v1/health/ready
```

이 도구는 호스팅 업체의 별도 보안그룹이나 네트워크 방화벽은 변경하지 않습니다.
