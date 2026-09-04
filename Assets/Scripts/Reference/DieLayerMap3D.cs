using System;
using System.Collections.Generic;
using UnityEngine;

public class DieLayerMap3D
{
    public readonly int width;
    public readonly int height;
    public readonly int depth;

    private readonly List<Layer>[] voxelGridFlat;
    private readonly bool[] dirtyFlagsFlat;
    private readonly string[] dopantMapFlat;

    private static readonly IReadOnlyList<Layer> EmptyList = new List<Layer>(0);

    public DieLayerMap3D(int width, int height, int depth)
    {
        this.width = width;
        this.height = height;
        this.depth = depth;

        int size = width * height * depth;
        voxelGridFlat = new List<Layer>[size];
        dirtyFlagsFlat = new bool[size];
        dopantMapFlat = new string[size];
    }

    private int ToFlatIndex(int x, int y, int z)
        => x + width * (y + height * z);

    public bool IsInBounds(int x, int y, int z)
        => x >= 0 && x < width && y >= 0 && y < height && z >= 0 && z < depth;

    public void AddLayer(int x, int y, int z, Layer layer)
    {
        if (!IsInBounds(x, y, z)) return;

        int index = ToFlatIndex(x, y, z);
        var list = voxelGridFlat[index];
        if (list == null)
        {
            list = new List<Layer>(1);
            voxelGridFlat[index] = list;
        }

        list.Add(layer);
        dirtyFlagsFlat[index] = true;
    }

    public List<Layer> GetLayers(int x, int y, int z)
    {
        if (!IsInBounds(x, y, z)) return (List<Layer>)EmptyList;

        int index = ToFlatIndex(x, y, z);
        return voxelGridFlat[index] ?? (List<Layer>)EmptyList;
    }

    public void RemoveAll(Predicate<Layer> match)
    {
        for (int i = 0; i < voxelGridFlat.Length; i++)
        {
            var list = voxelGridFlat[i];
            if (list == null) continue;

            int removed = list.RemoveAll(match);
            if (removed > 0)
            {
                dirtyFlagsFlat[i] = true;
                if (list.Count == 0)
                {
                    voxelGridFlat[i] = null;
                }
            }
        }
    }

    public void RemoveAllAt(int x, int y, int z, Predicate<Layer> match)
    {
        if (!IsInBounds(x, y, z)) return;

        int index = ToFlatIndex(x, y, z);
        var list = voxelGridFlat[index];
        if (list == null) return;

        int removed = list.RemoveAll(match);
        if (removed > 0)
        {
            dirtyFlagsFlat[index] = true;
            if (list.Count == 0)
            {
                voxelGridFlat[index] = null;
            }
        }
    }
    public IEnumerable<Vector3Int> AllPositions()
    {
        for (int z = 0; z < depth; z++)
        {
            for (int y = 0; y < height; y++)
            {
                for (int x = 0; x < width; x++)
                {
                    int index = ToFlatIndex(x, y, z);
                    var list = voxelGridFlat[index];
                    string dopant = dopantMapFlat[index];
                    if ((list != null && list.Count > 0) || !string.IsNullOrEmpty(dopant))
                        yield return new Vector3Int(x, y, z);
                }
            }
        }
    }

    public IEnumerable<Vector3Int> GetDirtyPositions()
    {
        for (int z = 0; z < depth; z++)
        {
            for (int y = 0; y < height; y++)
            {
                for (int x = 0; x < width; x++)
                {
                    int index = ToFlatIndex(x, y, z);
                    if (dirtyFlagsFlat[index])
                        yield return new Vector3Int(x, y, z);
                }
            }
        }
    }

    public void ClearDirtyFlags()
    {
        Array.Clear(dirtyFlagsFlat, 0, dirtyFlagsFlat.Length);
    }
    public int GetTopZ(int x, int y)
    {
        for (int z = depth - 1; z >= 0; z--)
        {
            int index = ToFlatIndex(x, y, z);
            var list = voxelGridFlat[index];
            if (list != null && list.Count > 0)
                return z + 1;
        }
        return 0;
    }

    public void SetDopant(int x, int y, int z, string dopant)
    {
        if (!IsInBounds(x, y, z)) return;

        int index = ToFlatIndex(x, y, z);
        dopantMapFlat[index] = dopant;
        dirtyFlagsFlat[index] = true;
    }

    public string GetDopant(int x, int y, int z)
    {
        if (!IsInBounds(x, y, z)) return null;
        return dopantMapFlat[ToFlatIndex(x, y, z)];
    }
}
