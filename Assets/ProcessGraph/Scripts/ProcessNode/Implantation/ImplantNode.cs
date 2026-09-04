using System.Collections;
using UnityEngine;
using XNode;

[CreateNodeMenu("Process/Implantation/Implant")]
public class ImplantNode : BaseProcessNode
{
    [Tooltip("Dopant 이름")]
    public string dopantName = "Boron";

    [Tooltip("Implant 깊이 (TopZ 기준)")]
    public int implantDepth = 1;

    [Tooltip("선택된 마스크 파일 이름")]
    public string selectedMaskName;

    public override IEnumerator Execute()
    {
        var imp = Object.FindObjectOfType<ImplantationProcess3D>();
        if (imp == null)
        {
            Debug.LogError("[ImplantNode] ImplantationProcess3D를 찾을 수 없습니다.");
            yield break;
        }

        Debug.Log($"[ImplantNode] Implant 실행 (dopant: {dopantName}, depth: {implantDepth}, mask: {selectedMaskName})");
        yield return imp.RunImplant(dopantName, implantDepth, selectedMaskName);
    }
}
