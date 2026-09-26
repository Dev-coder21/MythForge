import { Color, DoubleSide, ShaderMaterial, type Texture } from 'three'

/**
 * Material for every painted depth layer:
 * - tint (tintable kit layers) + mix toward fog color (atmospheric perspective)
 * - FoliageSway / GrassSway: x displacement by uv.y * sin(time + worldX) * wind
 * - rim light on top edges of silhouettes, lit by the moon color
 * - alpha test + depth write so near layers genuinely occlude the title
 * - mip-bias blur driven by distance from the focal plane (layer DOF)
 */
export function createLayerMaterial(map: Texture) {
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
      uRimColor: { value: new Color('#ffffff') },
      uRim: { value: 0 },
      uRimTexel: { value: 0.004 },
      uBlur: { value: 0 },
    },
    vertexShader: /* glsl */ `
      uniform float uTime;
      uniform float uWind;
      uniform float uSway;
      varying vec2 vUv;

      void main() {
        vUv = uv;
        vec4 world = modelMatrix * vec4(position, 1.0);
        float phase = uTime * 1.4 + world.x * 0.7;
        float gust = 0.65 + 0.35 * sin(uTime * 0.37 + world.x * 0.11);
        world.x += uv.y * sin(phase) * uWind * uSway * gust;
        gl_Position = projectionMatrix * viewMatrix * world;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform sampler2D uMap;
      uniform vec3 uTint;
      uniform vec3 uFogColor;
      uniform float uFogMix;
      uniform float uOpacity;
      uniform float uAlphaTest;
      uniform vec3 uRimColor;
      uniform float uRim;
      uniform float uRimTexel;
      uniform float uBlur;
      varying vec2 vUv;

      void main() {
        // uBlur = mip LOD bias: cheap per-layer depth of field.
        vec4 t = texture2D(uMap, vUv, uBlur);
        float a = t.a * uOpacity;
        if (a < uAlphaTest) discard;

        vec3 col = t.rgb * uTint;
        if (uRim > 0.0) {
          float above = texture2D(uMap, vUv + vec2(0.0, uRimTexel), uBlur).a;
          col += uRimColor * uRim * t.a * (1.0 - above);
        }
        col = mix(col, uFogColor, uFogMix);
        gl_FragColor = vec4(col, a);
      }
    `,
    transparent: true,
    depthWrite: true,
    side: DoubleSide,
  })
}
