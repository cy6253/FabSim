#if UNITY_EDITOR
using UnityEditor;
using UnityEngine;
using XNodeEditor;

[CustomNodeEditor(typeof(AnnealingNode))]
public class AnnealingNodeEditor : NodeEditor
{
    public override void OnBodyGUI()
    {
        serializedObject.Update();
        AnnealingNode node = target as AnnealingNode;

        node.annealTime = EditorGUILayout.IntField("Anneal ½Ã°£ (step)", node.annealTime);

        NodeEditorGUILayout.PropertyField(serializedObject.FindProperty("input"));
        NodeEditorGUILayout.PropertyField(serializedObject.FindProperty("output"));

        serializedObject.ApplyModifiedProperties();
    }
}
#endif
