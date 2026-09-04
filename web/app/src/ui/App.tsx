/**
 * 앱 껍데기.
 *
 * M3 1단계는 빌드가 서는 것까지다. 실제 화면(단면 뷰가 주인공, 3D는 보조,
 * 타임라인 가로, React Flow 노드 에디터)은 데이터 모델이 선 뒤에 붙인다 —
 * 그 전에 UI를 만들면 갈아엎게 된다.
 *
 * 지금은 코어가 실제로 도는지 브라우저에서 한눈에 보이는 최소 확인 화면이다.
 */
import { useEffect, useState } from "react";
import { runSmokeSequence, type StepLog } from "../core/sequences/smoke";

export function App() {
  const [rows, setRows] = useState<StepLog[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setBusy(true);
    // 코어는 동기 함수다. Worker로 옮기기 전까지는 첫 페인트 뒤에 돌린다.
    const id = setTimeout(() => {
      setRows(runSmokeSequence(96, 48, 60).log);
      setBusy(false);
    }, 0);
    return () => clearTimeout(id);
  }, []);

  const fails = rows.filter((r) => r.ok === false).length;

  return (
    <main style={{ font: "14px/1.6 system-ui, sans-serif", padding: 24, maxWidth: 900 }}>
      <h1 style={{ fontSize: 20, margin: "0 0 4px" }}>FabSim3D</h1>
      <p style={{ color: "#666", margin: "0 0 20px" }}>
        교육용 반도체 공정 시뮬레이터 · 코어 이식 확인용 화면
      </p>
      {busy && <p>시뮬레이션 실행 중…</p>}
      {!busy && (
        <p>
          {rows.length - fails}/{rows.length} 단계 통과
          {fails > 0 && <strong style={{ color: "#c33" }}> · {fails} 실패</strong>}
        </p>
      )}
      <table style={{ borderCollapse: "collapse", width: "100%" }}>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} style={{ borderTop: "1px solid #eee" }}>
              <td style={{ padding: "6px 8px", width: 28, color: r.ok === false ? "#c33" : "#2a2" }}>
                {r.ok === false ? "✕" : "✓"}
              </td>
              <td style={{ padding: "6px 8px" }}>{r.tag}</td>
              <td style={{ padding: "6px 8px", color: "#666" }}>{r.note}</td>
              <td style={{ padding: "6px 8px", color: "#999", textAlign: "right" }}>
                {(r.ms / 1000).toFixed(2)}s
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </main>
  );
}
