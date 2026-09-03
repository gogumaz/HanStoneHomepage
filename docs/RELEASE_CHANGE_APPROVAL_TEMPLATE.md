# 운영 릴리스 변경승인 기록 양식

이 문서는 실제 후보 릴리스마다 복제해 접근 통제된 변경승인 시스템에서 작성합니다. Secret, 토큰, 비밀번호, 환경 파일 원문, 사용자 데이터는 기록하지 않습니다. 각 항목은 실제 artifact와 공급자·배포 콘솔을 확인한 승인자가 작성하며, 빈칸이나 실패 항목이 있으면 출시를 승인하지 않습니다.

## 1. 후보 식별

- 릴리스 ID:
- 후보 커밋 SHA(소문자 40자리):
- 불변 API 이미지(`repository@sha256:<64자리>`):
- 웹 배포 매니페스트 SHA-256:
- 배포 예정 시각(ISO 8601):
- 변경 요청자:
- 배포 실행자:
- 1인 운영자 GitHub ID:

## 2. 출시 전 필수 승인

| 게이트 | 증적 또는 확인값 | 확인자 | 결과 |
|---|---|---|---|
| Release readiness audit | run ID, `ok: true` |  | 대기 |
| 운영 환경 승인 규칙 | 지정 운영자, 승인자 0명, `main` 단일 정책, 확인 문자열 |  | 대기 |
| 법무 최종 승인 | `legal-approval-binding.json`의 후보·정책·승인일·문서 SHA-256·7개 통과 판정·세 원본 artifact SHA-256 |  | 대기 |
| SMTP 도메인 인증 | `mail-operations-evidence.json`의 후보 SHA·DNS 레코드 집합 SHA-256·DMARC 정책 |  | 대기 |
| SMTP 반송 처리 | 비식별 event ID SHA-256·영구 반송 감사기록 ID·9개 통과 판정·원본 artifact SHA-256 |  | 대기 |
| 운영 HTTPS | `transport-security-evidence.json` 스키마 2의 후보 SHA·18개 통과 판정·API/웹 TLS 버전·인증서 SHA-256·유효기간·원본 artifact SHA-256 |  | 대기 |

법무 승인 메타데이터는 현재 정책 버전 `guardian-link-v1`과 일치해야 합니다. 운영 환경 파일 원문이나 `LEGAL_POLICY_APPROVAL_SHA256` 값 자체를 이 문서에 복제하지 않고, 승인 원본과 배포 설정의 해시가 일치하는지만 기록합니다.

## 3. 후보 인수의 일곱 원본 증빙

| 증빙 | workflow run ID | artifact 이름 | 원본 SHA-256 | 생성 시각 | 결과 |
|---|---:|---|---|---|---|
| 운영 프리플라이트 |  |  |  |  | 대기 |
| 격리 복구훈련 |  |  |  |  | 대기 |
| 스테이징 읽기 전용 부하 |  |  |  |  | 대기 |
| 스테이징 워커 soak·동시 제어 부하 |  |  |  |  | 대기 |
| 웹 배포 매니페스트 |  |  |  |  | 대기 |
| 현장 브라우저 검증 |  |  |  |  | 대기 |
| 공급망·SBOM |  |  |  |  | 대기 |

- Release candidate acceptance run ID:
- `release-acceptance.json` artifact 이름:
- `staging-evidence-bundle.json` SHA-256:
- `manifestSha256`:
- 90일 보관 만료 예정일:
- 일곱 증빙 후보 커밋 일치 확인자:

## 4. 실제 배포와 사후 검증

- 운영 배포 작업 ID:
- 배포 완료 시각(ISO 8601):
- Production deployment verification run ID:
- 검증된 API 커밋 SHA:
- 검증된 API 이미지 digest:
- 검증된 웹 매니페스트 SHA-256:
- liveness·readiness 표본 수:
- 전체 p95:
- `rollbackRecommended`: 반드시 `false`
- 검증 artifact 이름 및 90일 보관 만료 예정일:

## 5. 최종 종료 기록

- Release closeout run ID:
- `release-closeout.json` artifact 이름:
- closeout의 스테이징 증빙 번들 SHA-256:
- `closeoutSha256`:
- 인수 후 24시간 이내 검증·종료 여부:
- 후보 커밋·이미지·웹 매니페스트 동일성 확인자:
- 90일 보관 만료 예정일:

## 6. 직전 정상 버전과 롤백 훈련

- 직전 정상 `release-closeout.json` 위치:
- 직전 정상 API 이미지:
- 직전 정상 웹 매니페스트 SHA-256:
- 비운영 롤백 훈련 환경:
- `release-rollback-plan.json`의 `rollbackPlanSha256`:
- `rollback-rehearsal-evidence.json`의 `evidenceSha256`:
- API·전체 워커·웹 동시 교체 작업 ID:
- 롤백 후 Production deployment verification run ID:
- forward-only DB 호환성 확인자:
- 훈련 결과 및 후속 조치:

## 7. 최종 판정

- [ ] 모든 필수 게이트와 일곱 증빙이 같은 후보 커밋에 결합됨
- [ ] 운영 배포 검증의 `rollbackRecommended`가 `false`임
- [ ] `release-closeout.json`과 원본 artifact의 90일 보관이 설정됨
- [ ] 직전 정상 closeout과 비운영 롤백 훈련 증적이 보관됨
- [ ] 조건부 승인이나 미해결 고위험 항목이 없음

- 최종 판정: 승인 / 반려
- 최종 승인자:
- 승인 시각(ISO 8601):
- 비고:
