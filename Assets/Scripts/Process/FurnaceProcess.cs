using System.Collections;
using System.Collections.Generic;
using UnityEngine;
using UnityEngine.UI;

public class FurnaceProcess3D : MonoBehaviour
{
    [Header("Renderer")]
    public DieLayerRenderer3D renderer;
    public MaterialColorRegistry colorRegistry;

    [Header("Animation Settings")]
    public float stepDelay = 0.05f;

    [Header("Progress UI")]
    public GameObject progressBarParent;
    public Image progressImage;
    public Text progressText;

    [Header("Salicide 허용 금속")]
    public List<string> salicideCapableMetals;

    private DieLayerMap3D die;

    public IEnumerator RunFurnace(int time)
    {
        var gen = FindObjectOfType<DieGenerator3D>();
        die = gen?.GetDieLayerMap();
        if (die == null)
        {
            Debug.LogWarning("[Furnace] Die가 존재하지 않습니다.");
            yield break;
        }

        if (time <= 0)
        {
            Debug.LogWarning("[Furnace] time 값은 0보다 커야 합니다.");
            yield break;
        }

        if (progressBarParent != null) progressBarParent.SetActive(true);
        if (progressImage != null) progressImage.fillAmount = 0f;
        if (progressText != null) progressText.text = "0%";

        for (int step = 0; step < time; step++)
        {
            ApplyFurnaceStep(1);
            renderer?.UpdateFromDie(die, colorRegistry, append: true);

            float progress = (float)(step + 1) / time;
            if (progressImage != null) progressImage.fillAmount = progress;
            if (progressText != null) progressText.text = Mathf.RoundToInt(progress * 100f) + "%";

            yield return new WaitForSeconds(stepDelay);
        }

        if (progressImage != null) progressImage.fillAmount = 1f;
        if (progressText != null) progressText.text = "100%";
        yield return new WaitForSeconds(0.5f);
        if (progressBarParent != null) progressBarParent.SetActive(false);
    }
    private void ApplyFurnaceStep(int time)
    {
        for (int x = 0; x < die.width; x++)
        {
            for (int y = 0; y < die.height; y++)
            {
                int topZ = die.GetTopZ(x, y);
                int applied = 0;

                for (int z = topZ; z >= 0 && applied < time; z--)
                {
                    var layers = die.GetLayers(x, y, z);
                    if (layers.Count == 0 || layers[^1].material != "Si") continue;

                    string above = null;
                    if (die.IsInBounds(x, y, z + 1))
                    {
                        var aboveLayers = die.GetLayers(x, y, z + 1);
                        if (aboveLayers.Count > 0)
                            above = aboveLayers[^1].material;
                    }

                    // Salicide 조건: 위에 금속이 있고, 허용된 경우
                    if (!string.IsNullOrEmpty(above) && salicideCapableMetals.Contains(above))
                    {
                        string metalSi = above + "Si";
                        die.RemoveAllAt(x, y, z, _ => true);
                        die.AddLayer(x, y, z, new Layer(metalSi, 1f));

                        die.RemoveAllAt(x, y, z + 1, _ => true);
                        die.AddLayer(x, y, z + 1, new Layer(metalSi, 1f));

                        applied++;
                    }
                    // Oxidation 조건: 위가 비어 있는 경우
                    else if (string.IsNullOrEmpty(above))
                    {
                        die.RemoveAllAt(x, y, z, _ => true);
                        die.AddLayer(x, y, z, new Layer("SiO2", 1f));

                        if (die.IsInBounds(x, y, z + 1) && die.GetLayers(x, y, z + 1).Count == 0)
                            die.AddLayer(x, y, z + 1, new Layer("SiO2", 1f));

                        applied++;
                    }
                }
            }
        }
    }

    /*
    private void ApplyFurnaceStep()
    {
        int width = die.width;
        int height = die.height;

        for (int x = 0; x < width; x++)
        {
            for (int y = 0; y < height; y++)
            {
                int topZ = die.GetTopZ(x, y);
                for (int z = topZ; z >= 0; z--) // z+1 접근 가능하게
                {
                    var layers = die.GetLayers(x, y, z);
                    if (layers.Count == 0 || layers[^1].material != "Si")
                        continue;

                    string topMaterial = null;
                    if (die.IsInBounds(x, y, z + 1))
                    {
                        var above = die.GetLayers(x, y, z + 1);
                        if (above.Count > 0)
                            topMaterial = above[^1].material;
                    }

                    // ----- Salicide 조건 -----
                    if (!string.IsNullOrEmpty(topMaterial) && salicideCapableMetals.Contains(topMaterial))
                    {
                        string salicideName = topMaterial + "Si";

                        // z: Si → salicide
                        die.RemoveAllAt(x, y, z, _ => true);
                        die.AddLayer(x, y, z, new Layer(salicideName, 1f));

                        // z+1: metal → salicide
                        die.RemoveAllAt(x, y, z + 1, _ => true);
                        die.AddLayer(x, y, z + 1, new Layer(salicideName, 1f));
                        break;
                    }

                    // ----- Oxidation 조건 -----
                    if (string.IsNullOrEmpty(topMaterial))
                    {
                        // z: Si → SiO2
                        die.RemoveAllAt(x, y, z, _ => true);
                        die.AddLayer(x, y, z, new Layer("SiO2", 1f));

                        // z+1: SiO2 추가
                        if (die.IsInBounds(x, y, z + 1))
                        {
                            var above = die.GetLayers(x, y, z + 1);
                            if (above.Count == 0)
                                die.AddLayer(x, y, z + 1, new Layer("SiO2", 1f));
                        }
                        break;
                    }
                }
            }
        }
    }
    */
}
