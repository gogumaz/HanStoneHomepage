---
name: standard-orchestrator
description: "범용 작업을 Q&A 이해도 게이트로 조율한다. 새 작업, 요구사항 정리, 작업 범위 결정, 계획 수립, 구현·작성·분석·자동화, 수정·재실행 요청에 반드시 사용한다. Q&A 이해도가 90% 미만이거나 치명적 열린 질문이 있으면 질문만 진행하고 실행하지 않는다."
---

# Standard Q&A Work Orchestrator

## Phase 0 — 컨텍스트 확인

기존 `_workspace/`와 이전 Q&A·계획·검증 결과를 읽는다. 부분 수정이면 해당 범위의 기존 산출물을 입력으로 사용한다.

## Phase 1 — Q&A 착수 인터뷰

**담당:** qa-interviewer / **스킬:** qa-intake

Q&A를 반복해 여섯 이해도 축을 평가한다. 매 턴 최대 세 질문만 하고, 점수·근거·열린 질문을 보여준다. 점수 90% 이상과 치명적 열린 질문 0개가 될 때까지 다음 단계로 넘어가지 않는다. 결과를 `00_qa_intake.md`에 저장하고 사용자 승인을 받는다.

## Phase 2 — 계획

**전제:** 승인된 Q&A 리포트

task-planner가 `01_work_plan.md`를 작성한다. 계획은 승인된 범위와 성공 기준만 다룬다.

## Phase 3 — 실행

**전제:** 승인된 계획

task-executor가 산출물을 만들고 `02_execution_log.md`에 검증 증거를 남긴다. 새 요구사항은 Q&A로 되돌린다.

## Phase 4 — 독립 검증

quality-verifier가 Q&A 요구사항, 계획, 결과를 대조해 `03_quality_report.md`에 PASS/FIX/REDO/UNVERIFIED를 기록한다. FIX/REDO는 원인에 따라 Q&A·계획·실행 단계로 되돌린다.

## 완료 조건

- Q&A 이해도 90% 이상, 치명적 열린 질문 0개, 사용자 승인
- 계획의 완료 기준 충족
- 독립 검증 PASS 또는 남은 UNVERIFIED를 사용자가 명시적으로 수용
