using System.Collections.Generic;
using System.Linq;
using UnityEngine;
using UnityEngine.UI;

public class MaterialToggleManager : MonoBehaviour
{
    [Header("외부 참조")]
    public DieGenerator3D generator;
    public DieLayerRenderer3D renderer;
    public MaterialColorRegistry colorRegistry;

    [Header("UI 설정")]
    public Toggle togglePrefab;
    public Transform toggleParent;          // MaterialScroll/Viewport/Content
    public GameObject materialPanel;        // MaterialScroll
    public Button materialToggleButton;     // Materials 버튼

    private Dictionary<string, bool> materialStates = new();

    void Start()
    {
        if (materialToggleButton != null)
            materialToggleButton.onClick.AddListener(ToggleMaterialPanel);
    }

    /// <summary>
    /// "Materials" 버튼 눌렀을 때 Scroll 패널 토글 및 토글 리스트 생성
    /// </summary>
    public void ToggleMaterialPanel()
    {
        if (materialPanel == null) return;

        bool nextState = !materialPanel.activeSelf;
        materialPanel.SetActive(nextState);

        if (nextState)
            PopulateToggles(); // 보일 때만 새로 생성
    }

    /// <summary>
    /// Scroll 안에 Toggle들을 채움
    /// </summary>
    public void PopulateToggles()
    {
        DieLayerMap3D die = generator.GetDieLayerMap();
        if (die == null) return;

        foreach (Transform child in toggleParent)
            Destroy(child.gameObject); // 기존 제거

        HashSet<string> materials = CollectMaterialNames(die);

        foreach (string mat in materials)
        {
            Toggle toggle = Instantiate(togglePrefab, toggleParent);
            toggle.GetComponentInChildren<Text>().text = mat;
            toggle.isOn = true;

            materialStates[mat] = true;

            toggle.onValueChanged.AddListener(isOn =>
            {
                OnMaterialToggleChanged(mat, isOn);
            });
        }

        ApplyToggleToRenderer();
    }

    public void OnMaterialToggleChanged(string material, bool isOn)
    {
        materialStates[material] = isOn;
        ApplyToggleToRenderer();
    }

    private void ApplyToggleToRenderer()
    {
        List<string> excluded = materialStates
            .Where(kv => !kv.Value)
            .Select(kv => kv.Key)
            .ToList();

        renderer.excludedMaterials = excluded;

        DieLayerMap3D die = generator.GetDieLayerMap();
        renderer.UpdateFromDie(die, colorRegistry, append: false);
    }

    private HashSet<string> CollectMaterialNames(DieLayerMap3D die)
    {
        HashSet<string> materials = new();
        foreach (var pos in die.AllPositions())
        {
            var layers = die.GetLayers(pos.x, pos.y, pos.z);
            foreach (var layer in layers)
                materials.Add(layer.material);

            var dopant = die.GetDopant(pos.x, pos.y, pos.z);
            if (!string.IsNullOrEmpty(dopant))
                materials.Add(dopant);
        }
        return materials;
    }
}
