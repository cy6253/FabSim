# 브라우저 프로토타입

단일 HTML 파일이라 그냥 브라우저로 열면 됩니다 (Three.js는 cdnjs에서 로드).
같은 파일이 claude.ai 아티팩트로도 게시돼 있습니다.

| 파일 | 내용 |
|---|---|
| `m2-ops.html` | **현재 메인.** 공정 노드 12종 전부, 14단계 시퀀스에 단계별 단언, 도핑 단면·프로파일 |
| `m1b-core.html` | 적대적 보이드 시퀀스(봉인→캡→재개방) 전용 코어 데모 |
| `perf-bench.html` | 원시연산(EDT·FMM·flood fill·가시성) 벤치마크 |
| `deposition-compare.html` | 8-이웃 확산 vs 거리 지도 증착 비교(2D) |
| `operator-spec.html` | 설계 명세 문서 |
| `project-review.html` | 프로젝트 전반 검토 문서 |

Node 없이 작성돼 로컬 검증을 못 했습니다. 알고리즘은 `../reference/`의 파이썬에서 검증됐고,
시퀀스 표의 "확인" 칸이 어느 연산자에서 어긋나는지 짚어줍니다.
