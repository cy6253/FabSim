using System.Collections;
using System.Collections.Generic;
using UnityEngine;
using UnityEngine.UI;
using System.Threading.Tasks;
using System.Collections.Concurrent;

public class ConformalDepositionProcess3D : MonoBehaviour
{
    [Header("렌더링")]
    public DieLayerRenderer3D renderer;
    public MaterialColorRegistry colorRegistry;

    [Header("Deposition Rates")]
    public List<DepositionRateConfig> depositionRateConfigs;

    [Header("애니메이션 설정")]
    public float stepDelay = 0.05f;

    [Header("진행 상태 UI")]
    public GameObject progressBarParent;
    public Image progressImage;
    public Text progressText;

    private Dictionary<string, DepositionRateConfig> rateLookup;
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
    /* Full Deposition
    private static readonly Vector3Int[] Directions26 = Get26Directions();
    private static Vector3Int[] Get26Directions()
    {
        List<Vector3Int> list = new();
        for (int x = -1; x <= 1; x++)
            for (int y = -1; y <= 1; y++)
                for (int z = -1; z <= 1; z++)
                {
                    if (x == 0 && y == 0 && z == 0)
                        continue; // 자기 자신 제외
                    list.Add(new Vector3Int(x, y, z));
                }
        return list.ToArray();
    }
    */
    void Awake()
    {
        rateLookup = new();
        foreach (var config in depositionRateConfigs)
        {
            if (!string.IsNullOrEmpty(config.materialName))
                rateLookup[config.materialName] = config;
        }

        if (progressBarParent != null)
            progressBarParent.SetActive(false);
    }

    public IEnumerator RunDeposition(string materialName, float timeSeconds)
    {
        var gen = FindObjectOfType<DieGenerator3D>();
        if (gen == null) yield break;

        var die = gen.GetDieLayerMap();
        if (die == null) yield break;

        if (!rateLookup.TryGetValue(materialName, out var config))
        {
            Debug.LogWarning($"[Deposition] 재료 '{materialName}'의 deposition rate 설정을 찾을 수 없습니다.");
            yield break;
        }

        if (timeSeconds <= 0f)
        {
            Debug.LogWarning("[Deposition] 시간 값이 0 이하입니다.");
            yield break;
        }

        int steps = Mathf.Clamp(Mathf.RoundToInt(config.depositionRate * timeSeconds), 1, 100);
        HashSet<Vector3Int> currentSurface = GetInitialSurface(die);
        HashSet<Vector3Int> totalTargets = new();

        if (progressBarParent != null) progressBarParent.SetActive(true);
        if (progressImage != null) progressImage.fillAmount = 0f;
        if (progressText != null) progressText.text = "0%";

        for (int i = 0; i < steps; i++)
        {
            ConcurrentDictionary<Vector3Int, Layer> pending = new();

            // 병렬로 탐색
            Parallel.ForEach(currentSurface, pos =>
            {
                foreach (var dir in Directions18)
                {
                    Vector3Int neighbor = pos + dir;

                    if (!die.IsInBounds(neighbor.x, neighbor.y, neighbor.z)) continue;
                    if (die.GetLayers(neighbor.x, neighbor.y, neighbor.z).Count > 0) continue;
                    if (totalTargets.Contains(neighbor)) continue;

                    // 병렬 안전하게 예약 저장
                    pending.TryAdd(neighbor, new Layer(materialName, 1f));
                }
            });

            // 실제 레이어 추가는 메인 스레드에서 일괄 처리
            HashSet<Vector3Int> nextSurface = new();
            foreach (var kvp in pending)
            {
                Vector3Int p = kvp.Key;
                if (totalTargets.Add(p))
                {
                    die.AddLayer(p.x, p.y, p.z, kvp.Value);
                    nextSurface.Add(p);
                }
            }

            renderer?.UpdateFromDie(die, colorRegistry, append: true);
            yield return null;

            currentSurface = nextSurface;
            if (currentSurface.Count == 0) break;

            float progress = (float)(i + 1) / steps;
            if (progressImage != null) progressImage.fillAmount = progress;
            if (progressText != null) progressText.text = Mathf.RoundToInt(progress * 100f) + "%";

            yield return new WaitForSeconds(stepDelay);
        }

        if (progressImage != null) progressImage.fillAmount = 1f;
        if (progressText != null) progressText.text = "100%";
        yield return new WaitForSeconds(0.5f);
        if (progressBarParent != null) progressBarParent.SetActive(false);

        //Debug.Log($"[Deposition] {materialName} 증착 완료 ({timeSeconds}초 동안)");
    }

    private HashSet<Vector3Int> GetInitialSurface(DieLayerMap3D die)
    {
        HashSet<Vector3Int> surface = new();
        foreach (var pos in die.AllPositions())
        {
            foreach (var dir in Directions18)
            {
                Vector3Int neighbor = pos + dir;
                if (die.IsInBounds(neighbor.x, neighbor.y, neighbor.z) &&
                    die.GetLayers(neighbor.x, neighbor.y, neighbor.z).Count == 0)
                {
                    surface.Add(pos);
                    break;
                }
            }
        }
        return surface;
    }
}