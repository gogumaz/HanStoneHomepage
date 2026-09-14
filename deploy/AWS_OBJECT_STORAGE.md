# AWS S3 객체 저장소 운영 설정

> 현재 운영은 [`LOCAL_VIDEO_DOWNLOAD.md`](./LOCAL_VIDEO_DOWNLOAD.md)의 로컬 MP4 다운로드
> 재생을 사용합니다. 이 문서는 향후 스트리밍 고도화 시 적용하며 지금은 AWS 리소스를
> 생성하지 않습니다.

운영 미디어는 서울 리전(`ap-northeast-2`)의 별도 비공개 S3 버킷을 사용합니다. 템플릿은
버킷 이름을 AWS가 생성하도록 하며 버전 관리, 기본 암호화, 모든 공개 접근 차단, HTTPS
강제, 운영 도메인 CORS, 비현재 버전 보존과 애플리케이션 최소 권한 IAM 사용자를 함께
생성합니다. 스택을 삭제해도 버킷과 데이터는 보존됩니다.

## 1. AWS 계정에서 스택 생성

AWS 콘솔에 로그인한 뒤 서울 리전의 CloudShell에서 저장소를 내려받아 다음 명령을
실행합니다.

```bash
chmod +x deploy/provision-aws-object-storage.sh
./deploy/provision-aws-object-storage.sh \
  --region ap-northeast-2 \
  --stack-name hanstone-production-media \
  --confirm CREATE_HANSTONE_STORAGE
```

처음 버전 관리를 활성화한 뒤에는 AWS 권고에 따라 15분을 기다린 후 쓰기 검증을
실행합니다.

## 2. 런타임 자격증명 생성

CloudFormation 출력의 `RuntimeUserName`에서 액세스 키를 정확히 하나만 생성합니다. 루트
사용자 키는 사용하지 않습니다. Secret Access Key는 생성 시 한 번만 확인할 수 있으므로
비밀번호 관리자에 보관하고 채팅·Git·작업 로그에 넣지 않습니다.

PHPS의 현재 전환 환경 `/opt/hanstone/.env`에는 다음 값을 추가합니다.

```dotenv
OBJECT_STORAGE_REGION=ap-northeast-2
OBJECT_STORAGE_BUCKET=<CloudFormation BucketName 출력>
OBJECT_STORAGE_ACCESS_KEY_ID=<IAM 사용자 Access Key ID>
OBJECT_STORAGE_SECRET_ACCESS_KEY=<IAM 사용자 Secret Access Key>
OBJECT_STORAGE_FORCE_PATH_STYLE=false
OBJECT_STORAGE_VERSIONING_ENABLED=true
```

AWS 기본 S3 endpoint를 사용하므로 `OBJECT_STORAGE_ENDPOINT`는 비워 둡니다. 환경 파일은
root 소유, 권한 `0600`을 유지합니다.

## 3. 재기동과 검증

```bash
cd /opt/hanstone
docker compose \
  -f compose.yaml \
  -f compose.override.yaml \
  -f compose.compact.yaml \
  up -d --no-build api

docker exec hanstone-api-1 node dist/production-preflight.js
```

프리플라이트의 `objectStorage`가 `pass`여야 합니다. 검증은 버전 관리 상태를 실제 조회하고,
임시 객체 쓰기·서명 읽기·삭제와 무서명 공개 접근 차단을 확인합니다. 버킷 정책이나 IAM을
수동으로 완화해서 통과시키지 않습니다.

## 4. 키 운영

- 액세스 키는 90일 이내 주기로 교체합니다.
- 새 키 적용과 프리플라이트 성공 후에만 이전 키를 비활성화·삭제합니다.
- CloudTrail과 IAM Access Analyzer로 사용하지 않는 권한 및 비정상 접근을 확인합니다.
- 비현재 객체는 최소 90일과 최신 3개 버전을 보존합니다.
