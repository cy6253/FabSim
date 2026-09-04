using UnityEngine;
using System.Collections.Generic;

[CreateAssetMenu(fileName = "MaterialColorRegistry", menuName = "Configs/Material Color Registry")]
public class MaterialColorRegistry : ScriptableObject
{
    [System.Serializable]
    public struct MaterialColorEntry
    {
        public string name;
        public Color color;
    }

    public List<MaterialColorEntry> materialColors;

    private Dictionary<string, int> nameToId;
    private Dictionary<int, Color> idToColor;
    private Vector4[] cachedColorArray;

    public void Initialize()
    {
        if (nameToId != null && idToColor != null && cachedColorArray != null) return;

        nameToId = new();
        idToColor = new();

        for (int i = 0; i < materialColors.Count; i++)
        {
            nameToId[materialColors[i].name] = i;
            idToColor[i] = materialColors[i].color;
        }

        cachedColorArray = new Vector4[materialColors.Count];
        for (int i = 0; i < materialColors.Count; i++)
            cachedColorArray[i] = (Vector4)materialColors[i].color;
    }

    public int GetId(string materialName)
    {
        return nameToId != null && nameToId.TryGetValue(materialName, out var id) ? id : 0;
    }

    public Vector4[] GetColorArray() => cachedColorArray ?? new Vector4[0];
}