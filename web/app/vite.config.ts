import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
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
