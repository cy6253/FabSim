using System.Collections;
using UnityEngine;
using XNode;

[CreateNodeMenu("Process/Photo/Exposure")]
public class ExposureNode : BaseProcessNode
{
    [Tooltip("선택된 마스크 파일 이름")]
    public string selectedMaskName;

    public override IEnumerator Execute()
    {
        var photo = Object.FindObjectOfType<PhotoProcess3D>();
        var maskDesigner = Object.FindObjectOfType<MaskDesigner3D>();

        if (photo == null || maskDesigner == null)
        {
            Debug.LogError("[ExposureNode] 필요한 컴포넌트를 찾을 수 없습니다.");
            yield break;
        }

        // 마스크 로딩
        maskDesigner.LoadMask(selectedMaskName);

        Debug.Log($"[ExposureNode] 노광 시작 (마스크: {selectedMaskName})");
        yield return photo.RunExposure();
    }
}
