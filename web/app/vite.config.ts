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
  },
});
