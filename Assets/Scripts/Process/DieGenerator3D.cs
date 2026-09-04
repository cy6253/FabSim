using UnityEngine;
using System.Collections;

public class DieGenerator3D : MonoBehaviour
{
    [Header("기판 설정")]
    public int initialThickness = 10;

    [Header("렌더링")]
    public DieLayerRenderer3D renderer;

    [Header("카메라 포커싱")]
    public GameObject focusTarget;
    public CameraController cameraController;

    private DieLayerMap3D die;

    /// <summary>
    /// 노드에서 호출 가능한 코루틴
    /// </summary>
    public IEnumerator RunGenerateAndRender()
    {
        int width = GlobalConfig.DieWidth;
        int height = GlobalConfig.DieHeight;
        int depth = GlobalConfig.DieDepth;

        die = new DieLayerMap3D(width, height, depth);
        Layer siliconLayer = new("Si", 1f);

        int zMax = Mathf.Min(initialThickness, depth);
        for (int z = 0; z < zMax; z++)
        {
            for (int x = 0; x < width; x++)
            {
                for (int y = 0; y < height; y++)
                {
                    die.AddLayer(x, y, z, siliconLayer);
                }
            }
        }
        //Debug.Log($"[DieGenerator3D] 실리콘 Die 생성 완료. 총 voxel 수: {die.CountTotalVoxels():N0}");
        renderer?.UpdateFromDie(die, renderer.colorRegistry, append: false);
        FocusCameraToDie();

        yield return null; // 렌더링 프레임 동기화용
    }

    private void FocusCameraToDie()
    {
        if (focusTarget != null)
        {
            Vector3 center = new(
                GlobalConfig.DieWidth * 0.5f,
                GlobalConfig.DieDepth * 0.5f,
                GlobalConfig.DieHeight * 0.5f
            );
            focusTarget.transform.position = center;
        }

        if (cameraController != null)
        {
            float maxSize = Mathf.Max(GlobalConfig.DieWidth, GlobalConfig.DieHeight, GlobalConfig.DieDepth);
            cameraController.SetDistanceFromSize(maxSize);
        }

        Camera.main?.transform.LookAt(focusTarget?.transform.position ?? Vector3.zero);
    }

    public DieLayerMap3D GetDieLayerMap() => die;
}