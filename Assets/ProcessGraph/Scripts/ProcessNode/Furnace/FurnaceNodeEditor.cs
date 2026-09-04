#if UNITY_EDITOR
using UnityEditor;
using UnityEngine;
using XNodeEditor;

[CustomNodeEditor(typeof(FurnaceNode))]
public class FurnaceNodeEditor : NodeEditor
{
    public override void OnBodyGUI()
    {
        serializedObject.Update();
        FurnaceNode node = target as FurnaceNode;

        node.furnaceTime = EditorGUILayout.IntField("Furnace ½Ã°£ (step ¼ö)", node.furnaceTime);

        NodeEditorGUILayout.PropertyField(serializedObject.FindProperty("input"));
        NodeEditorGUILayout.PropertyField(serializedObject.FindProperty("output"));

        serializedObject.ApplyModifiedProperties();
    }
}
#endif
