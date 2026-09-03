# 호스팅 준비 상태 자동 점검

`check-host-readiness.sh`는 설치 매뉴얼을 따라 설정한 Ubuntu 서버를 **변경하지 않고**
배포 준비 상태만 확인합니다. 패키지 설치, 방화벽 변경, 서비스 시작, 컨테이너 기동을
수행하지 않습니다.

## 서버로 전송

Windows PowerShell에서 프로젝트 루트로 이동한 뒤 실행합니다.

```powershell
scp .\deploy\check-host-readiness.sh hanstone@SERVER_IP:/tmp/
```

SSH 포트가 22가 아니면 다음처럼 `-P`를 추가합니다.

```powershell
scp -P SSH_PORT .\deploy\check-host-readiness.sh hanstone@SERVER_IP:/tmp/
```

## 단계별 실행

서버에 SSH로 접속한 뒤 실행 권한을 부여합니다.

```bash
chmod 700 /tmp/check-host-readiness.sh
```

공인 IP를 발급받은 실제 값으로 바꾸어 입력합니다.

```bash
# 1. OS·메모리·디스크·DNS·방화벽 기초 점검
/tmp/check-host-readiness.sh --mode base --expected-ip SERVER_IP

# 2. 정적 홈페이지와 HTTPS까지 설치한 뒤
/tmp/check-host-readiness.sh --mode static --expected-ip SERVER_IP

# 3. Docker API까지 배포한 뒤
/tmp/check-host-readiness.sh --mode full --expected-ip SERVER_IP
```

PHPS Ubuntu 20.04 정적 테스트 서버는 ESM 활성화 후 다음처럼 명시적으로 실행합니다.

```bash
/tmp/check-host-readiness.sh --mode static --allow-ubuntu-20-test \
  --expected-ip 115.71.237.88 --ssh-port 22
```

이 예외에서는 `--mode full`을 사용할 수 없습니다.

호스팅사가 다른 SSH 포트를 제공했다면 모든 실행에 `--ssh-port SSH_PORT`를 추가합니다.
다른 도메인이나 API 주소를 사용할 때는 각각 `--domain`, `--api-base-url`로 지정합니다.

## 결과 판정

- `[PASS]`: 확인 항목이 기준을 충족합니다.
- `[WARN]`: 배포를 자동 차단하지는 않지만 운영 전에 확인해야 합니다.
- `[FAIL]`: 배포 전 반드시 해결해야 합니다.
- `Result: READY`: FAIL이 없습니다. WARN을 검토한 뒤 다음 단계로 진행합니다.
- `Result: NOT READY`: 하나 이상의 FAIL이 있습니다. 종료 코드도 `1`입니다.

스왑 검사는 Linux가 스왑 헤더로 사용하는 작은 영역을 제외하고 보고하는 점을 고려해,
1GiB로 생성한 파티션에서 발생하는 몇 KiB의 정상적인 차이를 허용합니다.

결과를 파일로 보관하려면 다음처럼 실행합니다. 보고서에는 비밀번호·토큰·환경변수
원문을 출력하지 않습니다.

```bash
/tmp/check-host-readiness.sh --mode full --expected-ip SERVER_IP \
  | tee "host-readiness-$(date +%Y%m%d-%H%M%S).txt"
```

## 이 호스팅에서 예상되는 최초 판정

신청 화면의 Ubuntu 20.04와 메모리 512MB를 그대로 사용하면 `full` 점검은 FAIL입니다.

- Ubuntu Pro의 `esm-infra`와 `esm-apps`를 모두 활성화합니다.
- `--allow-ubuntu-20-test`를 지정한 `base` 또는 `static` 모드만 사용합니다.
- 전체 API 운영은 메모리를 최소 2GB, 권장 4GB로 증설합니다.
- 512MB를 유지하면 `static` 모드까지만 사용하고 API·DB·Redis·영상 워커는 외부로
  분리합니다.
- 서버 IP가 발급되기 전에는 `--expected-ip` 비교를 완료할 수 없습니다.

상세 설치 순서는 `../docs/UZDREAM_PHPS_HOSTING_TEST_MANUAL.md`를 따릅니다.
