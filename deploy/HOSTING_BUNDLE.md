# 서버 배포 패키지 생성

`bundle:hosting`은 검증된 정적 웹과 서버 설정 파일을 하나의 `.tgz`로 묶고 SHA-256
체크섬을 생성합니다. 실제 비밀번호나 운영 환경 파일은 포함하지 않습니다.

## 사전 조건

패키지는 다음 조건을 모두 만족할 때만 생성됩니다.

1. Git 작업트리가 깨끗하고 모든 배포 변경이 커밋돼 있습니다.
2. 현재 `HEAD`로 웹을 빌드했습니다.
3. `dist/web-deployment-manifest.json`의 커밋과 파일 해시가 실제 `dist/`와 일치합니다.
4. 필요한 Compose·Nginx·점검 파일이 모두 존재합니다.
5. 사용자 지정 출력 파일은 아직 존재하지 않아야 합니다. 기본 이름의 기존 패키지는 현재
   커밋·웹 매니페스트·체크섬이 모두 일치할 때만 덮어쓰지 않고 재사용합니다.

## 생성 방법

Windows PowerShell의 프로젝트 루트에서 실행합니다.

```powershell
npm ci
$env:WEB_RELEASE_COMMIT_SHA = (git rev-parse HEAD).Trim()
npm run build:web
npm run verify:web-artifacts
npm run manifest:web-deployment
npm run bundle:hosting
```

`artifacts/`에 다음 두 파일이 생성됩니다.

```text
hanstone-hosting-{커밋 앞 12자리}.tgz
hanstone-hosting-{커밋 앞 12자리}.tgz.sha256
```

같은 커밋에서 명령을 다시 실행하면 기존 기본 번들의 체크섬과 내부 매니페스트를 검증한 뒤
`"reused":true`로 성공합니다. 웹 매니페스트를 다시 만들어 생성 시각만 달라진 경우에도
커밋·파일 해시·크기·Content-Type·Cache-Control이 모두 같으면 기존 번들을 재사용합니다.
파일이 손상됐거나 TGZ와 체크섬 중 하나만 남아 있으면 안전을 위해
`HOSTING_BUNDLE_EXISTING_INVALID`로 중단합니다.

패키지 이름을 지정하려면 `artifacts/` 아래의 새 `.tgz` 경로만 사용할 수 있습니다.

```powershell
npm run bundle:hosting -- --output artifacts/hanstone-hosting-release-001.tgz
```

## 포함되는 항목

- `web/`: 검증된 `dist/` 전체와 웹 배포 매니페스트
- `deploy/compose.production.yaml`
- `deploy/production.env.example`: 자리표시자 템플릿만 포함
- `deploy/nginx/`: HTTP 부트스트랩·HTTPS·프록시·보안 헤더·캐시 설정
- `deploy/check-host-readiness.sh`
- `DEPLOYMENT_BUNDLE_MANIFEST.json`: 모든 포함 파일의 크기와 SHA-256

다음 항목은 포함되지 않습니다.

- 실제 `/etc/hanstone/production.env`
- `.env`, `.env.local`, 인증서, 개인키, SSH 키
- Git 저장소와 소스 코드
- `node_modules`, 테스트 결과, 로컬 보고서

## 서버 전송과 검증

```powershell
scp .\artifacts\hanstone-hosting-커밋.tgz* hanstone@SERVER_IP:/tmp/
```

서버에서 체크섬을 먼저 확인한 후 압축을 풉니다.

```bash
cd /tmp
sha256sum -c hanstone-hosting-커밋.tgz.sha256
tar -xzf hanstone-hosting-커밋.tgz
cd hanstone-hosting
```

`sha256sum` 결과가 `OK`가 아니면 압축을 풀거나 설치하지 말고 파일을 다시 전송합니다.
신규 서버라면 압축 해제 후 `deploy/HOSTING_BOOTSTRAP.md`의 읽기 전용 계획과 승인형 최소
설치를 먼저 진행합니다. 이어 `deploy/HOSTING_INSTALL.md`로 패키지 내부 해시를 다시 검사하고
릴리스 디렉터리와 `current` 심볼릭 링크를 전환합니다. 마지막으로
`deploy/nginx/README.md`, `deploy/HOSTING_VERIFY.md`, `deploy/HOSTING_READINESS.md` 순서로
인증서·실제 응답·준비상태를 확인합니다.
