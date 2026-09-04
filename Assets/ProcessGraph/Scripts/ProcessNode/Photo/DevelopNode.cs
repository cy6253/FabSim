using System.Collections;
using UnityEngine;
using XNode;

[CreateNodeMenu("Process/Photo/Development")]
public class DevelopNode : BaseProcessNode
{
    public override IEnumerator Execute()
    {
        var photo = Object.FindObjectOfType<PhotoProcess3D>();
        if (photo == null)
        {
            Debug.LogError("[DevelopNode] PhotoProcess3D를 찾을 수 없습니다.");
            yield break;
        }

        Debug.Log("[DevelopNode] 현상 실행");
        yield return photo.RunDevelop();
    }
}
