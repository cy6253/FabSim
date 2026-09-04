using UnityEngine;
using UnityEngine.UI;
using XNode;

#if UNITY_EDITOR
using UnityEditor;
using XNodeEditor;
#endif

[RequireComponent(typeof(ProcessGraphRunner))]
public class RuntimeGraphUI : MonoBehaviour
{
    [Header("공정 그래프 연결")]
    public ProcessGraph graph;

    [Header("UI 버튼")]
    public Button openEditorButton;
    public Button runGraphButton;

    private ProcessGraphRunner graphRunner;

#if UNITY_EDITOR
    private NodeEditorWindow editorWindow;
#endif

    private void Awake()
    {
        graphRunner = GetComponent<ProcessGraphRunner>();

        if (openEditorButton != null)
            openEditorButton.onClick.AddListener(ToggleEditor);

        if (runGraphButton != null)
            runGraphButton.onClick.AddListener(Run);
    }

    public void ToggleEditor()
    {
#if UNITY_EDITOR
        if (graph == null)
        {
            Debug.LogWarning("[RuntimeGraphUI] 그래프가 할당되지 않았습니다.");
            return;
        }

        if (editorWindow == null)
        {
            editorWindow = NodeEditorWindow.Open(graph);
        }
        else
        {
            if (EditorWindow.HasOpenInstances<NodeEditorWindow>())
            {
                editorWindow.Close();
                editorWindow = null;
            }
            else
            {
                editorWindow = NodeEditorWindow.Open(graph);
            }
        }
#else
        Debug.LogWarning("에디터 창은 에디터 환경에서만 열 수 있습니다.");
#endif
    }

    public void Run()
    {
        if (graph == null)
        {
            Debug.LogWarning("[RuntimeGraphUI] 실행할 그래프가 없습니다.");
            return;
        }

        if (graphRunner == null)
        {
            Debug.LogError("[RuntimeGraphUI] GraphRunner 컴포넌트를 찾을 수 없습니다.");
            return;
        }

        graphRunner.graph = graph;
        graphRunner.RunGraph();
    }
}
