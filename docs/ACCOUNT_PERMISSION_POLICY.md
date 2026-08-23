# 계정·보호자·지도자·기관 권한 정책

기준일: 2026-08-21

## 1. 권한 설계 원칙

사용자 권한은 다음 네 요소를 분리해 계산합니다.

1. `Role`: 학생·보호자·지도자·기관 관리자·운영자·관리자 역할
2. `OrganizationMembership`: 사용자가 어느 기관에 어떤 상태로 소속되었는지
3. `Entitlement`: 개인 구독 또는 기관 라이선스로 어떤 콘텐츠를 이용할 수 있는지
4. `ResourceScope`: 본인, 연결 학생, 담당 반, 소속 기관 등 데이터 접근 범위

한 개의 `role` 값이나 `isTeacher` 플래그로 네 요소를 대신하지 않습니다. 한 계정은 필요한 경우 여러 역할을 가질 수 있지만 활성 화면과 서버 요청마다 사용할 역할과 리소스 범위를 명확히 선택합니다.

## 2. 역할별 권한

| 역할 | 허용 범위 | 제한 |
|---|---|---|
| 학생 | 본인 강의·미션·퀴즈·진도·오답·보상, 보호자 초대 시작 | 다른 학생·지도자 자료·CMS 접근 금지 |
| 보호자 | 연결 완료된 학생의 리포트, 구독 결제, 동의·연결 관리 | 미연결 학생과 기관 전체 데이터 접근 금지 |
| 인증 지도자 | 수업 패키지 열람·다운로드, 담당 반 과제·결과 | 강의·문제 CMS 업로드 및 기관 결제 관리 금지 |
| 기관 관리자 | 기관 멤버·좌석·라이선스·반 배정 관리 | 운영자·전체 서비스 관리 권한 없음 |
| 운영자 | 강의·문제·수업도우미·게시판 콘텐츠 운영 | 관리자 계정과 최고 권한 관리 금지 |
| 관리자 | 전체 권한·운영자 승인·감사 조회 | 모든 작업 감사기록 필수 |

지도자 자료는 자기신고 역할만으로 제공하지 않습니다. 운영자 승인 또는 기관 관리자의 초대를 거친 `verified_teacher` 상태가 필요합니다.

## 3. 학생이 보호자를 추가하는 흐름

학생이 보호자 연결을 시작합니다. 학생의 입력만으로 보호자 또는 법정대리인 관계가 확정되지는 않습니다.

```text
학생이 보호자 이메일·휴대전화 입력
  → GuardianInvitation(pending) 생성
  → 일회성 초대 링크 발송
  → 보호자가 본인 계정 로그인 또는 가입
  → 연결 대상 학생과 조회 범위 확인
  → 필요한 법정대리인 본인확인·동의
  → 동의 기록 저장
  → GuardianLink(active)와 GuardianConsent 생성
```

- `pending` 상태의 보호자는 학생 정보에 접근할 수 없습니다.
- 초대 토큰은 일회용·만료형으로 저장하며 원문을 DB에 보관하지 않습니다.
- 학생이 임의로 입력한 성인의 동의만으로 법정대리인 관계가 항상 증명되는 것은 아니므로 최종 확인 수준은 법무 검토를 거칩니다.
- 연결 해제와 동의 철회 시 보호자의 조회 권한을 즉시 회수합니다.

## 4. 지도자와 기관 라이선스

지도자 역할은 신분, 기관 소속은 업무 범위, 구독·라이선스는 콘텐츠 이용권입니다.

| 상황 | 처리 원칙 |
|---|---|
| 인증 지도자 + 개인 구독 | 개인 강의와 지도자 자료 이용 가능 |
| 인증 지도자 + 활성 기관 라이선스 | 배정 좌석 범위에서 수업용 강의·미션·자료 이용 가능 |
| 개인 구독과 기관 라이선스 모두 활성 | 둘 중 하나가 유효하면 콘텐츠 이용, 기관 데이터는 멤버십·담당 반을 추가 검사 |
| 기관 라이선스 만료 + 개인 구독 활성 | 개인 강의는 유지, 기관 반·학생·기관 전용 자료는 차단 |
| 기관 퇴사·멤버십 해지 | 기관 데이터와 라이선스 권한 즉시 회수, 개인 계정·구독 유지 |
| 여러 기관 소속 | 기관별 멤버십·라이선스·담당 반을 독립 저장 |

권장 판정식은 다음과 같습니다.

```text
canUseTeachingContent = verifiedTeacher
  AND (activePersonalEntitlement OR activeOrganizationEntitlement)

canViewClassStudent = activeOrganizationMembership
  AND assignedClass
  AND requestedStudentBelongsToAssignedClass
```

일반 지도자는 기관 라이선스 구매·좌석 변경·환불을 처리하지 않습니다. 해당 권한은 `organization_admin`에게만 부여합니다.

## 5. 권장 데이터 모델

```text
User
├─ id, status, birthDateOrAgeBand
└─ createdAt, updatedAt

UserRole
├─ userId
├─ role: student | guardian | teacher | organization_admin | operator | admin
├─ verificationStatus
└─ verifiedAt, verifiedBy

GuardianInvitation
├─ id, studentId, inviteeEmail
├─ status: pending | accepted | expired | revoked
├─ tokenHash, expiresAt
└─ createdAt, acceptedAt

GuardianLink
├─ id, studentId, guardianId
├─ status: active | revoked
└─ consentVersion, consentedAt, revokedAt

OrganizationMembership
├─ organizationId, userId
├─ role: teacher | organization_admin
├─ status, startsAt, endsAt
└─ createdBy

Entitlement
├─ subjectType: user | organization
├─ subjectId, resourceScope
├─ source: personal_subscription | organization_license | free_sample
└─ startsAt, endsAt, status

ClassAssignment
├─ classId, teacherMembershipId
└─ startsAt, endsAt

GuardianConsent
├─ studentId, guardianId
├─ consentType, policyVersion, scope
├─ verificationMethod, status
├─ requestedAt, consentedAt, withdrawnAt
└─ auditMetadata
```

## 6. 미성년자·법정대리인 동의

- 만 14세 미만 아동의 개인정보 처리에 동의가 필요한 경우 법정대리인 동의와 동의 여부 확인을 수행합니다.
- 만 14세 미만 사용자에게는 이해하기 쉬운 양식과 명확한 언어로 고지합니다.
- 법정대리인 동의를 받기 전에는 동의를 요청하는 데 필요한 최소 정보만 처리합니다.
- 만 19세 미만의 유료 구독은 법정대리인 동의 또는 보호자가 직접 결제하는 흐름을 기본값으로 합니다.
- 학생 계정의 보호자 연결, 개인정보 동의, 유료 계약 동의, 학습정보 조회 동의는 서로 다른 상태와 기록으로 관리합니다.
- 선택적 마케팅, 사진·영상 공개, 지도자·기관 제공 동의는 필수 동의와 분리합니다.

법정대리인 동의 확인 방법은 사이트 동의 후 문자 통지, 카드 확인, 휴대전화 본인확인, 서면·이메일·전화 등 관련 법령이 허용하는 방식 중 서비스에 맞는 수단을 선택합니다.

관련 기준:

- 개인정보 보호법 제22조의2: <https://www.law.go.kr/lsLinkCommonInfo.do?chrClsCd=010202&lsJoLnkSeq=1029334761>
- 개인정보 보호법 시행령 제17조의2: <https://www.law.go.kr/lsInfoP.do?lsiSeq=254693&viewCls=lsRvsDocInfoR>
- 민법 제5조: <https://www.law.go.kr/LSW/lsLinkCommonInfo.do?chrClsCd=010202&lsJoLnkSeq=1026990807>

운영 전 이용약관·개인정보처리방침·보호자 동의 화면과 보유기간은 개인정보·전자상거래 법률 검토를 완료해야 합니다.

## 7. 제안 API

| 메서드 | 경로 | 권한·용도 |
|---|---|---|
| `POST` | `/me/guardian-invitations` | 학생이 보호자 초대 생성 |
| `GET` | `/guardian-invitations/{token}` | 보호자가 초대 대상과 동의 범위 확인 |
| `POST` | `/guardian-invitations/{token}/accept` | 보호자 본인확인·동의 후 연결 |
| `POST` | `/me/guardian-links/{linkId}/revoke` | 학생 또는 보호자가 연결 해제 요청 |
| `GET` | `/guardians/me/students` | 연결 완료된 학생 목록 |
| `GET` | `/guardians/me/students/{studentId}/report` | 연결 학생 리포트 |
| `POST` | `/organizations/{organizationId}/members` | 기관 관리자가 지도자 초대 |
| `PATCH` | `/organizations/{organizationId}/members/{memberId}` | 기관 멤버십 상태·역할 변경 |
| `GET` | `/me/entitlements` | 개인·기관 이용권과 유효기간 조회 |

## 8. 완료 기준

- 학생이 시작하고 보호자가 수락하기 전까지 링크가 `pending`입니다.
- 미완료 초대만으로 보호자에게 학습정보가 노출되지 않습니다.
- 지도자는 인증 상태, 기관 멤버십, 담당 반을 모두 검사받습니다.
- 기관 라이선스 만료나 퇴사 시 기관 범위 권한이 즉시 회수됩니다.
- 개인 구독과 기관 라이선스가 동시에 있어도 주문·진도·기관 데이터 소유권이 섞이지 않습니다.
- 보호자 동의의 버전·범위·확인방법·시각·철회 이력이 감사 가능하게 저장됩니다.
- 리포트 조회 때마다 활성 연결, 현재 정책 버전과 `learning_progress`·`learning_reports` 범위를 다시 검사하고 조회 감사로그를 남깁니다.
