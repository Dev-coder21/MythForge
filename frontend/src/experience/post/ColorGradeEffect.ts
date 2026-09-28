import { BlendFunction, Effect } from 'postprocessing'
import { Color, Uniform } from 'three'

const fragmentShader = /* glsl */ `
  uniform vec3 uTint;
  uniform float uLift;
  uniform float uSaturation;
  uniform float uExposure;

  void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
    vec3 c = inputColor.rgb * uExposure;
    float luma = dot(c, vec3(0.2126, 0.7152, 0.0722));
    // Lift shadows toward the tint; highlights stay untouched.
    float shadows = 1.0 - smoothstep(0.0, 0.5, luma);
    c += uTint * uLift * shadows;
    c = mix(vec3(luma), c, uSaturation);
    outputColor = vec4(c, inputColor.a);
  }
`

export interface ColorGradeOptions {
  tint?: Color
  lift?: number
  saturation?: number
}

/** Grade after tone mapping: exposure (reading dim), tinted shadow lift, saturation. */
export class ColorGradeEffect extends Effect {
  constructor({ tint = new Color('#000000'), lift = 0.03, saturation = 1 }: ColorGradeOptions = {}) {
    super('ColorGradeEffect', fragmentShader, {
      blendFunction: BlendFunction.NORMAL,
      uniforms: new Map<string, Uniform>([
        ['uTint', new Uniform(tint)],
        ['uLift', new Uniform(lift)],
        ['uSaturation', new Uniform(saturation)],
        ['uExposure', new Uniform(1)],
      ]),
    })
  }
}
