/*
Shader "Custom/VoxelShader_InstancedIndirect"
{
    Properties
    {
        _Color("Base Color", Color) = (1,1,1,1)
    }
    SubShader
    {
        Tags { "RenderType"="Opaque" }
        Pass
        {
            CGPROGRAM
            #pragma vertex vert
            #pragma fragment frag
            #pragma multi_compile_instancing

            #include "UnityCG.cginc"
            #include "Lighting.cginc"
            
            // 정점 입력
            struct appdata
            {
                float4 vertex : POSITION;
                float3 normal : NORMAL;
                UNITY_VERTEX_INPUT_INSTANCE_ID
            };

            // 정점 → 픽셀 전달 구조체
            struct v2f
            {
                float4 pos : SV_POSITION;
                float3 worldPos : TEXCOORD0;
                float3 normal : TEXCOORD1;
                int materialId : TEXCOORD2;
            };

            // GPU 인스턴싱 버퍼
            StructuredBuffer<float3> _Positions;
            StructuredBuffer<float3> _Scales;
            StructuredBuffer<int> _MaterialIds;
            float4 _MaterialColors[64]; // 최대 64개 재료

            // 정점 셰이더
            v2f vert(appdata v, uint id : SV_InstanceID)
            {
                v2f o;
                UNITY_SETUP_INSTANCE_ID(v);

                float3 pos = _Positions[id];
                float3 scale = _Scales[id];
                int matId = _MaterialIds[id];

                // 각 축 방향별 스케일 적용
                float3 scaledVertex = float3(
                    v.vertex.x * scale.x,
                    v.vertex.y * scale.y,
                    v.vertex.z * scale.z
                );

                float3 worldPos = pos + scaledVertex;

                o.pos = UnityObjectToClipPos(float4(worldPos, 1));
                o.worldPos = worldPos;
                o.normal = UnityObjectToWorldNormal(v.normal);
                o.materialId = matId;

                return o;
            }

            // 프래그먼트 셰이더 (조명 + 색상)
            fixed4 frag(v2f i) : SV_Target
            {
                float3 normal = normalize(i.normal);
                float3 lightDir = normalize(_WorldSpaceLightPos0.xyz);
                float NdotL = max(0, dot(normal, lightDir));

                float4 baseColor = _MaterialColors[i.materialId];
                float3 diffuse = baseColor.rgb * _LightColor0.rgb * NdotL;

                return float4(diffuse, 1);
            }

            ENDCG
        }
    }
}
*/

Shader "Custom/VoxelShader_InstancedIndirect"
{
    Properties
    {
        _Color("Base Color", Color) = (1,1,1,1)
    }
    SubShader
    {
        Tags { "RenderType"="Opaque" }
        Pass
        {
            CGPROGRAM
            #pragma vertex vert
            #pragma fragment frag
            #pragma multi_compile_instancing

            #include "UnityCG.cginc"
            #include "Lighting.cginc" // Unity 조명 지원

            struct appdata
            {
                float4 vertex : POSITION;
                float3 normal : NORMAL;
                UNITY_VERTEX_INPUT_INSTANCE_ID
            };

            struct v2f
            {
                float4 pos : SV_POSITION;
                float3 worldPos : TEXCOORD0;
                float3 normal : TEXCOORD1;
                int materialId : TEXCOORD2;
            };

            StructuredBuffer<float3> _Positions;
            StructuredBuffer<float3> _Scales;
            StructuredBuffer<int> _MaterialIds;
            float4 _MaterialColors[64]; // MaterialColorRegistry에서 전달

            v2f vert(appdata v, uint id : SV_InstanceID)
            {
                v2f o;
                UNITY_SETUP_INSTANCE_ID(v);

                float3 pos = _Positions[id];
                float3 scale = _Scales[id];
                int matId = _MaterialIds[id];

                float3 scaledVertex = float3(
                    v.vertex.x * scale.x,
                    v.vertex.y * scale.y,
                    v.vertex.z * scale.z
                );

                float3 worldPos = pos + scaledVertex;

                o.pos = UnityObjectToClipPos(float4(worldPos, 1));
                o.worldPos = worldPos;
                o.normal = UnityObjectToWorldNormal(v.normal);
                o.materialId = matId;

                return o;
            }

            fixed4 frag(v2f i) : SV_Target
            {
                float3 normal = normalize(i.normal);
                float3 lightDir = normalize(_WorldSpaceLightPos0.xyz);
                float NdotL = max(0, dot(normal, lightDir));

                float4 baseColor = _MaterialColors[i.materialId];

                // 색상은 그대로 유지, 조명은 밝기만 조절
                float brightness = 0.1 + 0.4 * NdotL; // 약간의 입체감만 부여
                float3 colorOut = baseColor.rgb * brightness;

                return float4(colorOut, 1);
            }

            ENDCG
        }
    }
}