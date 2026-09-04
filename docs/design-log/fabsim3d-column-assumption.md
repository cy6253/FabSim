---
name: fabsim3d-column-assumption
description: 기존 Unity 코드 전반에 2.5D 컬럼(GetTopZ) 가정이 박혀 있어 자유 조합 샌드박스에서는 즉시 깨진다
metadata: 
  node_type: memory
  type: project
  originSessionId: 53e4ffa7-8c5c-4798-99e2-e7c646e55d17
  modified: 2026-09-04T04:53:29.408Z
---

기존 Unity 코드는 칩을 **세로 기둥의 모음**으로 다룬다. `DieLayerMap3D.GetTopZ(x, y)`를 축으로 "각 기둥 꼭대기부터 아래로" 처리하는 2.5D 높이맵 구조다.

자유 조합 샌드박스에서는 이 가정이 거의 즉시 깨진다:
- 트렌치에 컨포멀 증착 → 오버행/보이드가 생기고, 한 컬럼에 `재료 → 빈공간 → 재료`가 나타나 "꼭대기"가 유일하지 않다
- `EtchProcess.cs` dry etch는 topZ부터 아래로 훑어 재진입 프로파일을 못 다룬다
- `PhotoProcess3D.OnPRCoatingClicked`는 topZ 위로만 PR을 쌓아, 실제로는 액체라 채워야 할 트렌치를 지붕처럼 덮기만 한다
- `FurnaceProcess.cs`의 `layers[^1].material != "Si"`는 List 순서가 수직 순서라고 가정하지만 `AddLayer`는 삽입 순서일 뿐이다

**Why:** 그래서 이 프로젝트는 "Three.js 이식"이 아니라 **컬럼 기반 로직을 거리장 기반 3D 연산자로 갈아엎는 재설계**가 본질이다. 거리장 연산자는 애초에 컬럼 개념이 없어 이 문제가 원천적으로 안 생긴다.

**How to apply:** 기존 코드를 참고하되 컬럼 루프(`GetTopZ` + z 방향 스캔)는 이식하지 않는다. 렌더링도 표현을 바꾸면 600만 복셀 인스턴싱이 아니라 표면 메시가 되어 가벼워지므로, 프론트엔드 선택은 부차적인 문제다.

확인된 별개 버그(어느 스택으로 가든 참고): `ImplantationProcess.cs:139-153` 어닐의 `time` 인자가 무효(스냅샷을 t 루프 밖에서 한 번만 떠서 t=1과 t=100 결과가 같음), `EtchProcess.cs:115-148` 두께와 시간 단위가 섞임.

관련: [[fabsim3d-goal]], [[fabsim3d-deposition-decision]]
