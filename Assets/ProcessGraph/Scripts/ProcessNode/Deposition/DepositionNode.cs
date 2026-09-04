using System.Collections;
using UnityEngine;
using XNode;

[CreateNodeMenu("Process/Deposition/Deposition")]
public class DepositionNode : BaseProcessNode
{
    [Tooltip("재료 이름")]
    public string materialName = "Oxide";

    [Tooltip("증착 시간 (초)")]
    public float depositionTime = 1f;

    public override IEnumerator Execute()
    {
        var deposition = Object.FindObjectOfType<ConformalDepositionProcess3D>();
        if (deposition == null)
        {
            Debug.LogError("[DepositionNode] ConformalDepositionProcess3D를 찾을 수 없습니다.");
            yield break;
        }

        Debug.Log($"[DepositionNode] 증착 시작: {materialName}, 시간: {depositionTime}s");
        yield return deposition.RunDeposition(materialName, depositionTime);
        Debug.Log("[DepositionNode] 증착 완료");
    }
}
