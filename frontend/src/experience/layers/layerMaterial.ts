import { Color, DoubleSide, ShaderMaterial, Vector2, type Texture } from 'three'
import { MAX_LIGHTS, type LightUniforms } from '../store'

/**
 * Material for every painted depth layer:
 * - tint (tintable kit layers) + mix toward fog colour (atmospheric perspective)
 * - FoliageSway / GrassSway: x displacement by uv.y * sin(time + worldX) * wind
 * - moonlit rim on edges facing the light (upper right, flip-aware)
 * - warm point lights (lanterns) with soft falloff
 * - alpha test + depth write so near layers genuinely occlude the title
 * - mip-bias blur driven by distance from the focal plane (layer DOF)
 */
export function createLayerMaterial(map: Texture, lights: LightUniforms) {
  return new ShaderMaterial({
    uniforms: {
      uMap: { value: map },
      uTint: { value: new Color('#ffffff') },
      uFogColor: { value: new Color('#000000') },
      uFogMix: { value: 0 },
      uOpacity: { value: 1 },
      uAlphaTest: { value: 0.02 },
      uTime: { value: 0 },
      uWind: { value: 0 },
      uSway: { value: 0 },
      uFlip: { value: 0 },
      uRimColor: { value: new Color('#ffffff') },
      uRim: { value: 0 },
      uRimTexel: { value: new Vector2(0.003, 0.003) },
      uBlur: { value: 0 },
      uLightGain: { value: 1 },
      uTileX: { value: 1 },
      uBob: { value: 0 },
      uFlipY: { value: 0 },
      // The chapter's light uniform objects are shared by reference, so one update per frame lights them all.
      ...lights,
    },
    vertexShader: /* glsl */ `
      uniform float uTime;
      uniform float uWind;
      uniform float uSway;
      uniform float uFlip;
      uniform float uTileX;
      uniform float uBob;
      uniform float uFlipY;
      varying vec2 vUv;
      varying vec3 vWorld;

      void main() {
        vUv = vec2(mix(uv.x, 1.0 - uv.x, uFlip) * uTileX, mix(uv.y, 1.0 - uv.y, uFlipY));
        vec4 world = modelMatrix * vec4(position, 1.0);
        float phase = uTime * 1.4 + world.x * 0.7;
        float gust = 0.65 + 0.35 * sin(uTime * 0.37 + world.x * 0.11);
        world.x += uv.y * uv.y * sin(phase) * uWind * uSway * gust;
        // Floating things (boats) rise and settle on the water.
        world.y += sin(uTime * 0.8 + world.x * 0.15) * uBob;
        vWorld = world.xyz;
        gl_Position = projectionMatrix * viewMatrix * world;
      }
    `,
    fragmentShader: /* glsl */ `
      #define MAX_LIGHTS ${MAX_LIGHTS}
      uniform sampler2D uMap;
      uniform vec3 uTint;
      uniform vec3 uFogColor;
      uniform float uFogMix;
      uniform float uOpacity;
      uniform float uAlphaTest;
      uniform float uFlip;
      uniform vec3 uRimColor;
      uniform float uRim;
      uniform vec2 uRimTexel;
      uniform float uBlur;
      uniform float uLightGain;
      uniform vec4 uLightPos[MAX_LIGHTS];
      uniform vec3 uLightCol[MAX_LIGHTS];
      uniform int uLightCount;
      varying vec2 vUv;
      varying vec3 vWorld;

      void main() {
        // uBlur = mip LOD bias: cheap per-layer depth of field.
        vec4 t = texture2D(uMap, vUv, uBlur);
        float a = t.a * uOpacity;
        if (a < uAlphaTest) discard;

        vec3 col = t.rgb * uTint;

        // Rim: the texel toward the moon (screen upper right) is empty.
        if (uRim > 0.0) {
          vec2 dir = vec2(mix(1.0, -1.0, uFlip), 1.0) * uRimTexel;
          float open = 1.0 - texture2D(uMap, vUv + dir * 1.8, uBlur).a;
          col += uRimColor * uRim * open * t.a;
        }

        // Lantern light: soft inverse-square-ish falloff, zero past 1.6 radius.
        vec3 lit = vec3(0.0);
        for (int i = 0; i < MAX_LIGHTS; i++) {
          if (i >= uLightCount) break;
          vec3 d = uLightPos[i].xyz - vWorld;
          float r = uLightPos[i].w;
          float dist2 = dot(d, d) / (r * r);
          float fall = smoothstep(2.56, 0.0, dist2) / (1.0 + dist2 * 4.0);
          lit += uLightCol[i] * fall;
        }
        col += (t.rgb * 2.5 + 0.04) * lit * uLightGain;

        col = mix(col, uFogColor, uFogMix);
        gl_FragColor = vec4(col, a);
      }
    `,
    transparent: true,
    depthWrite: true,
    side: DoubleSide,
  })
}
