using System.Collections;
using UnityEngine;
using XNode;

[CreateNodeMenu("Process/Photo/PR Strip")]
public class PRStripNode : BaseProcessNode
{
    public override IEnumerator Execute()
    {
        var photo = Object.FindObjectOfType<PhotoProcess3D>();
        if (photo == null)
        {
            Debug.LogError("[PRStripNode] PhotoProcess3D를 찾을 수 없습니다.");
            yield break;
        }

        Debug.Log("[PRStripNode] PR 스트립 실행");
        yield return photo.RunPRStrip();
    }
}
