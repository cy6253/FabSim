using System.Collections;
using UnityEngine;
using XNode;

[CreateNodeMenu("Process/Generate Die")]
public class GenerateDieNode : BaseProcessNode
{
    public override IEnumerator Execute()
    {
        var generator = Object.FindObjectOfType<DieGenerator3D>();
        if (generator == null)
        {
            Debug.LogError("[GenerateDieNode] DieGenerator3D를 찾을 수 없습니다.");
            yield break;
        }

        yield return generator.RunGenerateAndRender(); // 이제 코루틴 흐름 보장됨
        Debug.Log("[GenerateDieNode] Die 생성 완료");
    }
}
