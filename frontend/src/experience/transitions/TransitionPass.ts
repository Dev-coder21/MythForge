import { Pass } from 'postprocessing'
import { Color, ShaderMaterial, Uniform, Vector2, type Texture, type WebGLRenderer, type WebGLRenderTarget } from 'three'
import type { TransitionType } from '@/spec'
import { NOISE_GLSL } from '../layers/glsl'

/** Shader ids; 3 = plain crossfade (reduced motion). */
export const TRANSITION_IDS: Record<TransitionType | 'crossfade', number> = {
  'noise-dissolve': 0,
  'ink-wipe': 1,
  'bloom-out': 2,
  crossfade: 3,
}

const fragmentShader = /* glsl */ `
  uniform sampler2D tA;
  uniform sampler2D tB;
  uniform float uT;
  uniform int uType;
  uniform vec3 uAccent;
  uniform float uTime;
  uniform float uCA;
  uniform float uEdge;
  uniform vec2 uAspect;
  varying vec2 vUv;
  ${NOISE_GLSL}

  vec3 sampleCA(sampler2D tex, vec2 uv, float ca) {
    vec2 d = (uv - 0.5) * ca;
    return vec3(texture2D(tex, uv + d).r, texture2D(tex, uv).g, texture2D(tex, uv - d).b);
  }

  void main() {
    float t = clamp(uT, 0.0, 1.0);
    float bell = sin(3.14159265 * t);
    // Lens fringing peaks mid-transition (EXPERIENCE_SPEC §6).
    float ca = uCA + bell * 0.012;
    vec3 a = sampleCA(tA, vUv, ca);
    if (t <= 0.0) { gl_FragColor = vec4(a, 1.0); return; }
    vec3 b = sampleCA(tB, vUv, ca);
    vec2 p = vUv * uAspect;
    vec3 col;

    if (uType == 0) {
      // Noise dissolve: fbm threshold sweeping through, with a hot accent edge.
      float n = fbm(p * 4.0 + vec2(0.0, uTime * 0.03));
      n = mix(n, vUv.y, 0.25);                       // drifts slightly bottom-up
      float w = 0.05;
      float front = t * (1.0 + 2.0 * w) - w;
      float m = smoothstep(n - w, n + w, front);
      float edge = 1.0 - abs(m * 2.0 - 1.0);
      // Soft burning rim kept mostly below the bloom threshold (bright lines read as lightning).
      col = mix(a, b, m) + uAccent * edge * edge * uEdge * 0.22;
    } else if (uType == 1) {
      // Ink wipe: ink blooms from the lower left with a ragged, bleeding edge.
      vec2 o = vec2(-0.08, -0.1) * uAspect;
      float maxD = length(vec2(1.1, 1.1) * uAspect);
      float d = length(p - o) / maxD;
      d += (fbm(p * 3.2 + uTime * 0.04) - 0.5) * 0.28 + (fbm(p * 11.0) - 0.5) * 0.06;
      float front = t * 1.3 - 0.12;
      float m = 1.0 - smoothstep(front - 0.035, front + 0.035, d);
      // Ink bleeds just ahead of the front: a partial darkening, never a black gap.
      float bleed = smoothstep(front + 0.16, front + 0.02, d) * (1.0 - m);
      float wet = smoothstep(front - 0.1, front, d) * m;
      a *= 1.0 - bleed * 0.5 * bell;
      b *= 1.0 - wet * 0.35;
      col = mix(a, b, m) + uAccent * wet * 0.25 * uEdge;
    } else if (uType == 2) {
      // Bloom-out: flash to the accent and back, the scene swapping under the light.
      float k = smoothstep(0.15, 0.5, t) * (1.0 - smoothstep(0.5, 0.9, t));
      float m = smoothstep(0.42, 0.58, t);
      col = mix(a, b, m);
      col = col * (1.0 + k * 3.0) + uAccent * k * 2.4 * uEdge;
    } else {
      col = mix(a, b, smoothstep(0.0, 1.0, t));
    }
    gl_FragColor = vec4(col, 1.0);
  }
`

const vertexShader = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = position.xy * 0.5 + 0.5;
    gl_Position = vec4(position.xy, 1.0, 1.0);
  }
`

/**
 * First pass of the story's post chain: composites the outgoing (A) and
 * incoming (B) chapter renders with the chapter's transition shader. With
 * t = 0 it only resamples A (plus the constant, tiny chromatic aberration).
 */
export class TransitionPass extends Pass {
  readonly material: ShaderMaterial

  constructor() {
    super('TransitionPass')
    this.material = new ShaderMaterial({
      uniforms: {
        tA: new Uniform<Texture | null>(null),
        tB: new Uniform<Texture | null>(null),
        uT: new Uniform(0),
        uType: new Uniform(0),
        uAccent: new Uniform(new Color('#ffffff')),
        uTime: new Uniform(0),
        uCA: new Uniform(0.0006),
        uEdge: new Uniform(1),
        uAspect: new Uniform(new Vector2(1, 1)),
      },
      vertexShader,
      fragmentShader,
      depthTest: false,
      depthWrite: false,
    })
    this.fullscreenMaterial = this.material
    this.needsSwap = true
  }

  set inputs([a, b]: [WebGLRenderTarget, WebGLRenderTarget]) {
    this.material.uniforms.tA!.value = a.texture
    this.material.uniforms.tB!.value = b.texture
  }

  override setSize(width: number, height: number) {
    const u = this.material.uniforms.uAspect!.value as Vector2
    u.set(width / Math.max(1, height), 1)
  }

  override render(renderer: WebGLRenderer, _inputBuffer: WebGLRenderTarget | null, outputBuffer: WebGLRenderTarget | null) {
    renderer.setRenderTarget(this.renderToScreen ? null : outputBuffer)
    renderer.render(this.scene, this.camera)
  }

  override dispose() {
    this.material.dispose()
    super.dispose()
  }
}
