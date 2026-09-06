import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  // 상대 경로로 빌드한다 — GitHub Pages 같은 하위 경로 호스팅에서도 그대로 돈다.
  base: "./",
  plugins: [react()],
  // 시뮬레이션 코어는 프레임워크 무관한 순수 TS다 (설계: fabsim3d-stack).
  // 테스트는 node 환경에서 돌려 DOM 없이 코어만 검증한다.
  test: {
    globals: true,
    environment: "node",
    include: ["src/**/*.test.ts"],
    testTimeout: 120_000,
    // CMOS 예제 한 벌이 64초다. beforeAll에서 돌리므로 hook도 넉넉해야 한다.
    hookTimeout: 180_000,
    // 워커가 진행 보고의 응답을 집을 틈을 만든다. 이유는 setup 파일에 적었다.
    setupFiles: ["./src/test-setup.ts"],
  },
});
