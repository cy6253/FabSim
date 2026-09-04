"""골든 값 덤프 — 파이썬 참조 구현을 TypeScript 코어의 오라클로 쓰기 위한 다리.

프로젝트 검토(fabsim3d-project-review)가 테스트 층에 요구한 "파이썬 참조를
오라클로 삼는 골든 테스트"의 절반이다. 나머지 절반은
web/app/src/core/__tests__/golden.test.ts 가 이 파일이 뱉은 JSON을 읽어 대조한다.

무엇을 비교할 수 있고 무엇을 못 하는가:

* 순수 수식(Deal-Grove)은 **비트에 가깝게** 비교할 수 있다. 파이썬 float64와
  JS number가 둘 다 IEEE754 배정밀도이고 연산 순서도 같기 때문이다.
* 격자 시뮬레이션 결과는 **비트로 비교할 수 없다.** 파이썬은 float64 리스트로
  φ와 농도를 들고 JS는 Float32Array로 든다. 대신 파이썬이 검증한 *물리 주장*을
  값으로 적어 두고, TS 쪽이 같은 주장을 자기 격자에서 재현하는지 본다.

실행:  python golden_dump.py   →  golden.json 갱신
"""

import json
import os

import m2_thermal as TH
import m2_dope as DP


def deal_grove_table():
    """산화 두께 — 조건 × 시간 격자. TS의 dealGrove()와 자릿수까지 맞아야 한다."""
    rows = []
    for amb, temp in [("dry", 900), ("dry", 1000), ("dry", 1100),
                      ("wet", 900), ("wet", 1000), ("wet", 1100)]:
        for sec in [0.02, 0.5, 1, 4, 16, 64, 120, 600]:
            rows.append({
                "key": f"{amb}{temp}",
                "seconds": sec,
                "x0": 0.0,
                "x": TH.deal_grove(amb, temp, sec),
            })
    # x0 > 0 — 이미 산화막이 있는 웨이퍼를 다시 산화시키는 경우
    for x0 in [1.0, 5.0, 12.5]:
        for sec in [4, 60]:
            rows.append({
                "key": "wet1000",
                "seconds": sec,
                "x0": x0,
                "x": TH.deal_grove("wet", 1000, sec, x0),
            })
    return rows


def dg_coefficients():
    """계수표 자체. TS의 DG 상수가 참조와 어긋나면 여기서 잡힌다."""
    return {f"{a}{t}": list(v) for (a, t), v in TH.DG.items()}


def species_constants():
    """종별 상대 확산계수와 편석 계수."""
    return {
        "DREL": [DP.DREL[k] for k in sorted(DP.DREL)],
        "SEG_M": [TH.SEG_M[k] for k in sorted(TH.SEG_M)],
    }


def verified_claims():
    """파이썬이 수치로 확인한 물리 주장. TS가 자기 격자에서 재현해야 하는 것들.

    값은 파이썬 실행 결과 그대로이고, TS는 격자가 달라 같은 숫자가 나오지
    않는다. 그래서 각 항목에 '어떤 관계가 성립해야 하는가'를 함께 적는다 —
    테스트가 검사하는 것은 숫자가 아니라 관계다.
    """
    return [
        {
            "id": "deal-grove-regimes",
            "claim": "얇을 때 4배 시간이면 두께 약 4배(선형), 두꺼울 때는 약 2배(포물선)",
            "python": {"thin_ratio": 3.71, "thick_ratio": 2.10},
            "relation": "3.3 < thin_ratio <= 4.0 and 1.9 <= thick_ratio < 2.4",
        },
        {
            "id": "oxide-expansion",
            "claim": "성장/소비 비가 두께가 커질수록 1.17로 수렴한다 (부피비 2.17)",
            "python": {"ratios": [1.00, 1.50, 1.25, 1.12], "target": 1.17},
            "relation": "두꺼운 쪽 비율이 1.17 근처(±0.12)로 들어온다",
        },
        {
            "id": "nitride-mask",
            "claim": "질화막 아래는 산화가 거의 안 된다. 특수 처리 없이 P2만으로",
            "python": {"bare": 6624, "masked": 324},
            "relation": "bare > masked * 10",
        },
        {
            "id": "segregation",
            "claim": "붕소는 고갈(m<1), 비소는 파일업(m>1), 총량은 100% 보존",
            "python": {"boron_surface": 0.47, "arsenic_surface": 1.81, "kept": 1.0},
            "relation": "boron < 1 < arsenic 이고 총량 보존 오차 < 0.1%",
        },
        {
            "id": "implant-peak",
            "claim": "피크 깊이가 Rp와 정확히 일치하고, 도즈는 총량만 바꾼다",
            "python": {"rp_to_peak": [[4, 4], [10, 10]], "dose_linear": True},
            "relation": "peak == rp, 그리고 도즈 2.5배면 총량 2.5배",
        },
        {
            "id": "anneal-sigma",
            "claim": "자유 공간에서 sigma = sqrt(2*D*t), 오차 0%, 도즈 100% 보존",
            "python": {"Dt": 8, "sigma": 4.47, "err": 0.0},
            "relation": "sigma 오차 < 3%, 도즈 보존 오차 < 0.1%",
        },
        {
            "id": "anneal-species",
            "claim": "확산은 B > P > As 순서. 비소가 거의 안 움직여 얕은 접합에 쓴다",
            "python": {"B": 4.77, "P": 4.19, "As": 3.08},
            "relation": "sigma_B > sigma_P > sigma_As",
        },
        {
            "id": "silicide-self-aligned",
            "claim": "마스크 없이 산화막 패턴만으로 배치된다 (자기정렬)",
            "python": {"in_window": 1728, "over_oxide": 72},
            "relation": "in_window > over_oxide * 10",
        },
        {
            "id": "pr-planarisation",
            "claim": "평탄화 0/0.5/1.0 -> 윗면 편차가 단조 감소하고 1.0에서 0",
            "python": {"top_range": [17, 8, 0], "leaked": 0},
            "relation": "range[0] > range[1] > range[2] == 0, 보이드 유입 0",
        },
        {
            "id": "develop-complementary",
            "claim": "positive와 negative가 정확히 상보적",
            "python": {"positive": 11520, "negative": 29408, "total": 40928},
            "relation": "positive + negative == total",
        },
        {
            "id": "cmp-stop-layer",
            "claim": "정지층이 있으면 제거 0이고 그 지붕 아래는 전부 살아남는다",
            "python": {"removed": 0, "roofed_survived": 432},
            "relation": "정지층 지정 시 그 재질 제거 0",
        },
        {
            "id": "void-seal-freeze-reopen",
            "claim": "(a) 나쁜 커버리지가 보이드를 봉인 (b) 캡을 씌워도 셀 단위로 얼어붙음 (c) 식각이 되뚫음",
            "python": {"sealed": 519, "survived": 519, "filled": 0, "after_etch": 3},
            "relation": "봉인 셀이 전부 여전히 비어 있고, 식각 후 대부분 열림",
        },
    ]


def main():
    out = {
        "_generated_by": "web/reference/golden_dump.py",
        "_note": "손으로 고치지 말 것. python golden_dump.py 로 다시 만든다.",
        "dgCoefficients": dg_coefficients(),
        "dealGrove": deal_grove_table(),
        "species": species_constants(),
        "claims": verified_claims(),
    }
    path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "golden.json")
    with open(path, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, indent=2)
        f.write("\n")
    print(f"{path} 갱신")
    print(f"  Deal-Grove {len(out['dealGrove'])}건 · 계수 {len(out['dgCoefficients'])}조건 "
          f"· 검증된 주장 {len(out['claims'])}건")


if __name__ == "__main__":
    main()
