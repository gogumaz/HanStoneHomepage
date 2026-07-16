# Standard Q&A Work Harness

게임 개발에 한정되지 않는 표준 작업 하네스입니다. 문서 작성, 분석, 코드 변경, 데이터 정리, 자동화, 조사 등 어떤 작업이든 AI가 먼저 질문과 답변(Q&A)으로 요구사항을 이해합니다.

## 핵심 흐름

```text
Q&A 인터뷰 → 이해도 90% + 치명적 미확정 0개 → 사용자 승인 → 계획 → 실행 → 독립 검증
```

이해도는 목표(20), 산출물·성공 기준(20), 범위·제외 범위(15), 입력·맥락(15), 제약·의존성(15), 검증·예외 처리(15)를 합산해 판단합니다. AI는 점수만 채우기 위해 추측하지 않으며, 답이 필요한 항목을 질문으로 남깁니다.

## 설치

### Windows

```powershell
git clone https://github.com/76wkd/standard-qa-harness.git
cd standard-qa-harness
powershell -ExecutionPolicy Bypass -File .\install-harness.ps1 -TargetPath C:\Work\my-project
```

### macOS / Linux

```sh
git clone https://github.com/76wkd/standard-qa-harness.git
cd standard-qa-harness
sh ./install-harness.sh --target ~/Projects/my-project
```

기존 하네스 설정을 보존한 채 교체하려면 Windows에서는 `-Force`, macOS/Linux에서는 `--force`를 추가합니다.

## 사용 시작

설치 대상 폴더를 Claude Code에서 열고 요청합니다.

```text
standard-orchestrator로 이 작업의 Q&A 착수 인터뷰를 시작해줘.
```

AI는 한 번에 최대 세 개의 질문을 하고, 각 응답 뒤에 현재 이해도·확정된 내용·남은 질문을 알려줍니다. 이해도 90% 이상이 되면 `_workspace/00_qa_intake.md`를 제시하고 승인받은 뒤에만 작업을 시작합니다.
