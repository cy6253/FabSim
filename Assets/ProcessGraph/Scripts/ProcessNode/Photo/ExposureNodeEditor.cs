#if UNITY_EDITOR
using UnityEditor;
using XNodeEditor;
using UnityEngine;
using System.IO;
using System.Collections.Generic;

[CustomNodeEditor(typeof(ExposureNode))]
public class PhotoExposureNodeEditor : NodeEditor
{
    public override void OnBodyGUI()
    {
        serializedObject.Update();
        ExposureNode node = target as ExposureNode;

        string[] files = Directory.GetFiles(Application.persistentDataPath, "Mask_*.png");
        List<string> options = new List<string>();
        foreach (string file in files)
        {
            options.Add(Path.GetFileName(file));
        }

        int selectedIndex = Mathf.Max(0, options.IndexOf(node.selectedMaskName));
        if (options.Count == 0)
        {
            EditorGUILayout.HelpBox("마스크 파일이 없습니다.", MessageType.Warning);
        }
        else
        {
            selectedIndex = EditorGUILayout.Popup("Mask 선택", selectedIndex, options.ToArray());
            node.selectedMaskName = options[selectedIndex];
        }

        NodeEditorGUILayout.PropertyField(serializedObject.FindProperty("input"));
        NodeEditorGUILayout.PropertyField(serializedObject.FindProperty("output"));

        serializedObject.ApplyModifiedProperties();
    }
}
#endif
