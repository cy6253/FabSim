using System.Collections;
using System.Collections.Generic;
using UnityEngine;
using UnityEngine.UI;
using System.Linq;
using System.Threading.Tasks;

public class CmpProcess3D : MonoBehaviour
{
    [Header("Renderer")]
    public DieLayerRenderer3D renderer;
    public MaterialColorRegistry colorRegistry;

    [Header("CMP Rate Configs")]
    public List<CmpRateConfig> cmpRateConfigs;

    [Header("Animation Settings")]
    public float stepDelay = 0.05f; // seconds per step

    [Header("Progress UI")]
    public GameObject progressBarParent;
    public Image progressImage;
    public Text progressText;

    private DieLayerMap3D die;
    private Dictionary<string, CmpRateConfig> rateLookup;
    private Coroutine cmpCoroutine;
    private const float epsilon = 0.0001f;

    void Awake()
    {
        rateLookup = new();
        foreach (var config in cmpRateConfigs)
        {
            if (!string.IsNullOrEmpty(config.slurryName))
                rateLookup[config.slurryName] = config;
        }

        if (progressBarParent != null)
            progressBarParent.SetActive(false);
    }

    public IEnumerator RunCMP(string slurryName, int cmpTime)
    {
        if (!rateLookup.TryGetValue(slurryName, out var config))
        {
            Debug.LogError($"[CMP] 등록되지 않은 slurry 이름: {slurryName}");
            yield break;
        }

        if (cmpTime <= 0)
        {
            Debug.LogWarning("[CMP] CMP 시간은 0보다 커야 합니다.");
            yield break;
        }

        if (cmpCoroutine != null)
        {
            StopCoroutine(cmpCoroutine);
            cmpCoroutine = null;
        }

        cmpCoroutine = StartCoroutine(CMPStepByStep(config, cmpTime));
        yield return cmpCoroutine;
        cmpCoroutine = null;
    }

    private IEnumerator CMPStepByStep(CmpRateConfig config, int cmpTime)
    {
        var gen = FindObjectOfType<DieGenerator3D>();
        die = gen?.GetDieLayerMap();
        if (die == null) yield break;

        int steps = cmpTime;
        float stepTime = 1f;
        int removedCount = 0;

        if (progressBarParent != null) progressBarParent.SetActive(true);
        if (progressImage != null) progressImage.fillAmount = 0f;
        if (progressText != null) progressText.text = "0%";

        for (int step = 0; step < steps; step++)
        {
            int globalTopZ = 0;
            for (int x = 0; x < die.width; x++)
                for (int y = 0; y < die.height; y++)
                    globalTopZ = Mathf.Max(globalTopZ, die.GetTopZ(x, y));

            int localRemoved = 0;

            // 병렬 처리 시작 (x,y 포지션을 flat index로 구성)
            Parallel.For(0, die.width * die.height, index =>
            {
                int x = index / die.height;
                int y = index % die.height;

                int localTopZ = die.GetTopZ(x, y);
                if (localTopZ < globalTopZ || AllTopMaterialsUnremovable(x, y, globalTopZ, config))
                    return;

                float remaining = config.baseRate * stepTime;

                for (int z = localTopZ - 1; z >= 0 && remaining > 0f; z--)
                {
                    var layers = die.GetLayers(x, y, z);
                    if (layers.Count == 0) continue;

                    var updated = new List<Layer>();
                    bool modified = false;

                    foreach (var layer in layers)
                    {
                        float sel = config.GetSelectivity(layer.material);
                        if (sel <= 0f)
                        {
                            updated.Add(layer);
                            continue;
                        }

                        float removal = config.baseRate * sel * stepTime;
                        if (removal >= layer.thickness - epsilon)
                        {
                            remaining -= layer.thickness;
                            modified = true;
                            System.Threading.Interlocked.Increment(ref localRemoved);
                        }
                        else
                        {
                            float remain = layer.thickness - removal;
                            if (remain > epsilon)
                                updated.Add(new Layer(layer.material, remain));
                            remaining = 0f;
                            modified = true;
                        }
                    }

                    if (modified)
                    {
                        die.RemoveAllAt(x, y, z, _ => true);
                        foreach (var l in updated)
                            die.AddLayer(x, y, z, l);
                    }
                }
            });

            removedCount += localRemoved;

            renderer?.UpdateFromDie(die, colorRegistry, append: true);

            float progress = (float)(step + 1) / steps;
            if (progressImage != null)
                progressImage.fillAmount = progress;
            if (progressText != null)
                progressText.text = Mathf.RoundToInt(progress * 100f) + "%";

            yield return new WaitForSeconds(stepDelay);
        }

        if (progressImage != null) progressImage.fillAmount = 1f;
        if (progressText != null) progressText.text = "100%";
        yield return new WaitForSeconds(0.5f);
        if (progressBarParent != null) progressBarParent.SetActive(false);

        //Debug.Log($"[CMP] 반복 평탄화 완료. 제거된 레이어 수: {removedCount:N0}");
    }

    private bool AllTopMaterialsUnremovable(int x, int y, int z, CmpRateConfig config)
    {
        var layers = die.GetLayers(x, y, z - 1);
        foreach (var layer in layers)
        {
            if (config.GetSelectivity(layer.material) > 0f)
                return false;
        }
        return true;
    }
}
