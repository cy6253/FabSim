#if UNITY_EDITOR
using UnityEditor;
using UnityEngine;
using XNodeEditor;
using System.Collections.Generic;

[CustomNodeEditor(typeof(CMPNode))]
public class CMPNodeEditor : NodeEditor
{
    public override void OnBodyGUI()
    {
        serializedObject.Update();
        CMPNode node = target as CMPNode;

        // Slurry 이름 목록 가져오기
        var cmp = Object.FindObjectOfType<CmpProcess3D>();
        List<string> slurryOptions = new();

        if (cmp != null && cmp.cmpRateConfigs != null)
        {
            foreach (var cfg in cmp.cmpRateConfigs)
            {
                if (!string.IsNullOrEmpty(cfg.slurryName))
                    slurryOptions.Add(cfg.slurryName);
            }
        }

        int selectedIndex = Mathf.Max(0, slurryOptions.IndexOf(node.slurryName));
        if (slurryOptions.Count > 0)
        {
            selectedIndex = EditorGUILayout.Popup("Slurry", selectedIndex, slurryOptions.ToArray());
            node.slurryName = slurryOptions[selectedIndex];
        }
        else
        {
            node.slurryName = EditorGUILayout.TextField("Slurry 이름", node.slurryName);
            EditorGUILayout.HelpBox("Slurry 설정(CmpRateConfig)을 찾을 수 없습니다.", MessageType.Warning);
        }

        node.cmpTime = EditorGUILayout.IntField("CMP 시간 (step 수)", node.cmpTime);

        NodeEditorGUILayout.PropertyField(serializedObject.FindProperty("input"));
        NodeEditorGUILayout.PropertyField(serializedObject.FindProperty("output"));

        serializedObject.ApplyModifiedProperties();
    }
}
#endif
