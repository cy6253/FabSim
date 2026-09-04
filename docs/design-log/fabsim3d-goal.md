---
name: fabsim3d-goal
description: FabSim3D는 교육용 반도체 공정 시뮬레이터이며 TCAD가 아닌 기하 연산자 기반 샌드박스를 지향한다
metadata: 
  node_type: memory
  type: project
  originSessionId: 53e4ffa7-8c5c-4798-99e2-e7c646e55d17
  modified: 2026-09-04T04:52:51.576Z
---

FabSim3D의 목표는 **교육용 반도체 공정 시뮬레이터**다 (2026-09-04 확인). 사용자가 공정 순서를 자유롭게 설계하면 그 순서대로 구조가 만들어지는 **샌드박스**이고, 만들 목표 구조는 정해두지 않는다 — 사용자 마음.

명시적으로 **TCAD가 아니다.** 확산 방정식(Fick), aerial image 같은 물리 PDE를 푸는 방향은 사용자가 원하지 않는다. Coventor SEMulator3D와 같은 카테고리 — 물리 방정식 대신 기하 연산자를 순서대로 적용하고, 파라미터는 물리 상수가 아니라 거동을 재현하는 노브(스텝 커버리지 %, 이방성 비율, 선택비)다.

**Why:** 이 구분을 놓치면 추천이 통째로 어긋난다. 실제로 초기에 ViennaPS + Python 백엔드, Fick 확산 솔버를 추천했다가 목표를 듣고 철회했다.

**How to apply:** 새 기능을 제안할 때 "물리적으로 더 정확한가"보다 "자유 조합에서 깨지지 않는가"와 "노브 하나가 가르치려는 개념 하나에 대응하는가"를 먼저 본다. 샌드박스이므로 모든 연산자가 모든 입력에서 유효한 결과를 내야 한다.

관련: [[fabsim3d-deposition-decision]], [[fabsim3d-column-assumption]]
