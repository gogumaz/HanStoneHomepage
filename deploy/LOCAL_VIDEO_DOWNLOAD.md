# 로컬 MP4 다운로드 재생 운영

현재 운영 단계에서는 AWS S3와 HLS 스트리밍을 사용하지 않습니다. API가 무료 샘플·활성 구독·
운영자 권한을 확인한 뒤 MP4 전체를 브라우저로 내려주고, 브라우저는 메모리의 Blob URL로
재생합니다. 직접 공개 URL은 제공하지 않습니다.

## 제한

- 기본 영상 한도는 256MB입니다. 브라우저가 전체 파일을 받은 뒤 재생하므로 긴 영상은 분할하거나
  해상도·비트레이트를 낮춥니다.
- 재생을 시작할 때까지 다운로드 시간이 필요합니다.
- S3 관리자 업로드, HLS 변환, CDN, 영상 검사 워커는 비활성화됩니다.
- 게시판 글쓰기는 계속 사용할 수 있지만 파일 첨부·강의자료 업로드는 객체 저장소 고도화 전까지
  제공하지 않습니다.
- 서버 디스크 장애에 대비해 원본 MP4는 운영자 PC 또는 별도 백업 매체에도 보관합니다.

## 자동 백업과 용량 감시

다음 도구는 동일한 영상을 내용 해시로 한 번만 저장하는 증분 백업과 시간별 상태 점검을
systemd 타이머로 설치합니다. 기본 백업 위치는
`/var/backups/hanstone/local-videos`이며 운영 영상 디렉터리와 겹치는 경로는 거부합니다.

```bash
sudo ./deploy/configure-local-video-maintenance.sh
sudo ./deploy/configure-local-video-maintenance.sh \
  --apply --confirm CONFIGURE_LOCAL_VIDEO_MAINTENANCE
systemctl list-timers 'hanstone-local-video-*'
```

백업은 매일 03:20(Asia/Seoul), 상태 점검은 매시간 실행됩니다. 디스크 여유 공간이 기본
5GiB 이하면 `attention`, 1GiB 이하면 `critical`입니다. 같은 정보는 운영자 화면과 보호된
Prometheus 지표 `baduk_local_video_*`에서도 확인할 수 있습니다. 영상 설치 도구는 백업
서비스가 설치되어 있으면 설치 직후 증분 백업을 요청합니다.

최신 백업을 전체 해시 검증하거나 복원하려면 다음 순서를 사용합니다. 복원은 기본적으로
dry-run이며, 적용하더라도 백업에 없는 현재 파일은 삭제하지 않습니다.

```bash
sudo python3 /usr/local/lib/hanstone/local-video-maintenance.py verify
sudo python3 /usr/local/lib/hanstone/local-video-maintenance.py restore
sudo python3 /usr/local/lib/hanstone/local-video-maintenance.py restore \
  --apply --confirm RESTORE_LOCAL_LESSON_VIDEOS
```

현재 백업 디렉터리는 운영 서버의 같은 디스크에 있으므로 운영자 실수나 파일 손상 복구에는
유효하지만 디스크 자체 고장에는 충분하지 않습니다. 원본을 운영자 PC 또는 분리된 저장장치에
함께 보관하고, 서비스 고도화 시 외부 객체 저장소의 버전 관리로 교체합니다.

## 영상 파일 배치

영상 파일명은 강의 ID와 정확히 같아야 합니다. 예를 들어 `PRE-01` 강의는 `PRE-01.mp4`입니다.
먼저 SFTP/SCP로 서버의 임시 경로에 전송하고, 설치 도구를 dry-run 후 적용합니다.

```bash
sudo ./deploy/install-local-video.sh --lesson-id PRE-01 --source /tmp/PRE-01.mp4
sudo ./deploy/install-local-video.sh --lesson-id PRE-01 --source /tmp/PRE-01.mp4 \
  --apply --confirm INSTALL_LOCAL_LESSON_VIDEO
```

도구는 강의 ID, 일반 파일 여부, 256MB 한도와 MP4 `ftyp` 시그니처를 확인한 뒤
`/var/www/hanstone/media/lessons/PRE-01.mp4`로 원자적으로 교체합니다. 설치가 끝나면 임시
업로드 파일을 삭제합니다.

## 배포

현재 전환용 Compose에는 다음 오버레이를 사용합니다.

```bash
docker compose \
  -f /opt/hanstone/compose.yaml \
  -f /opt/hanstone/deploy/compose.transition.local-download.yaml \
  up -d --remove-orphans api account-mail-worker inquiry-notification-worker assignment-reminder-worker
docker rm -f hanstone-clamav-compact-1 2>/dev/null || true
```

표준 운영 Compose와 2GB 제한을 함께 적용할 때는 다음 세 파일을 사용합니다.

```bash
docker compose --env-file deploy/production.env \
  -f deploy/compose.production.yaml \
  -f deploy/compose.production.compact.yaml \
  -f deploy/compose.production.local-download.yaml \
  up -d --remove-orphans
```

API 컨테이너에는 호스트 영상 디렉터리가 `/var/lib/hanstone/media/lessons`로 읽기 전용
마운트됩니다. `managed-media` 프로필을 지정하지 않으면 ClamAV·영상 검사·HLS 변환·객체 삭제
워커가 시작되지 않습니다.

## 확인

1. 강의 CMS에서 해당 강의가 `영상 연결 완료`로 표시되는지 확인합니다.
2. 무료 샘플 또는 테스트 구독 계정으로 재생 권한을 확인합니다.
3. `강의 영상을 내려받고 있습니다` 이후 영상이 재생되는지 확인합니다.
4. 구독이 없는 계정의 유료 강의 요청이 `403`인지 확인합니다.
5. 운영 프리플라이트에서 `objectStorage`, `cdn`, `hlsTranscoder`, `malwareScanner`가
   local-download 비활성 판정으로 `pass`인지 확인합니다.

## 향후 스트리밍 전환

영상량과 동시 접속이 늘면 `MEDIA_DELIVERY_MODE=object-storage`로 바꾸고 비공개 S3,
ClamAV 검사, HLS 변환, CloudFront 서명 URL을 순서대로 활성화합니다. 기존
[`AWS_OBJECT_STORAGE.md`](./AWS_OBJECT_STORAGE.md)는 그때 적용합니다.
