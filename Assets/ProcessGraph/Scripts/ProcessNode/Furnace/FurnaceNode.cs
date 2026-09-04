using System.Collections;
using System.Collections.Generic;
using UnityEngine;
using XNode;

[CreateNodeMenu("Process/Furnace/Furnace")]
public class FurnaceNode : BaseProcessNode
{
    [Tooltip("Furnace 공정 시간 (step 수)")]
    public int furnaceTime = 3;

    [Tooltip("Salicide 반응 가능한 금속 목록")]
    public List<string> salicideMetals = new();

    public override IEnumerator Execute()
    {
        var furnace = Object.FindObjectOfType<FurnaceProcess3D>();
        if (furnace == null)
        {
            Debug.LogError("[FurnaceNode] FurnaceProcess3D를 찾을 수 없습니다.");
            yield break;
        }

        // 노드 설정 → FurnaceProcess3D에 반영
        furnace.salicideCapableMetals = new List<string>(salicideMetals);

        Debug.Log($"[FurnaceNode] Furnace 실행 시작 (Time: {furnaceTime}, Salicide 금속: {string.Join(", ", salicideMetals)})");
        yield return furnace.RunFurnace(furnaceTime);
        Debug.Log("[FurnaceNode] Furnace 공정 완료");
    }
}
