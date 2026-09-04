using System.Collections;
using UnityEngine;
using XNode;

[CreateNodeMenu("Process/CMP/CMP")]
public class CMPNode : BaseProcessNode
{
    [Tooltip("CMP에서 사용할 Slurry 이름 (CmpRateConfig에 등록된 이름)")]
    public string slurryName = "Oxide_Slurry";

    [Tooltip("CMP 시간 (step 반복 수, 정수)")]
    public int cmpTime = 5;

    public override IEnumerator Execute()
    {
        var cmp = Object.FindObjectOfType<CmpProcess3D>();
        if (cmp == null)
        {
            Debug.LogError("[CMPNode] CmpProcess3D를 찾을 수 없습니다.");
            yield break;
        }

        Debug.Log($"[CMPNode] CMP 실행 시작 (Slurry: {slurryName}, Time: {cmpTime})");
        yield return cmp.RunCMP(slurryName, cmpTime);
        Debug.Log("[CMPNode] CMP 완료");
    }
}
