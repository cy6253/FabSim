using System.Collections;
using UnityEngine;

[CreateNodeMenu("Process/Debug Log")]
public class DebugLogNode : BaseProcessNode
{
    public string message = "Hello from node!";

    public override IEnumerator Execute()
    {
        Debug.Log("[DebugNode] " + message);
        yield return null;
    }
}
