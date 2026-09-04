using XNode;
using System.Collections;
using UnityEngine;

public abstract class BaseProcessNode : Node
{
    [Input] public bool input;
    [Output] public bool output;

    public abstract IEnumerator Execute();
}
