# 게시판 입력·권한 설계

## 1. 구현 개요

`board.html?type={게시판유형}` 한 페이지에서 게시판 유형에 맞는 목록, 검색, 분류, 상세보기, 글쓰기 폼을 동적으로 제공합니다.

현재 프로토타입은 `config.js`의 `boardApiEnabled`가 `false`이므로 작성한 데이터를 브라우저 `localStorage`에 임시 저장합니다. 운영 환경에서는 `boardApiEnabled: true`로 설정하고 서버 API와 파일 저장소를 연결해야 합니다.

## 2. 게시판 주소

| 게시판 | 주소의 `type` 값 |
|---|---|
| 공지사항 | `notice` |
| 수업 팁 | `classTip` |
| 여행기 | `travel` |
| 자주 묻는 질문 | `faq` |
| 1:1 문의 | `inquiry` |
| 기관상담 | `consultation` |
| 지도자 수업도우미 | `classHelper` |
| 교재자료 | `resource` |

예: `board.html?type=classTip`

## 3. 작성 권한

| 게시판 | 비회원 | 학생 | 학부모 | 지도자 | 운영자 | 관리자 |
|---|:---:|:---:|:---:|:---:|:---:|:---:|
| 공지사항 | - | - | - | - | 작성 | 작성 |
| 수업 팁 | - | - | - | 작성·검토대기 | 작성·즉시공개 | 작성·즉시공개 |
| 여행기 | - | - | - | 작성·검토대기 | 작성·즉시공개 | 작성·즉시공개 |
| FAQ | - | - | - | - | 작성 | 작성 |
| 1:1 문의 | - | 작성 | 작성 | 작성 | 작성·전체조회 | 작성·전체조회 |
| 기관상담 | 작성 | 작성 | 작성 | 작성 | 작성·전체조회 | 작성·전체조회 |
| 지도자 수업도우미 | - | - | - | 읽기 | 작성 | 작성 |
| 교재자료 | - | - | - | - | 작성 | 작성 |

글쓰기 버튼은 모든 게시판에 표시합니다. 권한이 없으면 로그인 또는 권한 안내를 표시하고 폼을 열지 않습니다. 이 UI 제어는 편의를 위한 것이며 실제 보안은 서버가 매 요청마다 역할과 리소스 소유권을 검사해야 합니다.

## 4. 게시판별 입력 항목

### 공지사항

- 분류
- 제목
- 내용
- 공개일
- 상단 고정
- 첨부파일

### 수업 팁

- 분류
- 제목
- 대상 학년
- 연결 시대
- 바둑 수준
- 수업 내용
- 수업자료 첨부

지도자가 등록하면 `pending_review`, 운영자가 등록하면 `published` 상태로 저장합니다.

### 여행기

- 분류
- 제목
- 반·기관명
- 여행 시대
- 여행 이야기
- 사진 첨부
- 사진 및 학습 사례 공개 동의

지도자 작성 글은 운영자 검토 후 공개하도록 합니다.

### FAQ

- 분류
- 질문
- 답변
- 노출 순서
- 바로 공개 여부

### 1:1 문의

- 문의 유형
- 제목
- 문의 내용
- 첨부파일(JPG·PNG·WebP·PDF, 기본 10MB 이하)

회원 본인과 운영자만 조회할 수 있는 비공개 데이터입니다. 첨부는 사용자·MIME·크기가 고정된 저장소 정책으로 격리 업로드하고 실제 시그니처와 ClamAV 검사를 통과한 파일만 문의에 한 번 연결합니다. 다운로드 때도 소유권 또는 운영 권한을 다시 확인하며 저장소 객체 키를 공개하지 않습니다.

### 기관상담

- 기관 유형
- 기관명
- 담당자명
- 연락처
- 이메일
- 예상 인원
- 문의 제목
- 문의 내용
- 개인정보 수집·이용 동의

비회원도 접수할 수 있지만 목록을 공개하면 안 됩니다. 비회원 접수 결과는 추측하기 어려운 접수번호 또는 별도의 확인 절차로 제공해야 합니다.

### 지도자 수업도우미

수업도우미는 자료를 각각 검색하는 자료실이 아니라, 게시물 하나를 열어 25~30분 수업을 순서대로 실행하는 패키지 게시판입니다. 관리자와 운영자가 작성하고 지도자는 게시물 상세를 수업 화면으로 활용합니다.

기본정보:

- 연결 시대
- 수업 패키지명
- 연결 강의 ID
- 연결 바둑미션 ID
- 대상 학년
- 전체 수업 시간
- 수업 목표와 활용 안내

자동 수업 흐름:

1. 도입: 역사 장면 2분
2. 설명: 오늘의 바둑 개념 5분
3. 문제풀이: 미션 10분
4. 퀴즈: 역사 미션 5분
5. 마무리: 생각 한 수! 3분

한 게시물에 필수로 묶는 첨부자료:

- 수업용 5분 영상
- 빔프로젝터용 PPT
- 인쇄 활동지 PDF
- 역사 퀴즈
- 문제풀이 미션
- 정답·해설
- 수업 진행·가이드

각 자료는 별도 게시물로 분리하지 않습니다. 게시물 상세에서 수업 흐름과 7개 첨부자료를 함께 보여 주어 지도자가 파일을 다시 검색하지 않게 합니다.

`문제풀이 미션` 첨부자료는 인쇄·장애 대응용 보조자료로 유지하고, 게시물의 `badukMissionId`로 사용자 착수형 게임을 함께 연결합니다. 지도자가 수업 상세에서 `게임 실행`을 누르면 같은 수업 흐름 안에서 해당 문제의 9·13·19줄 바둑판이 전체화면 수업 모드로 열려야 합니다.

### 교재자료

- 자료 유형
- 자료명
- 연결 강의
- 버전
- 다운로드 권한
- 자료 설명
- 자료 파일

### 강의영상 등록(CMS)

강의영상은 일반 게시글과 다른 재생 권한이 필요하므로 `board.html`의 공개 게시글이 아니라 `lecture.html`의 강의 CMS에서 등록합니다. 관리자와 운영자는 영상 등록·수정 화면에서 다음 값을 필수로 선택합니다.

- 무료 공개 여부 `아니오`: 유효한 구독 회원만 시청
- 무료 공개 여부 `예`: 비회원과 비구독자도 볼 수 있는 무료 샘플

무료 샘플도 강의 상태가 `published`일 때만 노출합니다. `draft`와 `archived`에서는 무료 공개 설정과 관계없이 일반 사용자의 목록과 재생을 차단합니다.

## 5. 공통 데이터 모델

```text
Post
├─ id
├─ boardType
├─ category
├─ title
├─ content
├─ authorId
├─ status: draft | pending_review | published | hidden
├─ isPinned
├─ publishedAt
├─ createdAt
└─ updatedAt

PostAttachment
├─ id
├─ postId
├─ role
├─ originalName
├─ storageKey
├─ mimeType
├─ size
└─ createdAt
```

수업도우미는 공통 게시물과 첨부 모델을 사용하되 수업 실행 순서를 별도 구조로 저장합니다.

```text
ClassHelperPackage
├─ postId, lessonId, badukMissionId, targetGrade, lessonDuration
├─ introductionContent
├─ conceptContent
├─ problemContent
├─ quizContent
├─ wrapUpContent
└─ attachmentRoles
   ├─ lessonVideo
   ├─ projectorPpt
   ├─ activityPdf
   ├─ historyQuizFile
   ├─ problemMissionFile
   ├─ answerFile
   └─ teacherGuideFile
```

1:1 문의와 기관상담은 개인정보 및 비공개 답변 상태가 필요하므로 공개 `Post` 테이블과 분리하는 것을 권장합니다.

```text
Inquiry
├─ id
├─ requesterUserId
├─ category
├─ title
├─ content
├─ status: submitted | in_review | answered | closed
├─ answer?
├─ answeredById?
├─ answeredAt
├─ createdAt
└─ updatedAt

Consultation
├─ id
├─ userId?
├─ organizationName
├─ contactName
├─ phoneEncrypted
├─ emailEncrypted
├─ expectedStudents
├─ content
├─ privacyConsentVersion
├─ privacyConsentedAt
├─ status
└─ createdAt
```

## 6. 제안 API

### 공개 게시판

| 메서드 | 경로 | 권한 |
|---|---|---|
| `GET` | `/notices` | 공개 |
| `POST` | `/admin/notices` | 운영자 |
| `PATCH` | `/admin/notices/{id}` | 운영자 |
| `DELETE` | `/admin/notices/{id}` | 운영자 |
| `GET` | `/posts?type=classTip` | 공개 |
| `GET` | `/posts?type=travel` | 공개 |
| `POST` | `/posts` | 지도자·운영자 |
| `PATCH` | `/posts/{id}` | 작성자·운영자 |
| `POST` | `/admin/posts/{id}/publish` | 운영자 |
| `POST` | `/admin/posts/{id}/reject` | 운영자 |
| `GET` | `/admin/posts?type={type}&status={status}` | 운영자 |
| `DELETE` | `/posts/{id}` | 작성자·운영자, 보관 처리 |
| `GET` | `/faqs` | 공개 |
| `POST` | `/admin/faqs` | 운영자 |
| `PATCH` | `/admin/faqs/{id}` | 운영자 |
| `GET` | `/materials` | 목록 공개, 다운로드는 이용권 검사 |
| `GET` | `/materials/{id}/download` | 공개·활성 개인 구독·지도자·기관 관리자 권한을 서버에서 다시 검사한 뒤 단기 서명 URL 발급 |
| `GET` | `/admin/materials` | 운영자, 초안·공개·보관 자료 전체 조회 |
| `POST` | `/admin/materials` | 운영자 |
| `PATCH` | `/admin/materials/{id}` | 운영자, 내용 수정과 선택적 파일 교체 |
| `GET` | `/admin/materials/{id}/revisions` | 운영자, 변경 전 버전 이력 조회 |
| `POST` | `/admin/materials/{id}/revisions/{revision}/restore` | 운영자, 보존 중인 파일과 내용을 새 버전으로 복원 |
| `POST` | `/admin/materials/{id}/publish` | 운영자, 안전 검사를 통과한 자료 공개 |
| `DELETE` | `/admin/materials/{id}` | 운영자, 자료 보관 처리 |
| `POST` | `/teaching-material-assets/uploads` | 운영자, 격리 업로드 정책 발급 |
| `POST` | `/teaching-material-assets/{id}/complete` | 운영자, 파일 시그니처·ClamAV 검사 완료 |

교재자료 목록에는 저장소 객체 키를 노출하지 않습니다. `전체 공개`는 비회원, `개인 유료`는 결제 완료 상태이면서 현재 유효한 구독자, `지도자`는 지도자 역할, `기관 회원`은 현재 서버에서 검증 가능한 기관 관리자 역할에만 다운로드를 허용합니다. 운영자·관리자는 모든 자료를 미리 볼 수 있습니다. 기관 소속 일반 회원 모델이 추가되면 기관 이용권과 멤버십을 함께 검사하도록 확장합니다.

### 지도자 전용 게시판

| 메서드 | 경로 | 권한 |
|---|---|---|
| `GET` | `/class-helpers` | 지도자·운영자·관리자 |
| `GET` | `/admin/class-helpers` | 운영자·관리자, 초안·공개·보관 전체 조회 |
| `POST` | `/admin/class-helpers` | 운영자·관리자 |
| `PATCH` | `/admin/class-helpers/{id}` | 운영자·관리자, 내용 수정과 6종 중 선택한 파일만 교체 |
| `GET` | `/admin/class-helpers/{id}/revisions` | 운영자·관리자, 변경 전 버전 이력 조회 |
| `POST` | `/admin/class-helpers/{id}/revisions/{revision}/restore` | 운영자·관리자, 보존 중인 6종 파일과 수업 흐름 복원 |
| `POST` | `/admin/class-helpers/{id}/publish` | 운영자·관리자, 공개 전 강의 영상과 6종 자료 재검사 |
| `DELETE` | `/admin/class-helpers/{id}` | 운영자·관리자, 보관 처리 |
| `POST` | `/class-helper-assets/uploads` | 운영자·관리자, 자료별 격리 업로드 정책 발급 |
| `POST` | `/class-helper-assets/{id}/complete` | 운영자·관리자, 파일 시그니처·ClamAV 검사 |
| `GET` | `/class-helpers/{id}/assets/{field}` | 지도자·운영자·관리자, 단기 서명 다운로드 |

수업용 영상은 같은 강의의 검사를 통과한 영상을 재사용합니다. 수업 패키지는 빔프로젝터 PPT·인쇄 활동지·역사 퀴즈·문제풀이 미션·정답·해설·진행 가이드 6종을 별도 격리 자산으로 업로드하고, 서버가 6종의 종류와 소유자·검사 상태를 확인한 뒤 한 트랜잭션에서 연결합니다. 실행 화면에는 연결 강의와 바둑미션 게임으로 바로 이동하는 링크가 함께 표시됩니다.

### 비공개 게시판

| 메서드 | 경로 | 권한 |
|---|---|---|
| `GET` | `/me/inquiries` | 로그인 회원 본인 |
| `POST` | `/inquiries` | 로그인 회원 |
| `GET` | `/admin/inquiries` | 운영자 |
| `GET` | `/admin/inquiries/{id}` | 운영자 |
| `POST` | `/admin/inquiries/{id}/answer` | 운영자 |
| `PATCH` | `/admin/inquiries/{id}/status` | 운영자 |
| `GET` | `/me/consultations` | 본인 또는 접수 확인 권한 |
| `POST` | `/consultations` | 공개, 속도 제한 적용 |
| `GET` | `/admin/consultations` | 운영자 |
| `GET` | `/admin/consultations/{id}` | 운영자 |
| `PATCH` | `/admin/consultations/{id}/status` | 운영자 |

운영자·관리자는 React `/admin/inquiries`에서 문의 상태·유형·검색어 필터, 상세 확인, 답변 등록·수정과 검토·종료 상태 전환을 수행합니다. 답변 완료 문의를 재검토로 되돌리면 서버 정책에 따라 기존 답변과 답변 시각이 삭제된다는 안내를 화면에 표시합니다.

## 7. 파일 업로드

브라우저 임시 저장 모드에서는 파일명만 기록합니다. 운영에서는 파일 본문을 게시글 JSON에 포함하지 않고 다음 순서로 처리합니다.

1. 서버에서 업로드 URL 또는 업로드 세션 발급
2. 허용 확장자와 MIME 유형 검사
3. 파일 크기 제한 검사
4. 악성 파일 검사
5. 객체 저장소에 원본 저장
6. 게시글에 `attachmentId` 연결
7. 다운로드 시 게시판 및 이용권 권한 재검사

여행기 사진은 서버에서 EXIF GPS 포함 여부를 검사하며, 위치정보가 있으면 거부되어 제거 후 다시 첨부해야 합니다. 공개 동의도 함께 확인합니다.

## 8. 개발용 권한 미리보기

`config.js`에서 다음 값이 활성화되어 있으면 게시판 상단에 역할 선택기가 표시됩니다.

```javascript
demoRoleSwitcher: true
```

선택한 역할은 `bhj_demo_role`이라는 `localStorage` 값으로 저장됩니다. 이는 UI 검증 전용이며 운영 배포에서는 반드시 `false`로 변경하고 `/me` API의 서버 세션 역할을 사용합니다.

## 9. 운영 전 필수 항목

- 공지·FAQ 서버 역할 검사, 초안·예약 공개·보관·검색·페이지 조회는 구현됨
- 수업 팁·여행기 서버 역할·소유권 검사, 지도자 검토 요청, 운영자 승인·반려·보관·검색·페이지 조회는 구현됨
- 공개 수업 팁·여행기 회원 신고, 중복 신고 차단, 운영자 신고함·숨김·기각과 감사 로그는 구현됨
- 수업 팁 자료·여행기 사진의 격리 업로드, 시그니처·악성코드·EXIF GPS 검사, 권한별 다운로드와 미연결 파일 정리는 구현됨
- 나머지 게시판의 서버 역할·소유권 검사
- 나머지 게시판의 관리자 임시저장·미리보기·예약게시
- 게시글 수정·삭제 및 변경 이력
- 비공개 문의 답변 완료 앱 내 알림(이메일 알림은 구현됨)
- 개인정보 보관 기간과 자동 파기
- 나머지 게시판 파일 저장소와 악성 파일 검사
- 나머지 게시판의 검색, 정렬, 페이지네이션
- 일반 회원 작성 게시판을 확장할 때 반복 위반자 제재·재심 정책 검토
