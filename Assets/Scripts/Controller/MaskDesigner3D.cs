using UnityEngine;
using UnityEngine.UI;
using System.IO;
using System.Collections.Generic;

public class MaskDesigner3D : MonoBehaviour
{
    [Header("UI 연결")]
    public RawImage maskImage;
    public RectTransform maskImageContainer;
    public GameObject maskDesignWindow;
    public GameObject maskOverlayWindow;

    [Header("Minimap")]
    public RawImage minimapImage;
    public Dropdown minimapDropdown;

    [Header("버튼 및 필드")]
    public Button toggleButton;
    public Button saveButton;
    public Button deleteButton;
    public Button openButton;
    public Button closeButton;
    public Button overlayButton;
    public InputField maskNameInput;
    public Dropdown maskDropdown;

    [Header("렌더링 연동")]
    public DieLayerRenderer3D renderer;

    [Header("색상 설정")]
    public Color drawColor = Color.white;
    public Color eraseColor = Color.black;

    [Header("브러시 설정")]
    public int brushSize = 1;

    [Header("브러시 UI")]
    public Slider brushSizeSlider;

    [Header("격자 설정")]
    public RawImage gridOverlayImage;
    public Color gridColor = new Color(1f, 1f, 1f, 0.2f);  // 흰색, 반투명
    public int gridSpacing = 10;  // 격자 간격
    public GameObject gridLabelContainer;  // 라벨을 담을 빈 오브젝트
    public Font gridFont;                 // Unity 기본 폰트나 원하는 폰트
    public int gridLabelFontSize = 14;
    public Color gridLabelColor = Color.white;

    private Texture2D gridTexture;

    private Texture2D maskTexture;
    private HashSet<Vector2Int> maskData = new();
    private Vector2 panOffset = Vector2.zero;
    private float scale = 1f;
    private Vector2Int? lastDrawPos = null;

    private int width;
    private int height;
    private bool isRenderingDisabled = false;
    private bool isFilled = false;

    void Start()
    {
        width = GlobalConfig.DieWidth;
        height = GlobalConfig.DieHeight;
        gridLabelContainer.GetComponent<RectTransform>().sizeDelta = new Vector2(width, height);
        maskTexture = new Texture2D(width, height, TextureFormat.RGBA32, false)
        {
            filterMode = FilterMode.Point
        };

        ClearMaskTexture();
        maskImage.texture = maskTexture;
        maskImage.rectTransform.sizeDelta = new Vector2(width, height);

        toggleButton?.onClick.AddListener(ToggleMaskFill);
        saveButton?.onClick.AddListener(() => SaveMask(GetMaskFileName()));
        deleteButton?.onClick.AddListener(DeleteSelectedMask);
        openButton?.onClick.AddListener(OpenWindow);
        closeButton?.onClick.AddListener(CloseWindow);
        overlayButton?.onClick.AddListener(OverlayWindow);
        maskDropdown?.onValueChanged.AddListener(OnMaskSelected);
        minimapDropdown?.onValueChanged.AddListener(OnMinimapSelected);

        GenerateGridTexture();
        gridOverlayImage.texture = gridTexture;
        gridOverlayImage.rectTransform.sizeDelta = new Vector2(width, height);
        gridOverlayImage.rectTransform.localScale = Vector3.one;
        gridOverlayImage.rectTransform.anchoredPosition = Vector2.zero;


        if (brushSizeSlider != null)
        {
            brushSizeSlider.minValue = 1;
            brushSizeSlider.maxValue = 20;
            brushSizeSlider.wholeNumbers = true;
            brushSizeSlider.value = brushSize;
            brushSizeSlider.onValueChanged.AddListener(SetBrushSize);
        }
        LoadMaskListToDropdown();
        GenerateGridLabels();
    }

    void Update()
    {
        if (maskDesignWindow == null || renderer == null) return;

        bool isActive = maskDesignWindow.activeSelf;

        if (isActive && !isRenderingDisabled)
        {
            renderer.disableRendering = true;
            isRenderingDisabled = true;
        }
        else if (!isActive && isRenderingDisabled)
        {
            renderer.disableRendering = false;
            isRenderingDisabled = false;
        }

        if (isActive)
        {
            HandleDrawing();
            HandleZoomAndPan();
        }
    }

    private bool isMouseHeld = false;

    void HandleDrawing()
    {
        bool mouseDown = Input.GetMouseButtonDown(0) || Input.GetMouseButtonDown(1);
        bool mouseHeld = Input.GetMouseButton(0) || Input.GetMouseButton(1);
        bool mouseUp = Input.GetMouseButtonUp(0) || Input.GetMouseButtonUp(1);

        if (mouseUp)
        {
            lastDrawPos = null;
            isMouseHeld = false;
            return;
        }

        if (!mouseDown && !mouseHeld) return;

        if (!RectTransformUtility.ScreenPointToLocalPointInRectangle(maskImageContainer, Input.mousePosition, null, out Vector2 localPoint))
            return;

        Vector2 norm = new(
            (localPoint.x - panOffset.x) / scale + width / 2f,
            (localPoint.y - panOffset.y) / scale + height / 2f
        );

        int x = Mathf.FloorToInt(norm.x);
        int y = Mathf.FloorToInt(norm.y);
        if (x < 0 || x >= width || y < 0 || y >= height) return;

        Vector2Int current = new(x, y);
        bool draw = Input.GetMouseButton(0);  // 왼쪽 버튼이면 그리기

        if (mouseDown)
        {
            DrawBrush(x, y, draw);
            lastDrawPos = current;
            isMouseHeld = true;
        }
        else if (isMouseHeld && lastDrawPos.HasValue && lastDrawPos.Value != current)
        {
            Vector2Int adjusted = current;

            // Shift: 수직 고정 (x 좌표 고정)
            if (Input.GetKey(KeyCode.LeftShift) || Input.GetKey(KeyCode.RightShift))
            {
                adjusted.x = lastDrawPos.Value.x;
            }
            // Ctrl: 수평 고정 (y 좌표 고정)
            else if (Input.GetKey(KeyCode.LeftControl) || Input.GetKey(KeyCode.RightControl))
            {
                adjusted.y = lastDrawPos.Value.y;
            }

            DrawLine(lastDrawPos.Value, adjusted, draw);
            lastDrawPos = adjusted;
        }

        maskTexture.Apply();
    }


    void DrawBrush(int centerX, int centerY, bool draw)
    {
        if (brushSize <= 1)
        {
            SetPixel(centerX, centerY, draw);
            return;
        }

        int r = brushSize / 2;
        for (int dx = -r; dx <= r; dx++)
        {
            for (int dy = -r; dy <= r; dy++)
            {
                int x = centerX + dx;
                int y = centerY + dy;

                if (x < 0 || x >= width || y < 0 || y >= height) continue;

                float distSq = dx * dx + dy * dy;
                if (distSq <= r * r)
                    SetPixel(x, y, draw);
            }
        }
    }

    void SetPixel(int x, int y, bool draw)
    {
        Vector2Int pos = new(x, y);
        bool changed = draw ? maskData.Add(pos) : maskData.Remove(pos);
        if (!changed) return;

        maskTexture.SetPixel(x, y, draw ? drawColor : eraseColor);
    }

    void DrawLine(Vector2Int start, Vector2Int end, bool draw)
    {
        int dx = Mathf.Abs(end.x - start.x);
        int dy = Mathf.Abs(end.y - start.y);
        int sx = start.x < end.x ? 1 : -1;
        int sy = start.y < end.y ? 1 : -1;
        int err = dx - dy;

        int x = start.x;
        int y = start.y;

        while (true)
        {
            DrawBrush(x, y, draw);
            if (x == end.x && y == end.y) break;

            int e2 = 2 * err;
            if (e2 > -dy) { err -= dy; x += sx; }
            if (e2 < dx) { err += dx; y += sy; }
        }
    }

    void HandleZoomAndPan()
    {
        float scrollDelta = Input.mouseScrollDelta.y;
        if (Mathf.Abs(scrollDelta) > 0.01f)
        {
            if (!RectTransformUtility.ScreenPointToLocalPointInRectangle(maskImageContainer, Input.mousePosition, null, out Vector2 localPoint))
                return;

            Vector2 beforeZoom = (localPoint - panOffset) / scale;

            scale = Mathf.Clamp(scale + scrollDelta * 0.1f, 0.5f, 20f);
            maskImage.rectTransform.localScale = Vector3.one * scale;
            gridOverlayImage.rectTransform.localScale = maskImage.rectTransform.localScale;

            Vector2 afterZoom = beforeZoom * scale;
            panOffset += (localPoint - panOffset) - afterZoom;

            maskImage.rectTransform.anchoredPosition = panOffset;
            gridOverlayImage.rectTransform.anchoredPosition = maskImage.rectTransform.anchoredPosition;

            // Grid와 라벨도 마스크와 함께 확대/이동
            gridOverlayImage.rectTransform.localScale = maskImage.rectTransform.localScale;
            gridOverlayImage.rectTransform.anchoredPosition = maskImage.rectTransform.anchoredPosition;

            gridLabelContainer.GetComponent<RectTransform>().localScale = maskImage.rectTransform.localScale;
            gridLabelContainer.GetComponent<RectTransform>().anchoredPosition = maskImage.rectTransform.anchoredPosition;

        }

        if (Input.GetMouseButton(2))
        {
            panOffset += new Vector2(Input.GetAxis("Mouse X"), Input.GetAxis("Mouse Y")) * 10f;
            maskImage.rectTransform.anchoredPosition = panOffset;
            // 같이 움직이게 추가
            gridOverlayImage.rectTransform.anchoredPosition = panOffset;
            gridLabelContainer.GetComponent<RectTransform>().anchoredPosition = panOffset;
        }
    }

    public void ToggleMaskFill()
    {
        isFilled = !isFilled;
        maskData.Clear();

        // 마스크 색상 설정
        Color fillColor = isFilled ? drawColor : eraseColor;

        // 격자 색상 자동 반전
        gridColor = isFilled
            ? new Color(0f, 0f, 0f, 0.6f)  // 흰 배경일 땐 검은 격자
            : new Color(1f, 1f, 1f, 0.2f); // 검정 배경일 땐 흰 격자

        // 격자 텍스처 다시 생성
        GenerateGridTexture();
        gridOverlayImage.texture = gridTexture;

        for (int x = 0; x < width; x++)
        {
            for (int y = 0; y < height; y++)
            {
                Vector2Int pos = new(x, y);
                if (isFilled) maskData.Add(pos);
                maskTexture.SetPixel(x, y, fillColor);
            }
        }

        maskTexture.Apply();
    }


    public string GetMaskFileName()
    {
        string name = maskNameInput?.text.Trim();
        return string.IsNullOrEmpty(name) ? "Mask_Default.png" : $"Mask_{name}.png";
    }

    public void SaveMask(string fileName)
    {
        Texture2D tex = new(width, height, TextureFormat.RGBA32, false);
        Color[] pixels = new Color[width * height];

        foreach (var pos in maskData)
        {
            int index = pos.y * width + pos.x;
            pixels[index] = Color.white;
        }

        tex.SetPixels(pixels);
        tex.Apply();

        File.WriteAllBytes(Path.Combine(Application.persistentDataPath, fileName), tex.EncodeToPNG());
        LoadMaskListToDropdown();
    }

    public void LoadMask(string fileName)
    {
        string path = Path.Combine(Application.persistentDataPath, fileName);
        if (!File.Exists(path)) return;

        byte[] bytes = File.ReadAllBytes(path);
        Texture2D tex = new(width, height);
        tex.LoadImage(bytes);

        tex.wrapMode = TextureWrapMode.Clamp;
        maskData.Clear();

        for (int x = 0; x < width; x++)
        {
            for (int y = 0; y < height; y++)
            {
                bool filled = tex.GetPixel(x, y).grayscale > 0.5f;
                Vector2Int pos = new(x, y);

                if (filled) maskData.Add(pos);
                maskTexture.SetPixel(x, y, filled ? drawColor : eraseColor);
            }
        }

        maskTexture.Apply();
    }

    public void DeleteSelectedMask()
    {
        if (maskDropdown == null || maskDropdown.options.Count == 0) return;

        string fileName = maskDropdown.options[maskDropdown.value].text;
        string path = Path.Combine(Application.persistentDataPath, fileName);

        if (File.Exists(path))
        {
            File.Delete(path);
            LoadMaskListToDropdown();
        }
    }

    public void LoadMaskListToDropdown()
    {
        if (maskDropdown == null) return;

        maskDropdown.ClearOptions();
        string[] files = Directory.GetFiles(Application.persistentDataPath, "Mask_*.png");

        List<string> options = new();
        foreach (string path in files)
            options.Add(Path.GetFileName(path));

        maskDropdown.AddOptions(options);

        if (minimapDropdown != null)
        {
            minimapDropdown.ClearOptions();
            minimapDropdown.AddOptions(new List<string>(options));
        }

    }
    public void LoadMinimapOnly(string fileName)
    {
        string path = Path.Combine(Application.persistentDataPath, fileName);
        if (!File.Exists(path)) return;

        byte[] bytes = File.ReadAllBytes(path);
        Texture2D tex = new Texture2D(width, height);
        tex.LoadImage(bytes);

        if (minimapImage != null)
        {
            Texture2D miniTex = new Texture2D(width, height, TextureFormat.RGBA32, false);
            for (int y = 0; y < height; y++)
            {
                for (int x = 0; x < width; x++)
                {
                    bool filled = tex.GetPixel(x, y).grayscale > 0.5f;
                    Color pixelColor = filled ? Color.white : Color.black; // 반전 수정 포함
                    miniTex.SetPixel(x, y, pixelColor);
                }
            }

            miniTex.Apply();
            miniTex.filterMode = FilterMode.Point;
            minimapImage.texture = miniTex;
            minimapImage.rectTransform.sizeDelta = new Vector2(350, 350);
        }
    }

    public void ClearMaskTexture()
    {
        maskData.Clear();
        for (int x = 0; x < width; x++)
            for (int y = 0; y < height; y++)
                maskTexture.SetPixel(x, y, eraseColor);

        maskTexture.Apply();
    }

    public void OpenWindow() => maskDesignWindow?.SetActive(true);
    public void CloseWindow() => maskDesignWindow?.SetActive(false);
    public void OverlayWindow() => maskOverlayWindow?.SetActive(true);

    private void OnMaskSelected(int index)
    {
        if (index < 0 || maskDropdown == null || index >= maskDropdown.options.Count) return;

        string selected = maskDropdown.options[index].text;
        if (!string.IsNullOrEmpty(selected))
            LoadMask(selected);
    }
    private void OnMinimapSelected(int index)
    {
        if (index < 0 || minimapDropdown == null || index >= minimapDropdown.options.Count) return;

        string selected = minimapDropdown.options[index].text;
        if (!string.IsNullOrEmpty(selected))
            LoadMinimapOnly(selected);
    }

    public void SetBrushSize(float size)
    {
        brushSize = Mathf.Clamp((int)size, 1, 100);
    }

    public bool[,] GetMaskData(int targetWidth, int targetHeight)
    {
        var result = new bool[targetWidth, targetHeight];
        foreach (var pos in maskData)
        {
            if (pos.x >= 0 && pos.x < targetWidth && pos.y >= 0 && pos.y < targetHeight)
                result[pos.x, pos.y] = true;
        }
        return result;
    }

    void GenerateGridTexture()
    {
        gridTexture = new Texture2D(width, height, TextureFormat.RGBA32, false);
        gridTexture.filterMode = FilterMode.Point;

        Color transparent = new Color(0, 0, 0, 0);
        for (int x = 0; x < width; x++)
        {
            for (int y = 0; y < height; y++)
            {
                bool isGridLine = (x % gridSpacing == 0 || y % gridSpacing == 0);
                gridTexture.SetPixel(x, y, isGridLine ? gridColor : transparent);
            }
        }
        gridTexture.Apply();
    }
    void GenerateGridLabels()
    {
        if (gridLabelContainer == null) return;
        var rt = gridLabelContainer.GetComponent<RectTransform>();
        rt.sizeDelta = new Vector2(width, height);

        foreach (Transform child in gridLabelContainer.transform)
            Destroy(child.gameObject);

        // X축 숫자 (상단 또는 하단 위치)
        for (int x = 0; x <= width; x += gridSpacing * 2)
        {
            Vector2 pos = new Vector2(x, -gridSpacing * 0.5f); // 약간 아래로
            CreateGridLabel($"{x}", pos);
        }

        // Y축 숫자 (왼쪽에 위치)
        for (int y = 0; y <= height; y += gridSpacing * 2)
        {
            Vector2 pos = new Vector2(-gridSpacing * 1.2f, y); // 약간 왼쪽으로
            CreateGridLabel($"{y}", pos);
        }
    }
    void CreateGridLabel(string text, Vector2 anchoredPos)
    {
        GameObject label = new GameObject("GridLabel", typeof(RectTransform));
        label.transform.SetParent(gridLabelContainer.transform, false);

        Text txt = label.AddComponent<Text>();
        txt.text = text;
        txt.font = gridFont;
        txt.fontSize = gridLabelFontSize;
        txt.color = gridLabelColor;
        txt.alignment = TextAnchor.MiddleCenter;
        txt.raycastTarget = false;

        RectTransform rt = label.GetComponent<RectTransform>();
        rt.sizeDelta = new Vector2(40, 20); // 숫자 라벨 박스 크기
        rt.anchorMin = rt.anchorMax = new Vector2(0f, 0f); // 좌상단 기준 위치 고정
        rt.pivot = new Vector2(0.5f, 0.5f);  // 중앙 기준
        rt.anchoredPosition = anchoredPos;
    }
}
