using UnityEngine;

public class CameraController : MonoBehaviour
{
    [Header("대상 및 설정")]
    public Transform target;
    public float distance = 1000f;
    public float rotationSpeed = 3f;
    public float zoomSpeed = 30f;
    public float minDistance = 100f;
    public float maxDistance = 5000f;

    private float yaw = 0f;
    private float pitch = 25f;

    public void SetDistanceFromSize(float dieSize)
    {
        distance = Mathf.Clamp(dieSize * 1.5f, minDistance, maxDistance);
    }

    void Update()
    {
        HandleInput();
    }

    void LateUpdate()
    {
        UpdateCameraPosition();
    }

    private void HandleInput()
    {
        if (Input.GetMouseButton(1)) // Right Mouse: Orbit
        {
            yaw += Input.GetAxis("Mouse X") * rotationSpeed;
            pitch -= Input.GetAxis("Mouse Y") * rotationSpeed;
            pitch = Mathf.Clamp(pitch, 0f, 90f);
        }

        float scroll = Input.GetAxis("Mouse ScrollWheel");
        if (Mathf.Abs(scroll) > 0.01f)
        {
            distance -= scroll * zoomSpeed * 10f;
            distance = Mathf.Clamp(distance, minDistance, maxDistance);
        }
    }

    private void UpdateCameraPosition()
    {
        if (target == null) return;

        Quaternion rotation = Quaternion.Euler(pitch, yaw, 0f);
        Vector3 direction = rotation * Vector3.back;
        transform.position = target.position + direction * distance;
        transform.LookAt(target.position);
    }
}
