---
name: fabsim3d-stack
description: "스택은 TypeScript + Three.js 브라우저 실행으로 확정, 백엔드 없음"
metadata: 
  node_type: memory
  type: project
  originSessionId: 53e4ffa7-8c5c-4798-99e2-e7c646e55d17
  modified: 2026-09-04T05:03:56.355Z
---

2026-09-04 확정: **TypeScript + Three.js, 브라우저 실행, 백엔드 없음.** Unity에서 웹으로 이전한다. Unity를 계속 쓸 외부 제약(학위 요건, 설치형 배포 필수 등)은 없다고 확인했다.

**Why:** 논의 과정에서 Unity를 붙잡을 근거가 전부 없어졌다 — ①600만 복셀 인스턴싱은 표현을 표면 메시로 바꾸면서 불필요, ②Compute Shader가 필요할 줄 알았으나 연산이 전부 O(N) 배열 순회, ③Python 과학 생태계는 PDE를 안 풀기로 하면서 불필요. 반대로 **런타임 노드 편집**이 Unity에서 막힌다(`RunTimeGraphUI.cs`의 에디터 열기가 `#if UNITY_EDITOR`라 빌드에서 동작 안 함) — 자유로운 공정 순서 설계가 제품의 본질이므로 치명적이다. 교육용이라 링크 하나로 여는 배포도 중요하다.

**사용자는 Python 경험만 있다** (TS/React 미경험, C#도 GPT-4o 도움으로 작성한 것). 그래도 TS를 택한 이유: scipy로 한 줄인 것들(`distance_transform_edt`, `label`, `marching_cubes`)을 직접 써야 하지만 총 150줄 수준의 **일회성 비용**인 반면, Python 쪽 손해(pip 설치 배포, 노드 에디터 선택지, Pyodide의 20~30MB 첫 로딩)는 구조적·영구적이다.

**How to apply:** 코어 수치 연산(EDT, flood fill, 가시성 광선)은 내가 한 번 작성하고 한국어 주석을 충실히 달아 이후 건드릴 일이 없게 한다. 사용자가 자주 손댈 공정 연산자는 30~50줄 수준으로 짧게 유지한다. **React를 도입한다** (2026-09-04 확정 — 노드 에디터를 React Flow로 정했기 때문). 단 시뮬레이션 코어는 프레임워크 무관한 순수 TS로 유지한다. 기존 Unity 코드는 명세서로 활용(선택비 테이블, 재질 목록, 노드 구성, 마스크 디자이너 UX) 하되 컬럼 기반 루프는 이식하지 않는다 — [[fabsim3d-column-assumption]].

관련: [[fabsim3d-goal]], [[fabsim3d-deposition-decision]], [[fabsim3d-connectivity-primitive]]
