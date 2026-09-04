using System.Collections;
using UnityEngine;
using XNode;

[CreateNodeMenu("Process/Photo/PR Coating")]
public class PRCoatingNode : BaseProcessNode
{
    [Tooltip("PR 두께")]
    public int prThickness = 1;

    public override IEnumerator Execute()
    {
        var photo = Object.FindObjectOfType<PhotoProcess3D>();
        if (photo == null)
        {
            Debug.LogWarning("[PRCoatingNode] PhotoProcess3D가 없습니다.");
            yield break;
        }

        Debug.Log($"[PRCoatingNode] PR 코팅 실행 (두께 = {prThickness})");
        yield return photo.RunPRCoating(prThickness);
    }
}
