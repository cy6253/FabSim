using System;
using System.Collections.Generic;

[Serializable]
public class EtchantConfig
{
    public string etchantName;
    public bool isDry;
    public float baseRate; // 기준 재료의 Etch 속도

    public List<SelectivityEntry> selectivityTable;

    [Serializable]
    public class SelectivityEntry
    {
        public string materialName;     // 예: "Oxide", "PR", "Nitride"
        public float relativeRatio;     // 예: 1.0 (기준), 0.1 (10배 느림)
    }

    public float GetSelectivity(string materialName)
    {
        var entry = selectivityTable.Find(e => e.materialName == materialName);
        return entry != null ? entry.relativeRatio : 0f;
    }
}
