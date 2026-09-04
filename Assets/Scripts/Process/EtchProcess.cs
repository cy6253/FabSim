using System.Collections;
using System.Collections.Generic;
using System.Linq;
using UnityEngine;
using UnityEngine.UI;

public class EtchProcess3D : MonoBehaviour
{
    [Header("Renderer 및 Etchant 목록")]
    public DieLayerRenderer3D renderer;
    public List<EtchantConfig> etchantConfigs;

    [Header("Animation Settings")]
    public float stepDelay = 0.05f; // seconds per step

    [Header("Progress UI")]
    public GameObject progressBarParent;
    public Image progressImage;
    public Text progressText;

    private DieLayerMap3D die;
    private Coroutine etchCoroutine;
    private const float epsilon = 0.0001f;

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

    void Start()
    {
        if (progressBarParent != null)
            progressBarParent.SetActive(false);

        RefreshDie();
    }

    private void RefreshDie()
    {
        var gen = FindObjectOfType<DieGenerator3D>();
        die = gen?.GetDieLayerMap();
    }

    /// <summary>
    /// 노드에서 호출 가능한 코루틴 기반 Etch 실행 함수
    /// </summary>
    public IEnumerator RunEtch(string etchantName, float seconds)
    {
        RefreshDie();
        if (die == null)
        {
            Debug.LogWarning("[EtchProcess] Die 가 존재하지 않습니다.");
            yield break;
        }

        var etchant = etchantConfigs.FirstOrDefault(e => e.etchantName == etchantName);
        if (etchant == null)
        {
            Debug.LogWarning($"[EtchProcess] Etchant '{etchantName}'를 찾을 수 없습니다.");
            yield break;
        }

        if (seconds <= 0f)
        {
            Debug.LogWarning("[EtchProcess] 시간은 0보다 커야 합니다.");
            yield break;
        }

        if (etchCoroutine != null)
        {
            StopCoroutine(etchCoroutine);
            etchCoroutine = null;
        }

        etchCoroutine = StartCoroutine(
            etchant.isDry
                ? DryEtchStepByStep(seconds, etchant)
                : WetEtchStepByStep(seconds, etchant)
        );

        yield return etchCoroutine;
        etchCoroutine = null;

        //Debug.Log("[EtchProcess] 노드 기반 Etch 완료");
    }
    private IEnumerator DryEtchStepByStep(float totalSeconds, EtchantConfig etchant)
    {
        int width = die.width;
        int height = die.height;

        int stepCount = Mathf.Max(1, Mathf.RoundToInt(totalSeconds));
        float secondsPerStep = 1.0f;

        ActivateProgressUI();

        for (int step = 0; step < stepCount; step++)
        {
            int removedCount = 0;

            for (int x = 0; x < width; x++)
            {
                for (int y = 0; y < height; y++)
                {
                    float remaining = etchant.baseRate * secondsPerStep;
                    bool etchBlocked = false;
                    int topZ = die.GetTopZ(x, y);

                    for (int z = topZ - 1; z >= 0 && remaining > epsilon; z--)
                    {
                        var layers = die.GetLayers(x, y, z);
                        if (layers.Count == 0) continue;

                        bool modified = false;
                        var updatedLayers = new List<Layer>(layers.Count);

                        foreach (var layer in layers)
                        {
                            float sel = etchant.GetSelectivity(layer.material);
                            if (sel <= 0f)
                            {
                                updatedLayers.Add(layer);
                                etchBlocked = true;
                                continue;
                            }

                            if (etchBlocked)
                            {
                                updatedLayers.Add(layer);
                                continue;
                            }

                            float effectiveRate = etchant.baseRate * sel;
                            float removal = effectiveRate * secondsPerStep;

                            if (removal >= layer.thickness - epsilon)
                            {
                                remaining -= layer.thickness / effectiveRate;
                                removedCount++;
                                modified = true;
                            }
                            else
                            {
                                float newThickness = layer.thickness - removal;
                                if (newThickness > epsilon)
                                    updatedLayers.Add(new Layer(layer.material, newThickness));

                                remaining = 0f;
                                modified = true;
                            }
                        }

                        if (modified)
                        {
                            die.RemoveAllAt(x, y, z, _ => true);
                            foreach (var l in updatedLayers)
                                die.AddLayer(x, y, z, l);
                            if (updatedLayers.Count == 0)
                                die.SetDopant(x, y, z, null);
                        }
                    }
                }
            }

            renderer?.UpdateFromDie(die, renderer.colorRegistry, append: true);
            UpdateProgressUI(step, stepCount);

            yield return new WaitForSeconds(stepDelay);
        }

        yield return new WaitForSeconds(0.5f);
        DeactivateProgressUI();

        etchCoroutine = null;
    }
    
    private IEnumerator WetEtchStepByStep(float totalTime, EtchantConfig etchant)
    {
        int maxSteps = 50;
        float stepTime = totalTime / maxSteps;
        float diffusionCoefficient = 0.5f;
        int removedCount = 0;

        ActivateProgressUI();

        var arrivalTimeMap = new float[die.width, die.height, die.depth];
        var visited = new bool[die.width, die.height, die.depth];
        var initialSurface = GetInitialEtchSurface(die, etchant);

        Queue<Vector3Int> frontier = new(initialSurface);
        foreach (var pos in initialSurface)
        {
            visited[pos.x, pos.y, pos.z] = true;
            arrivalTimeMap[pos.x, pos.y, pos.z] = 0f;
        }

        while (frontier.Count > 0)
        {
            var current = frontier.Dequeue();
            float currentTime = arrivalTimeMap[current.x, current.y, current.z];

            foreach (var dir in Directions18)
            {
                var neighbor = current + dir;
                if (!die.IsInBounds(neighbor.x, neighbor.y, neighbor.z)) continue;
                if (visited[neighbor.x, neighbor.y, neighbor.z]) continue;

                var layers = die.GetLayers(neighbor.x, neighbor.y, neighbor.z);
                if (!layers.Any(l => etchant.GetSelectivity(l.material) > 0f)) continue;

                arrivalTimeMap[neighbor.x, neighbor.y, neighbor.z] = currentTime + diffusionCoefficient;
                visited[neighbor.x, neighbor.y, neighbor.z] = true;
                frontier.Enqueue(neighbor);
            }
        }

        List<Vector3Int> visitedPositions = new();
        for (int x = 0; x < die.width; x++)
            for (int y = 0; y < die.height; y++)
                for (int z = 0; z < die.depth; z++)
                    if (visited[x, y, z])
                        visitedPositions.Add(new Vector3Int(x, y, z));

        for (int step = 0; step < maxSteps; step++)
        {
            float currentGlobalTime = step * stepTime;

            foreach (var pos in visitedPositions)
            {
                int x = pos.x;
                int y = pos.y;
                int z = pos.z;

                float arrival = arrivalTimeMap[x, y, z];
                float timeSinceArrival = currentGlobalTime - arrival;
                if (timeSinceArrival < 0f) continue;

                if (!IsUnblockedFromTop(x, y, z, etchant)) continue;

                var layers = die.GetLayers(x, y, z);
                if (!layers.Any(l => etchant.GetSelectivity(l.material) > 0f)) continue;

                float effectiveEtchTime = Mathf.Min(stepTime, totalTime - arrival);
                if (effectiveEtchTime <= 0f) continue;

                bool modified = false;
                List<Layer> updatedLayers = new();

                foreach (Layer layer in layers)
                {
                    float selectivity = etchant.GetSelectivity(layer.material);
                    if (selectivity <= 0f)
                    {
                        updatedLayers.Add(layer);
                        continue;
                    }

                    float removeThickness = etchant.baseRate * selectivity * effectiveEtchTime;

                    if (removeThickness >= layer.thickness - epsilon)
                    {
                        removedCount++;
                        modified = true;
                    }
                    else
                    {
                        float remaining = layer.thickness - removeThickness;
                        if (remaining > epsilon)
                            updatedLayers.Add(new Layer(layer.material, remaining));
                        modified = true;
                    }
                }

                if (modified)
                {
                    die.RemoveAllAt(x, y, z, _ => true);
                    foreach (var l in updatedLayers)
                        die.AddLayer(x, y, z, l);
                    if (updatedLayers.Count == 0)
                        die.SetDopant(x, y, z, null);
                }
            }

            renderer?.UpdateFromDie(die, renderer.colorRegistry, append: true);
            UpdateProgressUI(step, maxSteps);

            yield return new WaitForSeconds(stepDelay);
        }

        yield return new WaitForSeconds(0.5f);
        DeactivateProgressUI();

        etchCoroutine = null;
    }

    private void ActivateProgressUI()
    {
        if (progressBarParent != null)
            progressBarParent.SetActive(true);
        if (progressImage != null)
            progressImage.fillAmount = 0f;
        if (progressText != null)
            progressText.text = "0%";
    }

    private void UpdateProgressUI(int step, int stepCount)
    {
        float progress = (float)(step + 1) / stepCount;
        if (progressImage != null)
            progressImage.fillAmount = progress;
        if (progressText != null)
            progressText.text = Mathf.RoundToInt(progress * 100f) + "%";
    }

    private void DeactivateProgressUI()
    {
        if (progressBarParent != null)
            progressBarParent.SetActive(false);
    }

    private HashSet<Vector3Int> GetInitialEtchSurface(DieLayerMap3D die, EtchantConfig etchant)
    {
        HashSet<Vector3Int> surfaceSet = new();
        foreach (Vector3Int pos in die.AllPositions())
        {
            var layers = die.GetLayers(pos.x, pos.y, pos.z);
            if (!layers.Any(l => etchant.GetSelectivity(l.material) > 0f)) continue;

            foreach (var dir in Directions18)
            {
                Vector3Int neighbor = pos + dir;
                if (!die.IsInBounds(neighbor.x, neighbor.y, neighbor.z)) continue;
                if (die.GetLayers(neighbor.x, neighbor.y, neighbor.z).Count == 0)
                {
                    surfaceSet.Add(pos);
                    break;
                }
            }
        }
        return surfaceSet;
    }

    private bool IsUnblockedFromTop(int x, int y, int z, EtchantConfig etchant)
    {
        for (int zi = die.depth - 1; zi > z; zi--)
        {
            var upperLayers = die.GetLayers(x, y, zi);
            if (upperLayers.Any(l => etchant.GetSelectivity(l.material) > 0f))
                return false;
        }
        return true;
    }
}