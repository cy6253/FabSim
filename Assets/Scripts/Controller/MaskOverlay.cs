/* 색 없는 버전
using System.Collections.Generic;
using System.IO;
using UnityEngine;
using UnityEngine.UI;
using TMPro;

public class MaskOverlayWindowManager : MonoBehaviour
{
    [Header("UI")]
    public GameObject maskOverlayWindow;
    public RawImage overlayImg;
    public RawImage candidateImg;
    public TMP_Dropdown candidateDropDown;
    public Button insertBtn;
    public Button extractBtn;
    public Button closeBtn;
    public Slider alphaSlide;

    [Header("Settings")]
    public int imageSize = 1000;
    public float alpha = 1f;

    private Texture2D overlayTexture;
    private Dictionary<string, Texture2D> maskCache = new();
    private List<string> overlayedNames = new();

    private void Start()
    {
        InitOverlayTexture();
        LoadMaskOptions();

        candidateDropDown.onValueChanged.AddListener(_ => UpdateCandidatePreview());
        insertBtn.onClick.AddListener(InsertSelectedMask);
        extractBtn.onClick.AddListener(ExtractSelectedMask);
        alphaSlide.onValueChanged.AddListener(SetOverlayAlpha);
        closeBtn.onClick.AddListener(() => maskOverlayWindow.SetActive(false));
    }

    private void InitOverlayTexture()
    {
        overlayTexture = new Texture2D(imageSize, imageSize, TextureFormat.RGBA32, false);
        overlayTexture.filterMode = FilterMode.Point;

        ClearTexture(overlayTexture, alphaSlide.value); //알파 포함
        overlayTexture.Apply();

        overlayImg.texture = overlayTexture;
    }


    private void LoadMaskOptions()
    {
        candidateDropDown.ClearOptions();

        string[] files = Directory.GetFiles(Application.persistentDataPath, "Mask_*.png");
        if (files.Length == 0)
        {
            Debug.LogWarning("[MaskOverlay] No Mask_*.png files found.");
            return;
        }

        List<TMP_Dropdown.OptionData> options = new();
        foreach (string file in files)
        {
            string filename = Path.GetFileName(file);
            options.Add(new TMP_Dropdown.OptionData(filename));
        }

        candidateDropDown.AddOptions(options);

        if (options.Count > 0)
            UpdateCandidatePreview();
    }

    private void UpdateCandidatePreview()
    {
        string filename = candidateDropDown.options[candidateDropDown.value].text;
        Texture2D tex = LoadMask(filename);

        Texture2D preview = new Texture2D(tex.width, tex.height);
        for (int y = 0; y < tex.height; y++)
        {
            for (int x = 0; x < tex.width; x++)
            {
                float gray = tex.GetPixel(x, y).grayscale;
                Color bw = gray > 0.5f ? Color.white : Color.black;
                preview.SetPixel(x, y, bw);
            }
        }
        preview.Apply();

        candidateImg.texture = preview;
    }

    private Texture2D LoadMask(string name)
    {
        if (maskCache.ContainsKey(name))
            return maskCache[name];

        string path = Path.Combine(Application.persistentDataPath, name);
        if (!File.Exists(path))
        {
            Debug.LogWarning($"[LoadMask] File not found: {path}");
            return null;
        }

        byte[] bytes = File.ReadAllBytes(path);
        Texture2D tex = new Texture2D(2, 2);
        tex.LoadImage(bytes);
        tex.filterMode = FilterMode.Point;
        tex.wrapMode = TextureWrapMode.Clamp;

        maskCache[name] = tex;
        return tex;
    }

    private void InsertSelectedMask()
    {
        string filename = candidateDropDown.options[candidateDropDown.value].text;
        Texture2D tex = LoadMask(filename);
        if (!overlayedNames.Contains(filename))
            overlayedNames.Add(filename);

        RedrawOverlay();
    }

    private void ExtractSelectedMask()
    {
        if (candidateDropDown.options.Count == 0) return;

        string name = candidateDropDown.options[candidateDropDown.value].text;
        if (!overlayedNames.Contains(name)) return;

        overlayedNames.Remove(name);
        RedrawOverlay();
    }

    private void RedrawOverlay()
    {
        float alpha = alphaSlide.value;
        ClearTexture(overlayTexture, alpha); // 검정색 배경도 동일한 알파로

        foreach (string name in overlayedNames)
        {
            Texture2D tex = maskCache[name];
            int srcWidth = tex.width;
            int srcHeight = tex.height;

            int dstWidth = overlayTexture.width;
            int dstHeight = overlayTexture.height;

            for (int y = 0; y < dstHeight; y++)
            {
                for (int x = 0; x < dstWidth; x++)
                {
                    float u = x / (float)dstWidth;
                    float v = y / (float)dstHeight;
                    float gray = tex.GetPixelBilinear(u, v).grayscale;

                    if (gray > 0.5f)
                    {
                        overlayTexture.SetPixel(x, y, new Color(1f, 1f, 1f, alpha)); // 흰색 픽셀
                    }
                    // 검정 픽셀은 이미 ClearTexture에서 그려짐
                }
            }
        }

        overlayTexture.Apply();
    }


    private void ClearTexture(Texture2D tex, float alpha)
    {
        Color clear = new Color(0, 0, 0, alpha); // 검정 배경 + 알파
        Color[] pixels = new Color[tex.width * tex.height];
        for (int i = 0; i < pixels.Length; i++)
            pixels[i] = clear;
        tex.SetPixels(pixels);
    }


    private void SetOverlayAlpha(float value)
    {
        alpha = value;
        RedrawOverlay();
    }
}
*/

using System.Collections.Generic;
using System.IO;
using UnityEngine;
using UnityEngine.UI;
using TMPro;

public class MaskOverlayWindowManager : MonoBehaviour
{
    [Header("UI")]
    public GameObject maskOverlayWindow;
    public RawImage overlayImg;
    public RawImage candidateImg;
    public TMP_Dropdown candidateDropDown;
    public Button insertBtn;
    public Button extractBtn;
    public Button closeBtn;
    public Slider alphaSlide;

    [Header("Settings")]
    public int imageSize = 1000;
    public float alpha = 1f;

    private Texture2D overlayTexture;
    private Dictionary<string, Texture2D> maskCache = new();
    private List<string> overlayedNames = new();
    private Dictionary<string, Color> colorMap = new(); // 마스크별 색상

    private void Start()
    {
        InitOverlayTexture();
        LoadMaskOptions();

        candidateDropDown.onValueChanged.AddListener(_ => UpdateCandidatePreview());
        insertBtn.onClick.AddListener(InsertSelectedMask);
        extractBtn.onClick.AddListener(ExtractSelectedMask);
        alphaSlide.onValueChanged.AddListener(SetOverlayAlpha);
        closeBtn.onClick.AddListener(() => maskOverlayWindow.SetActive(false));
    }

    private void InitOverlayTexture()
    {
        overlayTexture = new Texture2D(imageSize, imageSize, TextureFormat.RGBA32, false);
        overlayTexture.filterMode = FilterMode.Point;
        ClearTexture(overlayTexture, alphaSlide.value);
        overlayTexture.Apply();
        overlayImg.texture = overlayTexture;
    }

    private void ClearTexture(Texture2D tex, float alpha)
    {
        Color clear = new Color(0, 0, 0, alpha);
        Color[] pixels = new Color[tex.width * tex.height];
        for (int i = 0; i < pixels.Length; i++)
            pixels[i] = clear;
        tex.SetPixels(pixels);
    }

    private void LoadMaskOptions()
    {
        candidateDropDown.ClearOptions();
        string[] files = Directory.GetFiles(Application.persistentDataPath, "Mask_*.png");

        if (files.Length == 0)
        {
            Debug.LogWarning("[MaskOverlay] No Mask_*.png files found.");
            return;
        }

        List<TMP_Dropdown.OptionData> options = new();
        foreach (string file in files)
        {
            string filename = Path.GetFileName(file);
            options.Add(new TMP_Dropdown.OptionData(filename));
        }

        candidateDropDown.AddOptions(options);

        if (options.Count > 0)
            UpdateCandidatePreview();
    }

    private void UpdateCandidatePreview()
    {
        string filename = candidateDropDown.options[candidateDropDown.value].text;
        Texture2D tex = LoadMask(filename);

        Texture2D preview = new Texture2D(tex.width, tex.height);
        for (int y = 0; y < tex.height; y++)
        {
            for (int x = 0; x < tex.width; x++)
            {
                float gray = tex.GetPixel(x, y).grayscale;
                Color bw = gray > 0.5f ? Color.white : Color.black;
                preview.SetPixel(x, y, bw);
            }
        }
        preview.Apply();

        candidateImg.texture = preview;
    }

    private Texture2D LoadMask(string name)
    {
        if (maskCache.ContainsKey(name))
            return maskCache[name];

        string path = Path.Combine(Application.persistentDataPath, name);
        if (!File.Exists(path))
        {
            Debug.LogWarning($"[LoadMask] File not found: {path}");
            return null;
        }

        byte[] bytes = File.ReadAllBytes(path);
        Texture2D tex = new Texture2D(2, 2);
        tex.LoadImage(bytes);
        tex.filterMode = FilterMode.Point;
        tex.wrapMode = TextureWrapMode.Clamp;

        maskCache[name] = tex;
        return tex;
    }

    private void InsertSelectedMask()
    {
        string filename = candidateDropDown.options[candidateDropDown.value].text;
        if (!overlayedNames.Contains(filename))
            overlayedNames.Add(filename);

        RedrawOverlay();
    }

    private void ExtractSelectedMask()
    {
        if (candidateDropDown.options.Count == 0) return;

        string name = candidateDropDown.options[candidateDropDown.value].text;
        if (!overlayedNames.Contains(name)) return;

        overlayedNames.Remove(name);
        RedrawOverlay();
    }

    private void RedrawOverlay()
    {
        float alpha = alphaSlide.value;
        ClearTexture(overlayTexture, alpha); // 배경 검정색 + 알파

        foreach (string name in overlayedNames)
        {
            Texture2D tex = maskCache[name];
            int srcWidth = tex.width;
            int srcHeight = tex.height;

            int dstWidth = overlayTexture.width;
            int dstHeight = overlayTexture.height;

            Color maskColor = GetColorForMask(name);

            for (int y = 0; y < dstHeight; y++)
            {
                for (int x = 0; x < dstWidth; x++)
                {
                    float u = x / (float)dstWidth;
                    float v = y / (float)dstHeight;
                    float gray = tex.GetPixelBilinear(u, v).grayscale;

                    if (gray > 0.5f)
                    {
                        Color color = new Color(maskColor.r, maskColor.g, maskColor.b, alpha);
                        overlayTexture.SetPixel(x, y, color);
                    }
                }
            }
        }

        overlayTexture.Apply();
    }

    private Color GetColorForMask(string maskName)
    {
        if (!colorMap.ContainsKey(maskName))
        {
            Color randomColor = Random.ColorHSV(0f, 1f, 0.5f, 1f, 0.8f, 1f);
            colorMap[maskName] = randomColor;
        }
        return colorMap[maskName];
    }

    private void SetOverlayAlpha(float value)
    {
        alpha = value;
        RedrawOverlay();
    }
}
