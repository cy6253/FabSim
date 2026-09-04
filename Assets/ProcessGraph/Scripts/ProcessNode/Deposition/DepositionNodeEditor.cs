#if UNITY_EDITOR
using UnityEditor;
using UnityEngine;
using XNodeEditor;
using System.Collections.Generic;

[CustomNodeEditor(typeof(DepositionNode))]
public class DepositionNodeEditor : NodeEditor
{
    public override void OnBodyGUI()
    {
        serializedObject.Update();
        DepositionNode node = target as DepositionNode;

        // ConformalDepositionProcess3D에서 재료 목록 수동 로딩
        List<string> materialOptions = new();
        var process = Object.FindObjectOfType<ConformalDepositionProcess3D>();
        if (process != null && process.depositionRateConfigs != null)
        {
            foreach (var config in process.depositionRateConfigs)
            {
                if (!string.IsNullOrEmpty(config.materialName))
                    materialOptions.Add(config.materialName);
            }
        }

        int selectedIndex = Mathf.Max(0, materialOptions.IndexOf(node.materialName));
        if (materialOptions.Count > 0)
        {
            selectedIndex = EditorGUILayout.Popup("재료", selectedIndex, materialOptions.ToArray());
            node.materialName = materialOptions[selectedIndex];
        }
        else
        {
            node.materialName = EditorGUILayout.TextField("재료 (직접 입력)", node.materialName);
            EditorGUILayout.HelpBox("Deposition 재료 목록을 찾을 수 없습니다.", MessageType.Warning);
        }

        node.depositionTime = EditorGUILayout.FloatField("증착 시간 (초)", node.depositionTime);

        NodeEditorGUILayout.PropertyField(serializedObject.FindProperty("input"));
        NodeEditorGUILayout.PropertyField(serializedObject.FindProperty("output"));

        serializedObject.ApplyModifiedProperties();
    }
}
#endif
