# FabSim3D 설계 로그

Claude Code 세션에서 축적된 설계 결정 기록입니다. 다른 컴퓨터에서 이 저장소를 clone하면 코드와 함께 여기 있는 설계 맥락도 참조할 수 있습니다. Claude에게 이 폴더를 먼저 읽게 하면 처음부터 설명하지 않아도 이어서 작업할 수 있습니다.

## 색인

- [FabSim3D 목표](fabsim3d-goal.md) — 교육용 공정 시뮬레이터 샌드박스, TCAD 아님. 물리 PDE 추천은 이미 철회됨
- [스택 확정](fabsim3d-stack.md) — TypeScript + Three.js 브라우저 실행. 사용자는 Python 경험만 있음
- [증착 연산자 결정](fabsim3d-deposition-decision.md) — 거리 지도 + 스텝 커버리지 채택, FMM 대신 EDT feature transform
- [컬럼 가정 문제](fabsim3d-column-assumption.md) — 기존 코드의 GetTopZ 기반 2.5D 가정이 샌드박스에서 깨지는 이유
- [연결성 원시연산](fabsim3d-connectivity-primitive.md) — 봉인·채우기·확산이 공유하는 "바깥과 이어져 있는가" 검사
- [연산자 세트](fabsim3d-operator-set.md) — 공정 노드 12개 = 원시연산 4개의 조합. A/B/C 결정 포함
- [아키텍처 결정](fabsim3d-architecture.md) — 스냅샷·재실행, 분기, 마스크, React Flow 채택
- [검증 기록](fabsim3d-verification-log.md) — 2D 수치 검증 5건과 그로 바뀐 결정. EDT 근사가 통하는 조건
- [M1 마일스톤](fabsim3d-m1.md) — 파이썬 참조 구현(m1a_core.py)과 브라우저 코어. 아티팩트 링크 모음
- [프로젝트 전반 검토](fabsim3d-project-review.md) — 코어는 완료, 데이터 모델·레시피·교육 계층·앱 상태·테스트가 미설계. 로드맵 M1c~M5
- [M2 연산자 구현](fabsim3d-m2.md) — 리소4+CMP+주입+어닐 완료, 산화·실리사이드 남음. CMP는 수직 하강, 어닐은 CN
- [M3 실제 빌드](fabsim3d-m3.md) — 앱 완성. 코어 단일화·재질 데이터화·프로젝트 모델·실행기·화면. 테스트 75건 + 브라우저 스모크
- [작업 방식](fabsim3d-working-mode.md) — 사용자는 가이드, 구현은 전부 Claude. 한 번에 한 주제씩
- [질문은 간략히](fabsim3d-ask-briefly.md) — 선택지와 추천만. 긴 배경 설명 금지
- [설계 우선](fabsim3d-design-first.md) — 구현 서두르지 말 것. 주장은 2D 스크립트/벤치마크로 검증
