using System;
using System.Collections.Generic;

[Serializable]
public class CmpRateConfig
{
    public string slurryName;
    public float baseRate; // 기준 재료 제거 속도

    [Serializable]
    public class SelectivityEntry
    {
        public string materialName;
        public float relativeRate;
    }

    public List<SelectivityEntry> selectivityTable;

    public float GetSelectivity(string materialName)
    {
        var entry = selectivityTable.Find(e => e.materialName == materialName);
        return entry != null ? entry.relativeRate : 0f;
    }
}
