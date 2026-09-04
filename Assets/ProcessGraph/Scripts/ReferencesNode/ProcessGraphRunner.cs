/*
using System.Collections;
using UnityEngine;

public class ProcessGraphRunner : MonoBehaviour
{
    public ProcessGraph graph;

    public void RunGraph()
    {
        StartCoroutine(RunRoutine());
    }

    private IEnumerator RunRoutine()
    {
        foreach (var node in graph.nodes)
        {
            if (node is BaseProcessNode processNode)
                yield return processNode.Execute();
        }
    }
}
*/

using System.Collections;
using System.Collections.Generic;
using UnityEngine;
using System.Linq;
using XNode;

public class ProcessGraphRunner : MonoBehaviour
{
    public ProcessGraph graph;

    public void RunGraph()
    {
        if (graph == null)
        {
            Debug.LogError("[ProcessGraphRunner] 그래프가 할당되지 않았습니다.");
            return;
        }

        StartCoroutine(RunFromGenerateDieNode());
    }

    private IEnumerator RunFromGenerateDieNode()
    {
        var visited = new HashSet<BaseProcessNode>();

        var root = FindGenerateDieNode();
        if (root == null)
        {
            Debug.LogError("[Runner] GenerateDieNode를 찾을 수 없습니다.");
            yield break;
        }

        // root에서 연결된 노드만 수집
        var reachableNodes = new HashSet<BaseProcessNode>();
        CollectConnectedNodes(root, reachableNodes);

        Debug.Log($"[Runner] 연결된 노드 수: {reachableNodes.Count}");

        yield return RunNodeRecursive(root, visited, reachableNodes);
    }

    private BaseProcessNode FindGenerateDieNode()
    {
        foreach (var node in graph.nodes.OfType<GenerateDieNode>())
        {
            return node;
        }

        return null;
    }

    private void CollectConnectedNodes(BaseProcessNode node, HashSet<BaseProcessNode> visited)
    {
        if (node == null || visited.Contains(node))
            return;

        visited.Add(node);

        var output = node.GetOutputPort("output");
        if (output != null && output.IsConnected)
        {
            foreach (var connection in output.GetConnections())
            {
                if (connection.node is BaseProcessNode next)
                {
                    var input = next.GetInputPort("input");

                    // 정확히 연결된 경우만
                    if (input != null && input.IsConnected &&
                        input.GetConnections().Contains(output))
                    {
                        CollectConnectedNodes(next, visited);
                    }
                }
            }
        }
    }

    private IEnumerator RunNodeRecursive(BaseProcessNode node, HashSet<BaseProcessNode> visited, HashSet<BaseProcessNode> allowed)
    {
        if (node == null || visited.Contains(node) || !allowed.Contains(node))
            yield break;

        visited.Add(node);
        Debug.Log($"[Runner] 실행 중: {node.name}");

        yield return node.Execute();

        var output = node.GetOutputPort("output");
        if (output != null && output.IsConnected)
        {
            foreach (var connection in output.GetConnections())
            {
                if (connection.node is BaseProcessNode nextNode)
                {
                    var inputPort = nextNode.GetInputPort("input");

                    if (inputPort != null && inputPort.IsConnected &&
                        inputPort.GetConnections().Contains(output))
                    {
                        yield return RunNodeRecursive(nextNode, visited, allowed);
                    }
                }
            }
        }
    }
}
