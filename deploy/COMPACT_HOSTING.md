# 2GB 운영 프로필

PHPS 2GB 서버에서는 `deploy/compose.production.yaml`에
`deploy/compose.production.compact.yaml`을 겹쳐서 사용합니다. 악성코드 검사를 끄지 않고
ClamAV와 애플리케이션의 동시 메모리 사용량을 제한하는 구성입니다.

## 고정 제약

- 물리 메모리 1900MiB 이상과 스왑 4GiB가 필요합니다.
- 영상 한 건의 최대 크기는 256MiB입니다.
- ClamAV는 최대 스레드 1개, 대기열 2개, 1250MiB 메모리 상한으로 실행합니다.
- ClamAV 시그니처 재적재 시 구·신 DB를 동시에 들고 있지 않습니다.
- 메일·문의·과제·정리·영상 검사·HLS 변환은 API 이미지의 단일
  `compact-operations-worker`에서 실행합니다.
- 악성코드 검사와 HLS 변환은 같은 시점에 실행하지 않습니다. FFmpeg도 1개 스레드만
  사용하므로 영상 게시까지 시간이 더 걸릴 수 있습니다.
- ClamAV 3310 포트는 호스트에 게시하지 않습니다.

## 배포

```bash
sudo install -d -m 0755 /opt/hanstone/deploy
sudo install -m 0644 deploy/compose.production.yaml /opt/hanstone/deploy/
sudo install -m 0644 deploy/compose.production.compact.yaml /opt/hanstone/deploy/

sudo docker compose \
  --env-file /etc/hanstone/production.env \
  -f /opt/hanstone/deploy/compose.production.yaml \
  -f /opt/hanstone/deploy/compose.production.compact.yaml \
  config --quiet

sudo docker compose \
  --env-file /etc/hanstone/production.env \
  -f /opt/hanstone/deploy/compose.production.yaml \
  -f /opt/hanstone/deploy/compose.production.compact.yaml \
  up -d --remove-orphans
```

`dedicated-workers` 프로필을 함께 활성화하면 같은 작업이 중복 실행되고 메모리 예산을
넘길 수 있으므로 사용하지 않습니다.

아직 `/opt/hanstone/compose.yaml` 전환 구성을 사용하는 서버에는
`compose.transition.compact.yaml`을 세 번째 Compose 파일로 적용합니다. 이 오버레이는
ClamAV와 API 연결만 먼저 활성화하고 객체 저장소가 준비되지 않은 미디어 워커는 시작하지
않습니다.

## 검증

```bash
sudo bash /opt/hanstone/deploy/check-host-readiness.sh \
  --mode full \
  --resource-profile compact \
  --domain handol-edu.com \
  --expected-ip 115.71.237.165 \
  --api-base-url https://handol-edu.com

sudo docker stats --no-stream
free -m
curl -fsS https://handol-edu.com/api/v1/health/ready
```

정상 유휴 상태 기준 ClamAV는 약 1GB를 사용할 수 있습니다. `MemAvailable`이 200MiB 아래로
유지되거나 스왑 사용량이 3.5GiB를 넘으면 신규 영상 업로드를 일시 중지하고 원인을
확인합니다. 컨테이너 OOM 여부는 다음 명령으로 확인합니다.

```bash
sudo docker inspect \
  --format '{{.Name}} oom={{.State.OOMKilled}} restart={{.RestartCount}}' \
  $(sudo docker ps -q)
```
