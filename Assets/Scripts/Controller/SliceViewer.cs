using UnityEngine;
using UnityEngine.UI;
using System.Collections.Generic;

public class SliceViewer3D : MonoBehaviour
{
    [Header("UI Components")]
    public Dropdown planeDropdown;
    public InputField coordinateInput;
    public Button previewButton;
    public Button confirmButton;
    public RawImage sliceImage;

    [Header("Cross-Section UI Window")]
    public GameObject crossSectionWindow; // <-- CrossSectionWindow 연결
    public Button toggleCrossSectionButton; // <-- CrossSectionBtn 연결

    [Header("Preview")]
    public Material previewMaterial;

    [Header("Reference")]
    public MaterialColorRegistry colorRegistry;

    private GameObject previewPlane;

    private enum Axis { XY = 0, XZ = 1, YZ = 2 }

    void Start()
    {
        previewButton.onClick.AddListener(OnPreview);
        confirmButton.onClick.AddListener(OnConfirm);
        toggleCrossSectionButton.onClick.AddListener(ToggleCrossSectionWindow);
    }

    void ToggleCrossSectionWindow()
    {
        if (crossSectionWindow != null)
        {
            bool isActive = crossSectionWindow.activeSelf;
            crossSectionWindow.SetActive(!isActive);

            if (isActive && sliceImage != null)
            {
                sliceImage.texture = null;
            }
        }
    }

    void OnPreview()
    {
        if (!int.TryParse(coordinateInput.text, out int index)) return;

        Axis axis = (Axis)planeDropdown.value;
        ShowPreviewPlane(axis, index);
    }

    void OnConfirm()
    {
        if (!int.TryParse(coordinateInput.text, out int index)) return;

        Axis axis = (Axis)planeDropdown.value;
        RenderSlice(axis, index);

        // PreviewCube 삭제
        if (previewPlane != null)
        {
            Destroy(previewPlane);
            previewPlane = null;
        }
    }

    void ShowPreviewPlane(Axis axis, int index)
    {
        if (previewPlane != null)
            Destroy(previewPlane);

        previewPlane = GameObject.CreatePrimitive(PrimitiveType.Cube);
        previewPlane.GetComponent<MeshRenderer>().material = previewMaterial;
        previewPlane.GetComponent<Collider>().enabled = false;

        Vector3 center = new(
            GlobalConfig.DieWidth / 2f,
            GlobalConfig.DieDepth / 2f,
            GlobalConfig.DieHeight / 2f
        );

        float width = GlobalConfig.DieWidth;
        float height = GlobalConfig.DieHeight;
        float thickness = 0.2f;

        switch (axis)
        {
            case Axis.XY:
                previewPlane.transform.position = new Vector3(center.x, index, center.z);
                previewPlane.transform.localScale = new Vector3(width * 1.5f, thickness, height * 1.5f);
                break;

            case Axis.XZ:
                previewPlane.transform.position = new Vector3(center.x, center.y, index);
                previewPlane.transform.localScale = new Vector3(width * 1.5f, height * 1.5f, thickness);
                break;

            case Axis.YZ:
                previewPlane.transform.position = new Vector3(index, center.y, center.z);
                previewPlane.transform.localScale = new Vector3(thickness, height * 1.5f, width * 1.5f);
                break;
        }
    }

    void RenderSlice(Axis axis, int index)
    {
        var die = FindObjectOfType<DieGenerator3D>()?.GetDieLayerMap();
        if (die == null || colorRegistry == null) return;

        colorRegistry.Initialize();

        Texture2D tex;
        Color[] pixels;

        int w = die.width;
        int h = die.height;
        int d = die.depth;

        switch (axis)
        {
            case Axis.XY:
                tex = new Texture2D(w, h);
                pixels = new Color[w * h];
                for (int x = 0; x < w; x++)
                    for (int y = 0; y < h; y++)
                        pixels[y * w + x] = GetTopColor(die.GetLayers(x, y, index));
                break;

            case Axis.XZ:
                tex = new Texture2D(w, d);
                pixels = new Color[w * d];
                for (int x = 0; x < w; x++)
                    for (int z = 0; z < d; z++)
                        pixels[z * w + x] = GetTopColor(die.GetLayers(x, index, z));
                break;

            case Axis.YZ:
                tex = new Texture2D(h, d);
                pixels = new Color[h * d];
                for (int y = 0; y < h; y++)
                    for (int z = 0; z < d; z++)
                        pixels[z * h + y] = GetTopColor(die.GetLayers(index, y, z));
                break;

            default:
                return;
        }

        tex.SetPixels(pixels);
        tex.Apply();
        sliceImage.texture = tex;
    }

    Color GetTopColor(List<Layer> layers)
    {
        if (layers == null || layers.Count == 0) return Color.black;
        int id = colorRegistry.GetId(layers[^1].material);
        Vector4 colorVec = colorRegistry.GetColorArray()[id];
        return new Color(colorVec.x, colorVec.y, colorVec.z, 1f);
    }
}
