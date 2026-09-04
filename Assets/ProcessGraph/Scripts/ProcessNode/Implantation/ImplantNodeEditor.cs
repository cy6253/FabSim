/*
#if UNITY_EDITOR
using UnityEditor;
using UnityEngine;
using XNodeEditor;
using System.Collections.Generic;
using System.IO;

[CustomNodeEditor(typeof(ImplantNode))]
public class ImplantNodeEditor : NodeEditor
{
    public override void OnBodyGUI()
    {
        serializedObject.Update();
        ImplantNode node = target as ImplantNode;

        // Dopant 이름 수동 입력
        node.dopantName = EditorGUILayout.TextField("Dopant", node.dopantName);

        // 마스크 파일 목록
        string[] maskFiles = Directory.GetFiles(Application.persistentDataPath, "*.png");
        List<string> maskNames = new();
        foreach (var file in maskFiles)
            maskNames.Add(Path.GetFileName(file));

        int selectedMask = Mathf.Max(0, maskNames.IndexOf(node.selectedMaskName));
        if (maskNames.Count > 0)
        {
            selectedMask = EditorGUILayout.Popup("Mask", selectedMask, maskNames.ToArray());
            node.selectedMaskName = maskNames[selectedMask];
        }
        else
        {
            EditorGUILayout.HelpBox("저장된 마스크 파일이 없습니다.", MessageType.Info);
            node.selectedMaskName = EditorGUILayout.TextField("Mask 이름", node.selectedMaskName);
        }

        node.implantDepth = EditorGUILayout.IntField("Implant 깊이", node.implantDepth);

        NodeEditorGUILayout.PropertyField(serializedObject.FindProperty("input"));
        NodeEditorGUILayout.PropertyField(serializedObject.FindProperty("output"));

        serializedObject.ApplyModifiedProperties();
    }
}
#endif
*/
#if UNITY_EDITOR
using UnityEditor;
using UnityEngine;
using XNodeEditor;
using System.Collections.Generic;
using System.IO;

[CustomNodeEditor(typeof(ImplantNode))]
public class ImplantNodeEditor : NodeEditor
{
    public override void OnBodyGUI()
    {
        serializedObject.Update();
        ImplantNode node = target as ImplantNode;

        // ImplantationProcess3D에서 dopant 리스트 가져오기
        List<string> dopantOptions = new();
        var process = Object.FindObjectOfType<ImplantationProcess3D>();
        if (process != null && process.dopantConfigs != null)
        {
            foreach (var config in process.dopantConfigs)
            {
                if (!string.IsNullOrEmpty(config.materialName))
                    dopantOptions.Add(config.materialName);
            }
        }

        int selectedIndex = Mathf.Max(0, dopantOptions.IndexOf(node.dopantName));
        if (dopantOptions.Count > 0)
        {
            selectedIndex = EditorGUILayout.Popup("Dopant", selectedIndex, dopantOptions.ToArray());
            node.dopantName = dopantOptions[selectedIndex];
        }
        else
        {
            node.dopantName = EditorGUILayout.TextField("Dopant (직접 입력)", node.dopantName);
            EditorGUILayout.HelpBox("사용 가능한 Dopant 목록을 찾을 수 없습니다.", MessageType.Warning);
        }

        // 마스크 파일 목록
        string[] maskFiles = Directory.GetFiles(Application.persistentDataPath, "*.png");
        List<string> maskNames = new();
        foreach (var file in maskFiles)
            maskNames.Add(Path.GetFileName(file));

        int selectedMask = Mathf.Max(0, maskNames.IndexOf(node.selectedMaskName));
        if (maskNames.Count > 0)
        {
            selectedMask = EditorGUILayout.Popup("Mask", selectedMask, maskNames.ToArray());
            node.selectedMaskName = maskNames[selectedMask];
        }
        else
        {
            EditorGUILayout.HelpBox("저장된 마스크 파일이 없습니다.", MessageType.Info);
            node.selectedMaskName = EditorGUILayout.TextField("Mask 이름", node.selectedMaskName);
        }

        node.implantDepth = EditorGUILayout.IntField("Implant 깊이", node.implantDepth);

        NodeEditorGUILayout.PropertyField(serializedObject.FindProperty("input"));
        NodeEditorGUILayout.PropertyField(serializedObject.FindProperty("output"));

        serializedObject.ApplyModifiedProperties();
    }
}
#endif
