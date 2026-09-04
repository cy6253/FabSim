using System.Collections.Generic;
using UnityEngine;
using System.Collections;
using System.Threading.Tasks;

public class ImplantationProcess3D : MonoBehaviour
{
    [Header("외부 참조")]
    public MaskDesigner3D maskDesigner;
    public DieLayerRenderer3D renderer;
    public MaterialColorRegistry colorRegistry;

    [Header("Deposition Rates")]
    public List<DopantConfig> dopantConfigs;

    private DieLayerMap3D die;
    private bool[,] mask;
    private Dictionary<string, DopantConfig> rateLookup;
    private static readonly Vector3Int[] Directions18 = Get18Directions();

    private static Vector3Int[] Get18Directions()
    {
        List<Vector3Int> list = new();
        for (int x = -1; x <= 1; x++)
            for (int y = -1; y <= 1; y++)
                for (int z = -1; z <= 1; z++)
                {
                    int sum = Mathf.Abs(x) + Mathf.Abs(y) + Mathf.Abs(z);
                    if (sum >= 1 && sum <= 2)
                        list.Add(new Vector3Int(x, y, z));
                }
        return list.ToArray();
    }
    void Awake()
    {
        rateLookup = new();
        foreach (var config in dopantConfigs)
        {
            if (!string.IsNullOrEmpty(config.materialName))
                rateLookup[config.materialName] = config;
        }
    }
    /// <summary>
    /// 외부 노드에서 호출 가능한 이온주입 실행용 코루틴
    /// </summary>
    public IEnumerator RunImplant(string dopant, int depth, string maskName)
    {

        die = GetDie();
        if (die == null)
        {
            Debug.LogWarning("[Implantation] Die가 존재하지 않음");
            yield break;
        }

        if (maskDesigner == null)
        {
            Debug.LogWarning("[Implantation] maskDesigner가 null입니다.");
            yield break;
        }

        maskDesigner.LoadMask(maskName);
        mask = maskDesigner.GetMaskData(die.width, die.height);
        if (mask == null)
        {
            Debug.LogWarning("[Implantation] 마스크 데이터 없음");
            yield break;
        }

        if (string.IsNullOrEmpty(dopant))
        {
            Debug.LogWarning("[Implantation] Dopant 미지정");
            yield break;
        }

        if (depth < 0)
        {
            Debug.LogWarning("[Implantation] 잘못된 depth");
            yield break;
        }

        ApplyImplantation(dopant, depth);
        renderer?.UpdateFromDie(die, colorRegistry, append: true);

        //Debug.Log($"[Implantation] {dopant} implanted at depth {depth}");

        yield return null;
    }

    /// <summary>
    /// 외부 노드에서 호출 가능한 Anneal 확산 실행용 코루틴
    /// </summary>
    public IEnumerator RunAnneal(int time)
    {
        if (time <= 0)
        {
            Debug.LogWarning("[Anneal] 시간은 0 이상이어야 합니다.");
            yield break;
        }

        AnnealDopants(time);
        yield return null;
    }

    void ApplyImplantation(string dopant, int depth)
    {
        int width = die.width;
        int height = die.height;

        Parallel.For(0, width * height, index =>
        {
            int x = index / height;
            int y = index % height;

            if (!mask[x, y]) return;

            int topZ = die.GetTopZ(x, y);
            int targetZ = topZ - depth;

            if (!die.IsInBounds(x, y, targetZ))
            {
                // Unity main thread가 아니라서 Log 출력은 제한적
                return;
            }

            die.SetDopant(x, y, targetZ, dopant);
        });
    }

    public void AnnealDopants(int time)
    {
        if (die == null) die = GetDie();
        if (die == null)
        {
            Debug.LogWarning("[Anneal] die is null");
            return;
        }

        string[,,] current = new string[die.width, die.height, die.depth];
        for (int x = 0; x < die.width; x++)
            for (int y = 0; y < die.height; y++)
                for (int z = 0; z < die.depth; z++)
                    current[x, y, z] = die.GetDopant(x, y, z);

        for (int t = 0; t < time; t++)
        {
            for (int x = 0; x < die.width; x++)
            {
                for (int y = 0; y < die.height; y++)
                {
                    for (int z = 0; z < die.depth; z++)
                    {
                        string dopant = current[x, y, z];
                        if (string.IsNullOrEmpty(dopant)) continue;

                        foreach (var dir in Directions18)
                        {
                            int nx = x + dir.x;
                            int ny = y + dir.y;
                            int nz = z + dir.z;

                            if (!die.IsInBounds(nx, ny, nz)) continue;
                            if (string.IsNullOrEmpty(die.GetDopant(nx, ny, nz)))
                            {
                                die.SetDopant(nx, ny, nz, dopant);
                            }
                        }
                    }
                }
            }
        }

        renderer?.UpdateFromDie(die, colorRegistry, append: true);
        //Debug.Log($"[Anneal] 확산 완료 (Time = {time})");
    }

    private DieLayerMap3D GetDie()
    {
        if (die != null) return die;

        var gen = FindObjectOfType<DieGenerator3D>();
        if (gen == null)
        {
            Debug.LogWarning("[Implantation] DieGenerator3D가 없습니다.");
            return null;
        }

        return die = gen.GetDieLayerMap();
    }
}
