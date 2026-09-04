using System.Collections;
using UnityEngine;
using XNode;

[CreateNodeMenu("Process/Implantation/Anneal")]
public class AnnealingNode : BaseProcessNode
{
    [Tooltip("Anneal 시간 (step 반복 수)")]
    public int annealTime = 1;

    public override IEnumerator Execute()
    {
        var process = Object.FindObjectOfType<ImplantationProcess3D>();
        if (process == null)
        {
            Debug.LogError("[AnnealingNode] ImplantationProcess3D를 찾을 수 없습니다.");
            yield break;
        }

        Debug.Log($"[AnnealingNode] Anneal 시작 (Time: {annealTime})");
        yield return process.RunAnneal(annealTime);
    }
}
