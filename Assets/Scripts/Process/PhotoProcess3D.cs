using System.Collections;
using System.Collections.Generic;
using UnityEngine;

public class PhotoProcess3D : MonoBehaviour
{
    [Header("렌더러 및 마스크 디자이너")]
    public DieLayerRenderer3D renderer;
    public MaskDesigner3D maskDesigner;
    public MaterialColorRegistry colorRegistry;

    private bool[,] exposedMask;
    private bool[,] prMask;
    private DieLayerMap3D die;

    private int prThickness = GlobalConfig.DefaultPRThickness;

    // 노드 기반 PR 코팅 실행용 코루틴
    public IEnumerator RunPRCoating(int thickness)
    {
        prThickness = Mathf.Max(1, thickness);
        OnPRCoatingClicked();
        yield return null;
    }

    // 노드 기반 노광 실행용 코루틴
    public IEnumerator RunExposure()
    {
        OnExposureClicked();
        yield return null;
    }

    // 노드 기반 현상 실행용 코루틴
    public IEnumerator RunDevelop()
    {
        OnDevelopClicked();
        yield return null;
    }

    // 노드 기반 PR 제거 실행용 코루틴
    public IEnumerator RunPRStrip()
    {
        OnPRStripClicked();
        yield return null;
    }
    public void OnPRCoatingClicked()
    {
        die = GetDie();
        if (die == null) return;

        int width = die.width;
        int height = die.height;
        prMask = new bool[width, height];
        Layer prLayer = new("PR", 1f);

        for (int x = 0; x < width; x++)
        {
            for (int y = 0; y < height; y++)
            {
                int topZ = die.GetTopZ(x, y);

                for (int dz = 0; dz < prThickness; dz++)
                {
                    int z = topZ + dz;
                    if (!die.IsInBounds(x, y, z)) break;

                    var layers = die.GetLayers(x, y, z);
                    if (layers.Exists(l => l.material == "PR")) continue;

                    die.AddLayer(x, y, z, prLayer);
                }

                prMask[x, y] = true;
            }
        }

        //Debug.Log($"[Photo] PR 코팅 완료: 두께={prThickness}");
        renderer?.UpdateFromDie(die, colorRegistry, append: true);
    }

    public void OnExposureClicked()
    {
        exposedMask = maskDesigner?.GetMaskData(die.width, die.height);
        die = GetDie();
        if (die == null || exposedMask == null) return;

        int width = die.width;
        int height = die.height;

        for (int x = 0; x < width; x++)
        {
            for (int y = 0; y < height; y++)
            {
                if (!exposedMask[x, y]) continue;

                int topZ = die.GetTopZ(x, y);
                for (int z = 0; z < topZ; z++)
                {
                    var layers = die.GetLayers(x, y, z);
                    if (layers.Count == 0) continue;

                    bool modified = false;
                    List<Layer> updated = new();

                    foreach (var l in layers)
                    {
                        if (l.material == "PR")
                        {
                            updated.Add(new Layer("Exposed_PR", l.thickness));
                            modified = true;
                        }
                        else
                        {
                            updated.Add(l);
                        }
                    }

                    if (modified)
                    {
                        die.RemoveAllAt(x, y, z, _ => true);
                        foreach (var l in updated)
                            die.AddLayer(x, y, z, l);
                    }
                }
            }
        }

        maskDesigner?.CloseWindow();
        //Debug.Log("[Photo] 노광 완료");
        renderer?.UpdateFromDie(die, colorRegistry, append: true);
    }

    public void OnDevelopClicked()
    {
        die = GetDie();
        if (die == null || exposedMask == null) return;

        int width = die.width;
        int height = die.height;
        int removedCount = 0;

        for (int x = 0; x < width; x++)
        {
            for (int y = 0; y < height; y++)
            {
                if (!exposedMask[x, y]) continue;

                int topZ = die.GetTopZ(x, y);
                for (int z = 0; z < topZ; z++)
                {
                    var layers = die.GetLayers(x, y, z);
                    if (layers.Exists(l => l.material == "Exposed_PR"))
                    {
                        int beforeCount = layers.Count;
                        die.RemoveAllAt(x, y, z, l => l.material == "Exposed_PR");
                        removedCount += (beforeCount - die.GetLayers(x, y, z).Count);
                    }
                }

                if (prMask != null && x < prMask.GetLength(0) && y < prMask.GetLength(1))
                    prMask[x, y] = false;
            }
        }

        //Debug.Log($"[Photo] 현상 완료. 제거된 레이어 수: {removedCount:N0}");
        exposedMask = null;
        renderer?.UpdateFromDie(die, colorRegistry, append: true);
    }


    public void OnPRStripClicked()
    {
        die = GetDie();
        if (die == null) return;

        die.RemoveAll(l => l.material == "PR" || l.material == "Exposed_PR");

        prMask = null;
        exposedMask = null;

        //Debug.Log("[Photo] PR 스트립 완료");
        renderer?.UpdateFromDie(die, colorRegistry, append: true);
    }

    private DieLayerMap3D GetDie()
    {
        if (die != null) return die;

        var gen = FindObjectOfType<DieGenerator3D>();
        if (gen == null)
        {
            //Debug.LogWarning("[Photo] DieGenerator3D가 없습니다.");
            return null;
        }

        return die = gen.GetDieLayerMap();
    }
}