#if UNITY_EDITOR
using UnityEditor;
using UnityEngine;
using XNodeEditor;
using System.Collections.Generic;
using System.Linq;

[CustomNodeEditor(typeof(EtchNode))]
public class EtchNodeEditor : NodeEditor
{
    public override void OnBodyGUI()
    {
        serializedObject.Update();
        EtchNode node = target as EtchNode;

        // EtchantConfig 이름 목록 가져오기
        List<string> etchantNames = new();
        var process = Object.FindObjectOfType<EtchProcess3D>();
        if (process != null && process.etchantConfigs != null)
        {
            etchantNames = process.etchantConfigs
                .Where(cfg => !string.IsNullOrEmpty(cfg.etchantName))
                .Select(cfg => cfg.etchantName)
                .ToList();
        }

        // Etchant 선택 UI
        int selectedIndex = Mathf.Max(0, etchantNames.IndexOf(node.etchantName));
        if (etchantNames.Count > 0)
        {
            selectedIndex = EditorGUILayout.Popup("에천트", selectedIndex, etchantNames.ToArray());
            node.etchantName = etchantNames[selectedIndex];
        }
        else
        {
            node.etchantName = EditorGUILayout.TextField("에천트 이름", node.etchantName);
            EditorGUILayout.HelpBox("EtchProcess3D에서 EtchantConfig 목록을 찾을 수 없습니다.", MessageType.Warning);
        }

        // 시간 입력 필드
        node.etchTime = EditorGUILayout.FloatField("에칭 시간 (초)", node.etchTime);

        // 입출력 포트 표시
        NodeEditorGUILayout.PropertyField(serializedObject.FindProperty("input"));
        NodeEditorGUILayout.PropertyField(serializedObject.FindProperty("output"));

        serializedObject.ApplyModifiedProperties();
    }
}
#endif
