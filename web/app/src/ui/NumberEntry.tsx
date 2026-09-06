/**
 * 숫자 하나 — 쳐 넣을 수도 있고 끌 수도 있다.
 *
 * 예전에는 슬라이더뿐이었다. 값을 훑어보기에는 좋지만 "두께 40"처럼 아는 값을
 * 넣으려면 픽셀을 맞춰야 했고, 폰에서는 그게 거의 불가능했다. 반대로 입력칸만
 * 두면 훑어보기가 사라진다 — 노브를 돌리며 결과가 따라 변하는 것이 이 앱의
 * 핵심이라 그건 잃으면 안 된다. 그래서 둘 다 둔다.
 *
 * 타이핑 중인 글자를 따로 들고 있는 이유: 값에서 바로 문자열을 만들면 "0.5"를
 * 치는 도중 "0."이 숫자 0으로 되돌아가 소수점을 못 찍는다. 초안은 그대로 두고
 * 숫자로 읽히는 순간마다 값을 넘긴다 — 치는 동안에도 화면이 따라온다.
 *
 * 단계 인스펙터의 노브와 3D 도구줄의 절단이 같은 것을 쓴다. 같은 모양의 조작이
 * 화면마다 다르게 움직이면 그것만으로 배울 것이 하나 늘어난다.
 */
import { useState } from "react";

export function NumberEntry(p: {
  value: number;
  min: number;
  max: number;
  step: number;
  /** 자동일 때는 값 대신 이 말이 흐리게 뜬다. */
  placeholder?: string;
  /** 좁게 쓸 자리를 위해. 도구줄의 절단 칸이 이걸 쓴다. */
  className?: string;
  title?: string;
  onChange: (v: number) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const clamp = (v: number) => Math.max(p.min, Math.min(p.max, v));
  return (
    <input
      type="number"
      className={p.className}
      title={p.title}
      min={p.min}
      max={p.max}
      step={p.step}
      placeholder={p.placeholder}
      value={draft ?? (p.placeholder ? "" : String(p.value))}
      onChange={(e) => {
        setDraft(e.target.value);
        const n = Number(e.target.value);
        if (e.target.value !== "" && Number.isFinite(n)) p.onChange(clamp(n));
      }}
      onBlur={() => setDraft(null)}
    />
  );
}
