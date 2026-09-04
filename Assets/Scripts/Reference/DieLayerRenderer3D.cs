/*
using UnityEngine;
using System.Collections.Generic;

public class DieLayerRenderer3D : MonoBehaviour
{
    [Header("Mesh & Material")]
    public Mesh voxelMesh;
    public Material voxelMaterial;

    [Header("Material Color Registry")]
    public MaterialColorRegistry colorRegistry;

    public float voxelSize = 1f;

    private ComputeBuffer positionBuffer;
    private ComputeBuffer scaleBuffer;
    private ComputeBuffer materialIdBuffer;
    private ComputeBuffer argsBuffer;

    private Dictionary<Vector3Int, List<Voxel>> voxelMap = new();
    private int lastBufferCapacity = 0;
    private int lastVoxelCount = 0;

    public bool disableRendering = false;

    private readonly Dictionary<string, float> sharedThicknessMap = new();
    private readonly List<Voxel> allVoxels = new();

    private Vector3[] positionCache;
    private Vector3[] scaleCache;
    private int[] materialIdCache;

    public struct Voxel
    {
        public Vector3 position;
        public Vector3 scale;
        public int materialId;
    }

    public void UpdateFromDie(DieLayerMap3D die, MaterialColorRegistry colorRegistry, bool append = false)
    {
        if (die == null || colorRegistry == null) return;

        colorRegistry.Initialize();

        IEnumerable<Vector3Int> positions = append ? die.GetDirtyPositions() : die.AllPositions();

        if (!append)
            voxelMap.Clear();
        else
        {
            foreach (var pos in positions)
                voxelMap.Remove(pos);
        }

        foreach (var pos in positions)
        {
            var layers = die.GetLayers(pos.x, pos.y, pos.z);
            string dopant = die.GetDopant(pos.x, pos.y, pos.z);

            // 레이어도 없고 dopant도 없을 경우만 제외
            if (layers.Count == 0 && string.IsNullOrEmpty(dopant))
            {
                voxelMap.Remove(pos);
                continue;
            }

            sharedThicknessMap.Clear();

            foreach (var layer in layers)
            {
                if (!sharedThicknessMap.TryAdd(layer.material, layer.thickness))
                    sharedThicknessMap[layer.material] += layer.thickness;
            }

            var voxelsAtPos = new List<Voxel>(Mathf.Max(sharedThicknessMap.Count, 1));
            bool added = false;

            foreach (var kvp in sharedThicknessMap)
            {
                int matId = colorRegistry.GetId(kvp.Key);

                if (!string.IsNullOrEmpty(dopant))
                {
                    int dopantId = colorRegistry.GetId(dopant);
                    UnityEngine.Debug.Log($"[Renderer] pos({pos.x},{pos.y},{pos.z}) dopant = {dopant}, id = {dopantId}");
                    matId = dopantId;
                }

                voxelsAtPos.Add(new Voxel
                {
                    position = new Vector3(pos.x + 0.5f, pos.z + 0.5f, pos.y + 0.5f),
                    scale = new Vector3(1f, kvp.Value, 1f),
                    materialId = matId
                });
                added = true;
            }

            // dopant만 있고 layer가 없는 경우: 기본 1 voxel로 생성
            if (!added && !string.IsNullOrEmpty(dopant))
            {
                int dopantId = colorRegistry.GetId(dopant);
                UnityEngine.Debug.Log($"[Renderer] dopant only: pos({pos.x},{pos.y},{pos.z}) id = {dopantId}");

                voxelsAtPos.Add(new Voxel
                {
                    position = new Vector3(pos.x + 0.5f, pos.z + 0.5f, pos.y + 0.5f),
                    scale = new Vector3(1f, 1f, 1f),
                    materialId = dopantId
                });
            }

            voxelMap[pos] = voxelsAtPos;
        }

        die.ClearDirtyFlags();
        UpdateVoxels();
    }

    private void UpdateVoxels()
    {
        if (voxelMap.Count == 0 || colorRegistry == null) return;

        allVoxels.Clear();
        foreach (var pair in voxelMap)
            allVoxels.AddRange(pair.Value);

        int count = allVoxels.Count;
        if (count == 0) return;

        EnsureBuffers(count);

        for (int i = 0; i < count; i++)
        {
            var v = allVoxels[i];
            positionCache[i] = v.position;
            scaleCache[i] = v.scale;
            materialIdCache[i] = v.materialId;
        }

        positionBuffer.SetData(positionCache, 0, 0, count);
        scaleBuffer.SetData(scaleCache, 0, 0, count);
        materialIdBuffer.SetData(materialIdCache, 0, 0, count);

        voxelMaterial.SetVectorArray("_MaterialColors", colorRegistry.GetColorArray());
        voxelMaterial.SetBuffer("_Positions", positionBuffer);
        voxelMaterial.SetBuffer("_Scales", scaleBuffer);
        voxelMaterial.SetBuffer("_MaterialIds", materialIdBuffer);

        uint[] args = new uint[5]
        {
            voxelMesh.GetIndexCount(0),
            (uint)count,
            voxelMesh.GetIndexStart(0),
            voxelMesh.GetBaseVertex(0),
            0
        };
        argsBuffer.SetData(args);
    }

    private void EnsureBuffers(int count)
    {
        if (count > lastBufferCapacity)
        {
            ReleaseBuffers();
            CreateBuffers(count);
            lastBufferCapacity = count;
        }

        if (positionCache == null || positionCache.Length < count)
        {
            positionCache = new Vector3[count];
            scaleCache = new Vector3[count];
            materialIdCache = new int[count];
        }

        lastVoxelCount = count;
    }

    private void CreateBuffers(int count)
    {
        positionBuffer = new ComputeBuffer(count, sizeof(float) * 3);
        scaleBuffer = new ComputeBuffer(count, sizeof(float) * 3);
        materialIdBuffer = new ComputeBuffer(count, sizeof(int));

        argsBuffer = new ComputeBuffer(1, 5 * sizeof(uint), ComputeBufferType.IndirectArguments);
        uint[] args = new uint[5]
        {
            voxelMesh.GetIndexCount(0),
            (uint)count,
            voxelMesh.GetIndexStart(0),
            voxelMesh.GetBaseVertex(0),
            0
        };
        argsBuffer.SetData(args);
    }

    void Update()
    {
        if (disableRendering || argsBuffer == null || voxelMaterial == null || voxelMap.Count == 0) return;

        Graphics.DrawMeshInstancedIndirect(
            voxelMesh, 0, voxelMaterial,
            new Bounds(Vector3.zero, Vector3.one * 10000f),
            argsBuffer
        );
    }

    void OnDestroy() => ReleaseBuffers();

    private void ReleaseBuffers()
    {
        positionBuffer?.Release();
        scaleBuffer?.Release();
        materialIdBuffer?.Release();
        argsBuffer?.Release();

        positionBuffer = null;
        scaleBuffer = null;
        materialIdBuffer = null;
        argsBuffer = null;

        lastBufferCapacity = 0;
        lastVoxelCount = 0;
    }
}
*/

using UnityEngine;
using System.Collections.Generic;

public class DieLayerRenderer3D : MonoBehaviour
{
    [Header("Mesh & Material")]
    public Mesh voxelMesh;
    public Material voxelMaterial;

    [Header("Material Color Registry")]
    public MaterialColorRegistry colorRegistry;

    public float voxelSize = 1f;

    private ComputeBuffer positionBuffer;
    private ComputeBuffer scaleBuffer;
    private ComputeBuffer materialIdBuffer;
    private ComputeBuffer argsBuffer;

    private Dictionary<Vector3Int, List<Voxel>> voxelMap = new();
    private int lastBufferCapacity = 0;
    private int lastVoxelCount = 0;

    public bool disableRendering = false;

    private readonly Dictionary<string, float> sharedThicknessMap = new();
    private readonly List<Voxel> allVoxels = new();
    // 필터링할 재료 목록 (렌더링 제외 대상)
    public List<string> excludedMaterials = new();

    private Vector3[] positionCache;
    private Vector3[] scaleCache;
    private int[] materialIdCache;

    public struct Voxel
    {
        public Vector3 position;
        public Vector3 scale;
        public int materialId;
    }

    public void UpdateFromDie(DieLayerMap3D die, MaterialColorRegistry colorRegistry, bool append = false)
    {
        if (die == null || colorRegistry == null) return;

        colorRegistry.Initialize();

        IEnumerable<Vector3Int> positions = append ? die.GetDirtyPositions() : die.AllPositions();

        if (!append)
            voxelMap.Clear();
        else
        {
            foreach (var pos in positions)
                voxelMap.Remove(pos);
        }

        foreach (var pos in positions)
        {
            var layers = die.GetLayers(pos.x, pos.y, pos.z);
            string dopant = die.GetDopant(pos.x, pos.y, pos.z);

            // 레이어도 없고 dopant도 없을 경우만 제외
            if (layers.Count == 0 && string.IsNullOrEmpty(dopant))
            {
                voxelMap.Remove(pos);
                continue;
            }

            sharedThicknessMap.Clear();

            foreach (var layer in layers)
            {
                if (!sharedThicknessMap.TryAdd(layer.material, layer.thickness))
                    sharedThicknessMap[layer.material] += layer.thickness;
            }

            var voxelsAtPos = new List<Voxel>(Mathf.Max(sharedThicknessMap.Count, 1));
            bool added = false;

            foreach (var kvp in sharedThicknessMap)
            {
                // 필터링된 재료는 렌더링에서 제외
                if (excludedMaterials.Contains(kvp.Key)) continue;

                int matId = colorRegistry.GetId(kvp.Key);

                // dopant 우선 적용
                if (!string.IsNullOrEmpty(dopant))
                {
                    int dopantId = colorRegistry.GetId(dopant);
                    matId = dopantId;
                }

                voxelsAtPos.Add(new Voxel
                {
                    position = new Vector3(pos.x + 0.5f, pos.z + 0.5f, pos.y + 0.5f),
                    scale = new Vector3(1f, kvp.Value, 1f),
                    materialId = matId
                });

                added = true;
            }


            // dopant만 있고 layer가 없는 경우: 기본 1 voxel로 생성
            if (!added && !string.IsNullOrEmpty(dopant))
            {
                if (excludedMaterials.Contains(dopant)) continue;

                int dopantId = colorRegistry.GetId(dopant);

                voxelsAtPos.Add(new Voxel
                {
                    position = new Vector3(pos.x + 0.5f, pos.z + 0.5f, pos.y + 0.5f),
                    scale = new Vector3(1f, 1f, 1f),
                    materialId = dopantId
                });
            }


            voxelMap[pos] = voxelsAtPos;
        }

        die.ClearDirtyFlags();
        UpdateVoxels();
    }

    private void UpdateVoxels()
    {
        if (voxelMap.Count == 0 || colorRegistry == null) return;

        allVoxels.Clear();
        foreach (var pair in voxelMap)
            allVoxels.AddRange(pair.Value);

        int count = allVoxels.Count;
        if (count == 0) return;

        EnsureBuffers(count);

        for (int i = 0; i < count; i++)
        {
            var v = allVoxels[i];
            positionCache[i] = v.position;
            scaleCache[i] = v.scale;
            materialIdCache[i] = v.materialId;
        }

        positionBuffer.SetData(positionCache, 0, 0, count);
        scaleBuffer.SetData(scaleCache, 0, 0, count);
        materialIdBuffer.SetData(materialIdCache, 0, 0, count);

        voxelMaterial.SetVectorArray("_MaterialColors", colorRegistry.GetColorArray());
        voxelMaterial.SetBuffer("_Positions", positionBuffer);
        voxelMaterial.SetBuffer("_Scales", scaleBuffer);
        voxelMaterial.SetBuffer("_MaterialIds", materialIdBuffer);

        uint[] args = new uint[5]
        {
            voxelMesh.GetIndexCount(0),
            (uint)count,
            voxelMesh.GetIndexStart(0),
            voxelMesh.GetBaseVertex(0),
            0
        };
        argsBuffer.SetData(args);
    }

    private void EnsureBuffers(int count)
    {
        if (count > lastBufferCapacity)
        {
            ReleaseBuffers();
            CreateBuffers(count);
            lastBufferCapacity = count;
        }

        if (positionCache == null || positionCache.Length < count)
        {
            positionCache = new Vector3[count];
            scaleCache = new Vector3[count];
            materialIdCache = new int[count];
        }

        lastVoxelCount = count;
    }

    private void CreateBuffers(int count)
    {
        positionBuffer = new ComputeBuffer(count, sizeof(float) * 3);
        scaleBuffer = new ComputeBuffer(count, sizeof(float) * 3);
        materialIdBuffer = new ComputeBuffer(count, sizeof(int));

        argsBuffer = new ComputeBuffer(1, 5 * sizeof(uint), ComputeBufferType.IndirectArguments);
        uint[] args = new uint[5]
        {
            voxelMesh.GetIndexCount(0),
            (uint)count,
            voxelMesh.GetIndexStart(0),
            voxelMesh.GetBaseVertex(0),
            0
        };
        argsBuffer.SetData(args);
    }

    void Update()
    {
        if (disableRendering || argsBuffer == null || voxelMaterial == null || voxelMap.Count == 0) return;

        Graphics.DrawMeshInstancedIndirect(
            voxelMesh, 0, voxelMaterial,
            new Bounds(Vector3.zero, Vector3.one * 10000f),
            argsBuffer
        );
    }

    void OnDestroy() => ReleaseBuffers();

    private void ReleaseBuffers()
    {
        positionBuffer?.Release();
        scaleBuffer?.Release();
        materialIdBuffer?.Release();
        argsBuffer?.Release();

        positionBuffer = null;
        scaleBuffer = null;
        materialIdBuffer = null;
        argsBuffer = null;

        lastBufferCapacity = 0;
        lastVoxelCount = 0;
    }
}