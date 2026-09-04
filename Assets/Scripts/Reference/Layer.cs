using System;

[Serializable]
public struct Layer
{
    public string material;
    public float thickness;

    public Layer(string material, float thickness)
    {
        this.material = material;
        this.thickness = thickness;
    }
}