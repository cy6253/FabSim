/**
 * FabSim3D 시뮬레이션 코어.
 *
 * 프레임워크 무관한 순수 TypeScript다 — React도 Three.js도 여기에는 없다
 * (fabsim3d-stack). UI는 이 위에 얹히고, Worker도 이 모듈만 import 한다.
 *
 * 출처: web/prototype/m2-ops.html 의 검증된 JS 코어를 이식한 것이다.
 * 알고리즘은 web/reference/*.py 에서 수치로 검증됐고, 이식의 동일성은
 * src/core/__tests__/parity.test.ts 가 단계마다 해시로 지킨다.
 */
export * from "./materials";
export * from "./grid";
export * from "./edt";
export * from "./fmm";
export * from "./phi";
export * from "./connectivity";
export * from "./visibility";
export * from "./measure";
export * from "./masks";
export * from "./ops";
