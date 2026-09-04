---
name: fabsim3d-m1
description: M1 마일스톤의 구성과 산출물 — 파이썬 참조 구현과 브라우저 코어의 위치
metadata: 
  node_type: memory
  type: project
  originSessionId: 53e4ffa7-8c5c-4798-99e2-e7c646e55d17
  modified: 2026-09-04T09:35:33.343Z
---

M1은 "파이프라인이 도는가"가 아니라 **설계 위험을 회수하는가**를 기준으로 짰다 (Fable 검토가 원래 M1이 위험을 다 피해간다고 지적한 데 따른 것). 적대적 시퀀스 세 개를 일부러 실행한다 — (a) 나쁜 스텝 커버리지로 보이드 봉인, (b) 서로 다른 재질이 동시 노출된 선택비 식각, (c) 봉인된 보이드를 식각으로 재개방.

**이 환경에는 Node가 없다.** TypeScript를 작성해도 로컬에서 돌려볼 수 없어서 M1을 둘로 나눴다.

- **M1a — 완료.** `web/reference/m1a_core.py` (프로젝트 안, 검증 스크립트 7개 + README와 함께). 축소 격자(72×36×44)에서 3D 코어를 파이썬으로 구현하고 검증했다. 적대적 (a)(b)(c) 전부 통과, φ 부호 불일치 0건. **이것이 TypeScript 이식의 참조 구현이다 — 같은 구조, 같은 이름을 유지한다.**
- **M1b — 브라우저 실행판.** https://claude.ai/code/artifact/683089d2-3ff5-46ba-9d00-ff52d6960115 · 같은 코어를 실제 규모(최대 600만 복셀)로 옮기고 3D 뷰·단면·타임라인 스크럽·불변식 검사를 한 페이지에 담았다. 성능 실측도 여기서 함께 나온다. 표면은 노출면 사각형 추출이고 절단면 슬라이더로 내부 보이드를 본다.

**다른 산출물:** 설계 명세 https://claude.ai/code/artifact/5723e6a5-3f5b-470a-9c1e-5ca273f499f5 · 원시연산 벤치마크 https://claude.ai/code/artifact/df485d03-dd24-4aff-a15f-a778a97e476f · 증착 방식 비교 데모 https://claude.ai/code/artifact/cb8a6892-005a-4afe-a88f-b73c8d29b3f7

**How to apply:** 나머지 연산자(리소그래피 4종·CMP·이온 주입·어닐·산화·실리사이드)를 얹을 때는 M1a 파이썬 구현에 먼저 추가해 검증한 뒤 브라우저판으로 옮긴다. 원시연산은 이미 검증됐으므로 그 위에 얹는 작업이다.

**M1c (다음):** 2차 검토 결과를 브라우저판에 적용 — φ 파이프라인(O), union-find 봉인·돌파(P), 스크래치 버퍼 재사용(S), Worker(Q). 증착의 봉인 훑기 12회와 식각의 돌파 탐침 10회가 사라지고 컨포멀 연산은 EDT 자체가 없어진다. 마칭큐브는 φ 0-등고면에서 뽑는다. 파이썬 참조 구현 `phi_and_seal_check.py`가 union-find의 올바른 구현(병합 시 도장)을 담고 있다.

관련: [[fabsim3d-verification-log]], [[fabsim3d-operator-set]], [[fabsim3d-stack]]
