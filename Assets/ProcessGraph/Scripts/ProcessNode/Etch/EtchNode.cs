using System.Collections;
using UnityEngine;
using XNode;

[CreateNodeMenu("Process/Etch/Etch")]
public class EtchNode : BaseProcessNode
{
    [Tooltip("에천트 이름 (EtchantConfig에 등록된 이름)")]
    public string etchantName = "OxideEtchant";

    [Tooltip("에칭 시간 (초)")]
    public float etchTime = 1.0f;

    public override IEnumerator Execute()
    {
        var process = Object.FindObjectOfType<EtchProcess3D>();
        if (process == null)
        {
            Debug.LogError("[EtchNode] EtchProcess3D 컴포넌트를 찾을 수 없습니다.");
            yield break;
        }

        Debug.Log($"[EtchNode] 에칭 시작: {etchantName}, 시간: {etchTime}s");
        yield return process.RunEtch(etchantName, etchTime);
        Debug.Log("[EtchNode] 에칭 완료");
    }
}
