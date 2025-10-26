'use client';

import React, { forwardRef } from 'react';
import { Shader } from 'react-shaders';
import { cn } from '@/lib/utils';

const auroraShaderSource = `
#ifdef GL_OES_standard_derivatives
#extension GL_OES_standard_derivatives : enable
#endif

// Fibonacci-based random noise
vec2 randFibo(vec2 p) {
  p = fract(p * vec2(443.897, 441.423));
  p += dot(p, p.yx + 19.19);
  return fract((p.xx + p.yx) * p.xy);
}

// Blend modes
vec3 blend(int mode, vec3 a, vec3 b) {
  if(mode == 1) return a * b; // Multiply
  if(mode == 2) return 1.0 - (1.0 - a) * (1.0 - b); // Screen
  if(mode == 3) return a + b; // Add
  return b; // Normal
}

const float PI = 3.14159265359;
const float TAU = 6.28318530718;

vec3 pal( in float t, in vec3 a, in vec3 b, in vec3 c, in vec3 d ) {
    return a + b*cos( TAU*(c*t+d) );
}

vec3 Tonemap_Reinhard(vec3 x) {
  x *= 4.;
  return x / (1.0 + x);
}

float sdCircle(vec2 st, float r) {
  return length(st) - r;
}

float sdEllipse(vec2 st, float r) {
  float a =  length(st + vec2(0, r * 0.8)) - r;
  float b = length(st + vec2(0, -r * 0.8)) - r;
  return (a + b);
}

float sdArc(vec2 st, float r) {
  return length(st * vec2(0, r)) - r;
}

float sdLine(vec2 p, float r) {
  float halfLen = r * 2.;
  vec2 a = vec2(-halfLen, 0.0);
  vec2 b = vec2(halfLen, 0.0);
  vec2 pa = p - a;
  vec2 ba = b - a;
  float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
  return length(pa - ba * h);
}

float sdBox(vec2 p, float r, float md) {
    vec2 q = abs(p)-vec2(r);
    return length(max(q,0.0)) + min(max(q.x,q.y),0.0) - r * mix(0., 0.3333 * md, uAmplitude);
}

float sdEquilateralTriangle(vec2 p, float r, float md) {
  const float k = sqrt(3.0);
  p.x = abs(p.x) - r;
  p.y = p.y + r/k;
  if( p.x+k*p.y>0.0 ) p = vec2(p.x-k*p.y,-k*p.x-p.y)/2.0;
  p.x -= clamp( p.x, -2.0*r, 0.0 );
  return -length(p)*sign(p.y) - r * mix(0., 0.3333 * md, uAmplitude);
}

float median(float r, float g, float b) {
  return max(min(r, g), min(max(r, g), b));
}

float screenPxRange(vec2 uv) {
  vec2 unitRange = 85./vec2(512);
  vec2 screenTexSize = vec2(1.0)/fwidth(uv);
  return max(0.5*dot(unitRange, screenTexSize), 1.0);
}

float sdCustom(vec2 uv) {
  // Custom texture shape support disabled for WebGL 1.0 compatibility
  return 1.;
}

float getSdf(vec2 st, float iter, float md) {
  // Convert switch to if-else for WebGL 1.0 compatibility
  if(uShape == 0) return sdCustom(st);
  else if(uShape == 1) return sdCircle(st, uScale);
  else if(uShape == 2) return sdEllipse(st, uScale);
  else if(uShape == 3) return sdLine(st, uScale);
  else if(uShape == 4) return sdBox(st, uScale, md);
  else if(uShape == 5) return sdEquilateralTriangle(st, uScale, md);
  else return 0.;
}

vec2 turb(vec2 pos, float t, float it, float md, vec2 mPos) {
  mat2 rot = mat2(0.6, -0.8, 0.8,  0.6);
  float freq = mix(2., 15., uFrequency);
  float amp = (uAmplitude) * md;
  float xp = 1.4;
  float time = t * 0.1 + uPhase;
  
  for(float i = 0.; i < 4.; i++) {
    vec2 s = sin(freq * ((pos - mPos) * rot) + i * time + it);
    pos += amp * rot[0] * s / freq;
    rot *= mat2(0.6, -0.8, 0.8,  0.6);
    amp *= mix(1., max(s.y, s.x), uVariance);
    freq *= xp;
  }

  return pos;
}


float luma(vec3 color) {
  return dot(color, vec3(0.299, 0.587, 0.114));
}

const float ITERATIONS = 36.;

float expApprox(float x) {
    x = clamp(x, -4.0, 4.0);
    float x2 = x * x;
    return 1.0 + x + 0.5 * x2 + (1.0/6.0) * x2 * x;
  }

void mainImage(out vec4 fragColor, in vec2 fragCoord) {
  vec2 uv = fragCoord / iResolution.xy;
  vec4 bg = vec4(0.0); // Background disabled for now
  
  vec3 pp = vec3(0.);
  vec3 bloom = vec3(0.);
  float t = (iTime * uSpeed) * 0.5 + uPhase;
  vec2 aspect = vec2(uResolution.x/uResolution.y, 1);
  vec2 mousePos = mix(vec2(0), uMousePos - 0.5, uTrackMouse);
  vec2 pos = (uv * aspect - uPos * aspect);
  float mDist = length(uv * aspect - uMousePos * aspect);
  float md = mix(1., smoothstep(1., 5., 1./mDist), uMouseInfluence);
  float rotation = uAngle * -2.0 * 3.14159265359;
  mat2 rotMatrix = mat2(cos(rotation), -sin(rotation), sin(rotation), cos(rotation));
  pos = rotMatrix * pos;
  float bm = 0.05;

  // #ifelseopen
  if(uShape == 0) {
    bm = 0.2;
  }
  // #ifelseclose
      
  vec2 prevPos = turb(pos, t, 0. - 1./ITERATIONS, md, mousePos);
  float spacing =  mix(1., TAU, uSpacing);
  float smoothing = uShape == 0 ? uSmoothing * 2. : uSmoothing;
  
  for(float i = 1.; i < ITERATIONS + 1.; i++) {
    float iter = i/ITERATIONS;
    vec2 st = turb(pos, t, iter * spacing, md, mousePos);
    float d = abs(getSdf(st, iter, md));
    float pd = distance(st, prevPos);
    prevPos = st;
    float dynamicBlur = exp2(pd * 2.0 * 1.4426950408889634) - 1.0;
    float ds = smoothstep(0., uBlur * bm + max(dynamicBlur * smoothing, 0.001), d);
    
    // Simplified color system that actually respects the colorPhase
    // Each colorPhase component directly controls that channel's intensity
    float t_val = iter * mix(0.5, 2.5, uColorScale) + uColorPosition;
    
    // Generate a gradient value that varies across iterations
    float gradient = sin(t_val * 6.28318530718) * 0.5 + 0.5;
    
    // Use colorPhase as base color multipliers, modulated by the gradient
    vec3 color = uColor * (0.5 + gradient * 0.5);
    
    // Boost overall brightness
    color = clamp(color * 2.0, 0.0, 1.0);
    
    float invd = 1./max(d + dynamicBlur, 0.001);
    pp += (ds - 1.) * color;
    bloom += clamp(invd, 0., 250.) * color;
  }

  pp *= 1./ITERATIONS;
  bloom = bloom / (bloom + 2e4);
  
  // #ifelseopen
  if(uShape == 0) {
    pp *= 2.;
    bloom *= 2.;
  }
  // #ifelseclose  


  vec3 color = (-pp + bloom * 3. * uBloom);
  color *= 1.2;
  color += (randFibo(fragCoord).x - 0.5) / 255.0;
  color = (Tonemap_Reinhard(color));
  vec4 auroraColor = vec4(color, 1.);    
  
  if(uBlendMode > 0) {
    auroraColor.rgb = blend(uBlendMode, bg.rgb, auroraColor.rgb);
  }

  auroraColor = vec4(mix(bg.rgb, auroraColor.rgb, uMix), max(bg.a, luma(auroraColor.rgb)));

  fragColor = auroraColor;
}
`;

export interface AuroraShadersProps extends React.HTMLAttributes<HTMLDivElement> {
  /**
   * Aurora wave speed
   * @default 1.0
   */
  speed?: number;

  /**
   * Light intensity (bloom)
   * @default 2.0
   */
  intensity?: number;

  /**
   * Turbulence amplitude
   * @default 0.5
   */
  amplitude?: number;

  /**
   * Wave frequency and complexity
   * @default 0.5
   */
  frequency?: number;

  /**
   * Shape scale
   * @default 0.3
   */
  scale?: number;

  /**
   * Edge blur/softness
   * @default 1.0
   */
  blur?: number;

  /**
   * Shape type: 1=circle, 2=ellipse, 3=line, 4=box, 5=triangle
   * @default 1
   */
  shape?: number;

  /**
   * Color palette offset - shifts colors along the gradient (0-1)
   * Lower values shift toward start colors, higher toward end colors
   * @default 0.5
   * @example 0.0 - cool tones dominate
   * @example 0.5 - balanced (default)
   * @example 1.0 - warm tones dominate
   */
  colorPosition?: number;

  /**
   * Color variation across layers (0-1)
   * Controls how much colors change between iterations
   * @default 0.5
   * @example 0.0 - minimal color variation (more uniform)
   * @example 0.5 - moderate variation (default)
   * @example 1.0 - maximum variation (rainbow effect)
   */
  colorScale?: number;

  /**
   * Base color multipliers for RGB channels (values 0-1)
   * Each value controls the intensity of that color channel
   * @default [0.3, 0.8, 1.0] - cyan/blue (low red, high green, high blue)
   * @example [0.3, 0.8, 1.0] - cyan shades (default)
   * @example [1.0, 0.3, 0.5] - pink/magenta shades
   * @example [1.0, 0.5, 0.2] - orange/warm shades
   * @example [0.4, 1.0, 0.4] - green shades
   * @example [0.6, 0.4, 1.0] - purple shades
   * @example [1.0, 1.0, 1.0] - white/neutral
   */
  colorPhase?: [number, number, number];
}

export const AuroraShaders = forwardRef<HTMLDivElement, AuroraShadersProps>(
  (
    {
      className,
      speed = 1.0,
      intensity = 2.0,
      amplitude = 0.5,
      frequency = 0.5,
      scale = 0.3,
      blur = 1.0,
      shape = 1,
      colorPosition = 0.5,
      colorScale = 0.5,
      colorPhase = [0.3, 0.8, 1.0],
      ...props
    },
    ref
  ) => {
    return (
      <div ref={ref} className={cn('h-full w-full', className)} {...props}>
        <Shader
          fs={auroraShaderSource}
          uniforms={{
            uSpeed: { type: '1f', value: speed },
            uResolution: { type: '2f', value: [1, 1] },
            uMousePos: { type: '2f', value: [0.5, 0.5] },
            uTrackMouse: { type: '1f', value: 0 },
            uPos: { type: '2f', value: [0.5, 0.5] },
            uBlur: { type: '1f', value: blur },
            uScale: { type: '1f', value: scale },
            uFrequency: { type: '1f', value: frequency },
            uAngle: { type: '1f', value: 0 },
            uAmplitude: { type: '1f', value: amplitude },
            uBloom: { type: '1f', value: intensity },
            uMix: { type: '1f', value: 1.0 },
            uSpacing: { type: '1f', value: 0.5 },
            uBlendMode: { type: '1i', value: 0 },
            uShape: { type: '1i', value: shape },
            uColorScale: { type: '1f', value: colorScale },
            uColorPosition: { type: '1f', value: colorPosition },
            uVariance: { type: '1f', value: 0.5 },
            uSmoothing: { type: '1f', value: 0.2 },
            uPhase: { type: '1f', value: 0 },
            uMouseInfluence: { type: '1f', value: 0 },
            uColor: { type: '3f', value: colorPhase },
          }}
          style={{ width: '100%', height: '100%' } as CSSStyleDeclaration}
        />
      </div>
    );
  }
);

AuroraShaders.displayName = 'AuroraShaders';

export default AuroraShaders;
