/**
 * 진단 — 코어가 이미 계산한 것을 사람이 읽는 문장으로.
 *
 * 프로젝트 검토에서 "가장 값진 빈자리"로 꼽은 층이다. 시뮬레이터는 이미 보이드가
 * 갇힌 것도, 정지층이 뚫린 것도, 레지스트가 먼저 사라진 것도 알고 있다. 문제는
 * 학생이 화면만 보고는 **그게 문제라는 걸 모른다**는 것이다. 그럴듯해 보이는
 * 결과와 옳은 결과를 구분해 주는 것이 여기서 할 일이다.
 *
 * 원칙 세 가지:
 *  ① 추측하지 않는다. 세어 본 값에서만 말한다.
 *  ② 무엇이 일어났는지와 **왜 그게 문제인지**를 같이 말한다.
 *  ③ 고치는 방향을 한 줄 준다. 노브 하나를 짚어 준다.
 */
import type { Library } from "../library";
import type { RecipeNode } from "../project/types";
import type { Frame } from "../runner/executor";

export type Severity = "info" | "warn" | "error";

export interface Diagnostic {
  /** 검사 종류. 같은 종류가 여러 단계에서 나올 수 있다. */
  kind: string;
  severity: Severity;
  /** 몇 번째 단계인가 (0-기반). */
  step: number;
  /** 한 줄 요약. */
  title: string;
  /** 세어 본 값. */
  detail: string;
  /** 왜 문제이고 무엇을 만지면 되는가. */
  advice?: string;
}

const pct = (a: number, b: number) => (b === 0 ? 0 : (a / b) * 100);

/**
 * 실행 결과 전체를 훑어 진단을 만든다.
 *
 * frames[i]와 frames[i-1]의 차이, 그리고 그 단계의 노드가 무엇이었는지를 본다.
 * 계산은 이미 끝나 있으므로 여기서는 배열을 다시 훑지 않는다 — 프레임에 붙어 있는
 * counts/voidCount/changed만 읽는다.
 */
export function analyze(
  frames: Frame[],
  chain: RecipeNode[],
  lib: Library,
): Diagnostic[] {
  const out: Diagnostic[] = [];
  const name = (m: number) => lib.mat.name[m] ?? String(m);

  for (let i = 0; i < frames.length; i++) {
    const f = frames[i];
    const prev = i > 0 ? frames[i - 1] : null;
    const node = chain[i];
    if (!node) continue;
    const p = node.params;
    const push = (d: Omit<Diagnostic, "step">) => out.push({ ...d, step: i });

    /* ---------------------------------------------------- 아무 일도 안 한 단계 */
    const touched = f.changed.added + f.changed.removed + f.changed.mutated;
    if (touched === 0 && !f.concChanged) {
      push({
        kind: "no-op",
        severity: "warn",
        title: `${i + 1}단계가 아무 것도 바꾸지 않았습니다`,
        detail: `${f.label} — 추가 0, 제거 0`,
        advice:
          node.type === "oxidize"
            ? "산화 시간이 짧아 두께가 1복셀 미만이면 격자에 아무것도 안 생깁니다. 시간을 늘리세요."
            : node.type === "silicide"
              ? "금속과 반도체가 맞닿아 있어야 반응합니다. 사이에 산화막이 있으면 먼저 벗겨야 합니다."
              : node.type === "implant"
                ? "마스크가 전부 막고 있거나, 광선이 닿는 재질이 없습니다."
                : f.topOccupied > 0
                  ? "구조가 격자 꼭대기에 닿아 바깥으로 나가는 길이 막혔습니다. 두께를 줄이거나 더 높은 격자를 쓰세요."
                  : "파라미터가 너무 작거나, 대상 재질이 이미 없습니다.",
      });
    }

    /* -------------------------------------------------- 격자 천장에 닿았는가 */
    if (f.topOccupied > 0 && (!prev || prev.topOccupied === 0)) {
      push({
        kind: "grid-full",
        severity: "error",
        title: "구조가 격자 꼭대기에 닿았습니다",
        detail: `맨 위 층의 ${f.topOccupied.toLocaleString()}칸이 채워짐`,
        advice:
          "천장에 닿으면 바깥으로 나가는 길이 막혀 이후 증착·산화가 조용히 아무 일도 " +
          "하지 않습니다. 두께를 줄이거나 더 높은 격자 프리셋을 쓰세요.",
      });
    }

    /* ------------------------------------------------------------ 봉인 보이드 */
    if (prev && f.voidCount > prev.voidCount) {
      const grew = f.voidCount - prev.voidCount;
      push({
        kind: "void-sealed",
        severity: "warn",
        title: `봉인된 보이드가 ${grew.toLocaleString()}셀 생겼습니다`,
        detail: `보이드 ${prev.voidCount.toLocaleString()} → ${f.voidCount.toLocaleString()}셀`,
        advice:
          node.type === "deposit"
            ? "입구가 바닥보다 먼저 막힌 것입니다. 스텝 커버리지를 올리거나(ALD 1.0), 트렌치를 얕게 하세요."
            : "빈 공간이 바깥과 끊겼습니다. 이후 공정의 가스·액체가 여기 못 들어갑니다.",
      });
    }
    if (prev && f.voidCount < prev.voidCount && node.type === "etch") {
      push({
        kind: "void-reopened",
        severity: "info",
        title: "식각이 봉인된 보이드를 다시 열었습니다",
        detail: `보이드 ${prev.voidCount.toLocaleString()} → ${f.voidCount.toLocaleString()}셀`,
        advice: "뚫린 순간부터 그 빈 공간이 새 식각 시작점이 됩니다.",
      });
    }

    /* -------------------------------------------------------- 식각 관련 진단 */
    if (node.type === "etch" && prev) {
      const et = lib.proc.byId.etchant[String(p.etchant)];
      if (et) {
        for (const [key, rate] of Object.entries(et.selectivity)) {
          const m = lib.mat.index[key];
          if (m === undefined || rate >= 0.3) continue; // 목표 재질은 깎이는 게 맞다
          const b = prev.counts[m] ?? 0;
          const a = f.counts[m] ?? 0;
          if (b === 0) continue;
          if (a === 0) {
            push({
              kind: "stop-layer-broken",
              severity: "error",
              title: `${name(m)}이(가) 완전히 없어졌습니다`,
              detail: `선택비 ${rate}로 깎일 재질인데 ${b.toLocaleString()}셀이 전부 사라졌습니다`,
              advice: "식각 시간을 줄이거나 선택비가 더 높은 식각액을 쓰세요. 정지층이 뚫리면 아래 구조가 손상됩니다.",
            });
          } else if (a < b * 0.7) {
            // 레지스트가 깎이는 건 정지층이 뚫리는 것과 다른 이야기다 —
            // 마스크 예산이 얼마나 남았는가의 문제다.
            push(
              lib.mat.isResist[m]
                ? {
                    kind: "resist-budget",
                    severity: "warn",
                    title: `레지스트가 ${pct(b - a, b).toFixed(0)}% 소모됐습니다`,
                    detail: `${name(m)} ${b.toLocaleString()} → ${a.toLocaleString()}셀 (선택비 ${rate})`,
                    advice:
                      "여유가 얼마 안 남았습니다. 식각을 더 하거나 다음 단계를 붙이려면 " +
                      "PR을 두껍게 하거나 하드마스크로 넘기세요.",
                  }
                : {
                    kind: "stop-layer-attacked",
                    severity: "warn",
                    title: `${name(m)}이(가) ${pct(b - a, b).toFixed(0)}% 깎였습니다`,
                    detail: `${b.toLocaleString()} → ${a.toLocaleString()}셀 (선택비 ${rate})`,
                    advice: "선택비가 낮아도 시간이 길면 뚫립니다. 오버에치 여유를 줄이세요.",
                  },
            );
          }
        }
      }
      // 레지스트가 식각 도중 소모되면 보통 패턴이 전사되지 않는다. 다만 아래에
      // 하드마스크가 깔려 있으면 그게 이어받으므로 정상이다 — 실제 STI가 그렇게
      // 한다. 그래서 "다른 저선택비 재질이 살아남았는가"를 먼저 본다.
      const hardMask = et
        ? Object.entries(et.selectivity).some(([k, rate]) => {
            const m = lib.mat.index[k];
            return (
              m !== undefined && rate < 0.3 && !lib.mat.isResist[m] && (f.counts[m] ?? 0) > 0
            );
          })
        : false;
      for (let m = 0; m < lib.mat.count; m++) {
        if (!lib.mat.isResist[m]) continue;
        const b = prev.counts[m] ?? 0;
        const a = f.counts[m] ?? 0;
        if (b === 0 || a > 0) continue;
        push(
          hardMask
            ? {
                kind: "resist-consumed-hardmask",
                severity: "info",
                title: "레지스트가 소모됐지만 하드마스크가 이어받았습니다",
                detail: `${name(m)} ${b.toLocaleString()} → 0셀`,
                advice:
                  "긴 식각은 레지스트가 못 견딥니다. 그래서 먼저 얇은 하드마스크에 " +
                  "패턴을 옮기고, 그 하드마스크로 깊은 식각을 합니다.",
              }
            : {
                kind: "resist-consumed",
                severity: "error",
                title: "레지스트가 식각 도중 다 없어졌습니다",
                detail: `${name(m)} ${b.toLocaleString()} → 0셀`,
                advice:
                  "마스크가 사라진 뒤로는 웨이퍼 전면이 깎입니다 — 패턴이 전사되지 않습니다. " +
                  "PR을 두껍게 하거나, 하드마스크에 먼저 패턴을 옮기세요.",
              },
        );
      }
    }

    /* -------------------------------------------------------- 증착 커버리지 */
    if (node.type === "deposit" && f.addedPerColumn) {
      const { top, min } = f.addedPerColumn;
      if (top > 0 && min < top * 0.9) {
        const cov = min / top;
        push({
          kind: "coverage-measured",
          severity: cov < 0.4 ? "warn" : "info",
          title: `실측 스텝 커버리지 ${(cov * 100).toFixed(0)}%`,
          detail: `가장 두꺼운 컬럼 ${top}복셀, 가장 얇은 곳 ${min}복셀`,
          advice:
            cov < 0.4
              ? "깊은 곳이 거의 안 자랍니다. 입구가 먼저 막혀 보이드가 생기기 쉽습니다."
              : "깊이에 따라 성장 속도가 다릅니다 — 하늘이 얼마나 보이는지가 그 차이입니다.",
        });
      }
    }

    /* -------------------------------------------------------------- 리소그래피 */
    if (node.type === "prCoat" && Number(p.planarization) < 0.5) {
      const next = chain[i + 1];
      if (next && next.type === "expose") {
        push({
          kind: "expose-on-topography",
          severity: "warn",
          title: "평탄하지 않은 면 위에 노광합니다",
          detail: `평탄화 ${p.planarization}`,
          advice:
            "단차 때문에 PR 두께가 불균일해 현상 결과가 자리마다 달라집니다. " +
            "이것이 CMP가 필요한 이유입니다 — 평탄화를 1.0으로 올려 비교해 보세요.",
        });
      }
    }
    if ((node.type === "expose" || node.type === "implant") &&
        (Number(p.dx) !== 0 || Number(p.dy) !== 0)) {
      push({
        kind: "misaligned",
        severity: "info",
        title: `정렬 오차 (${p.dx}, ${p.dy})가 적용됐습니다`,
        detail: "마스크가 의도한 자리에서 밀려 찍힙니다",
        advice: "오버레이 오차입니다. 실제 소자에서는 이것 때문에 콘택이 어긋나거나 단락이 납니다.",
      });
    }

    /* ------------------------------------------------------------------ 도핑 */
    if (node.type === "anneal" && prev && f.concChanged) {
      // 도즈 보존은 솔버의 불변식이다. 깨지면 수치가 잘못된 것이다.
      const b = totalDose(prev.conc);
      const a = totalDose(f.conc);
      if (b > 0 && Math.abs(a / b - 1) > 0.01) {
        push({
          kind: "dose-not-conserved",
          severity: "error",
          title: "어닐에서 도즈가 보존되지 않았습니다",
          detail: `${b.toFixed(1)} → ${a.toFixed(1)} (${((a / b - 1) * 100).toFixed(1)}%)`,
          advice: "확산은 도펀트를 옮기기만 하지 없애지 않습니다. 솔버 문제입니다.",
        });
      }
    }

    /* ------------------------------------------------------ 실리사이드 */
    if (node.type === "silicide") {
      // 살리사이드는 반응시킨 뒤 **안 반응한 금속을 벗기는** 것까지가 한 벌이다.
      // 그걸 빼먹으면 산화막 위에 금속이 그대로 남아 게이트와 소스·드레인이
      // 이어진 채로 끝난다 — 화면으로는 멀쩡해 보이므로 말해 줘야 한다.
      let left = 0;
      for (const [m, n] of Object.entries(f.counts))
        if (lib.mat.kind[Number(m)] === "metal") left += n;
      const removedLater = chain.slice(i + 1).some((n2) => n2.type === "etch" || n2.type === "cmp");
      if (left > 0 && !removedLater) {
        push({
          kind: "unreacted-metal",
          severity: "warn",
          title: `반응하지 않은 금속이 ${left.toLocaleString()}셀 남았습니다`,
          detail: "실리사이드 뒤에 금속을 걷어내는 단계가 없습니다",
          advice:
            "산화막 위에 남은 금속이 게이트와 소스·드레인을 잇습니다. " +
            "식각 단계를 붙이고 식각액을 '미반응 금속 제거'로 두면 실리사이드만 남습니다.",
        });
      }
    }

    /* -------------------------------------------------------------- CMP */
    if (node.type === "cmp") {
      const stop = lib.proc.byId.slurry[String(p.slurry)]?.stopOn ?? [];
      const hasStop = stop.some((k) => (prev?.counts[lib.mat.index[k]] ?? 0) > 0);
      if (!hasStop && f.changed.removed > 0) {
        push({
          kind: "cmp-no-stop",
          severity: "warn",
          title: "정지층 없이 연마했습니다",
          detail: `${f.changed.removed.toLocaleString()}셀 제거 · 슬러리 ${p.slurry}`,
          advice:
            "정지층이 없으면 제거량 노브가 그대로 결과가 됩니다. " +
            "실제 공정은 정지층을 두어 두께 편차를 흡수합니다.",
        });
      }
    }
  }

  /* -------------------------------------------------- 최종 구조에 대한 진단 */
  const last = frames[frames.length - 1];
  if (last && last.voidCount > 0) {
    out.push({
      kind: "voids-remain",
      severity: "warn",
      step: frames.length - 1,
      title: `최종 구조에 봉인된 보이드가 ${last.voidCount.toLocaleString()}셀 남았습니다`,
      detail: "바깥과 끊긴 빈 공간입니다",
      advice: "실제 소자에서는 신뢰성 문제(수분 갇힘·응력 집중)의 원인이 됩니다.",
    });
  }

  return out;
}

function totalDose(conc: Float32Array[]): number {
  let s = 0;
  for (const f of conc) for (let i = 0; i < f.length; i++) s += f[i];
  return s;
}

/** 심각도 순으로 정렬해 보여주기 좋게. 같은 심각도면 단계 순. */
export function sortDiagnostics(d: Diagnostic[]): Diagnostic[] {
  const rank: Record<Severity, number> = { error: 0, warn: 1, info: 2 };
  return [...d].sort((a, b) => rank[a.severity] - rank[b.severity] || a.step - b.step);
}

export function countBySeverity(d: Diagnostic[]): Record<Severity, number> {
  const c: Record<Severity, number> = { error: 0, warn: 0, info: 0 };
  for (const x of d) c[x.severity]++;
  return c;
}
