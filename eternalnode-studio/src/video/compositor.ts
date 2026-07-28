/**
 * video/compositor.ts
 * The GPU image pipeline. Takes one source frame (the flattened timeline layer
 * canvas) and runs the pass list produced by the node evaluator through
 * ping-pong framebuffers, then blits the result to the visible canvas.
 *
 * Functional: WebGL2 context, texture upload, ping-pong FBOs, seven real
 * shader passes, resize handling, readback for export.
 * Planned: WebGPU backend, float/HDR working space, tiled rendering for 8K,
 * multi-input merges, LUT loading, and the native Vulkan renderer the Qt build
 * will swap in behind this same interface.
 */

import type { EffectPass } from '../nodes/evaluator';
import { hexToRgb } from '../core/utils';

const VERT = `#version 300 es
in vec2 aPos;
out vec2 vUv;
void main() {
  vUv = aPos * 0.5 + 0.5;
  gl_Position = vec4(aPos, 0.0, 1.0);
}`;

const HEAD = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 fragColor;
uniform sampler2D uTex;
uniform vec2 uRes;
uniform float uTime;
`;

const FRAGMENTS: Record<string, string> = {
  copy: `${HEAD}
void main() { fragColor = texture(uTex, vUv); }`,

  grade: `${HEAD}
uniform float uExposure, uContrast, uSaturation, uTemperature, uTintAmount;
uniform vec3 uTint;
void main() {
  vec4 c = texture(uTex, vUv);
  vec3 rgb = c.rgb * pow(2.0, uExposure);
  rgb += vec3(uTemperature * 0.08, 0.0, -uTemperature * 0.08);
  rgb = (rgb - 0.5) * uContrast + 0.5;
  float l = dot(rgb, vec3(0.2126, 0.7152, 0.0722));
  rgb = mix(vec3(l), rgb, uSaturation);
  rgb = mix(rgb, rgb * uTint * 1.4, uTintAmount);
  fragColor = vec4(clamp(rgb, 0.0, 1.0), c.a);
}`,

  glow: `${HEAD}
uniform float uThreshold, uIntensity, uRadius;
void main() {
  vec4 base = texture(uTex, vUv);
  vec2 px = uRadius / uRes;
  vec3 bloom = vec3(0.0);
  float total = 0.0;
  for (int i = 0; i < 16; i++) {
    float a = float(i) * 0.3926991;
    float r = 1.0 + float(i % 4) * 1.6;
    vec2 offset = vec2(cos(a), sin(a)) * px * r;
    vec3 s = texture(uTex, vUv + offset).rgb;
    float lum = dot(s, vec3(0.2126, 0.7152, 0.0722));
    float w = smoothstep(uThreshold, uThreshold + 0.25, lum);
    bloom += s * w;
    total += 1.0;
  }
  bloom /= total;
  fragColor = vec4(base.rgb + bloom * uIntensity, base.a);
}`,

  corruption: `${HEAD}
uniform float uAmount, uBlockSize, uShift, uSpeed;
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
void main() {
  float t = floor(uTime * uSpeed * 12.0);
  vec2 block = floor(vUv * uRes / max(uBlockSize, 1.0));
  float n = hash(block + t);
  float active = step(1.0 - uAmount * 0.35, n);
  vec2 uv = vUv;
  uv.x += (hash(vec2(block.y, t)) - 0.5) * 0.12 * uAmount * active;
  float sh = uShift / uRes.x * (1.0 + active * 6.0);
  float r = texture(uTex, uv + vec2(sh, 0.0)).r;
  float g = texture(uTex, uv).g;
  float b = texture(uTex, uv - vec2(sh, 0.0)).b;
  float a = texture(uTex, uv).a;
  vec3 c = vec3(r, g, b);
  float drop = step(0.995, hash(vec2(floor(vUv.y * 200.0), t)));
  c = mix(c, vec3(hash(vec2(vUv.y, t))), drop * uAmount * 0.6);
  fragColor = vec4(c, a);
}`,

  grain: `${HEAD}
uniform float uAmount, uSize, uChroma;
float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
void main() {
  vec4 c = texture(uTex, vUv);
  vec2 p = floor(vUv * uRes / max(uSize, 0.25)) + floor(uTime * 60.0);
  float mono = hash(p) - 0.5;
  vec3 chroma = vec3(hash(p + 1.0), hash(p + 2.0), hash(p + 3.0)) - 0.5;
  vec3 noise = mix(vec3(mono), chroma, uChroma);
  fragColor = vec4(clamp(c.rgb + noise * uAmount, 0.0, 1.0), c.a);
}`,

  scanlines: `${HEAD}
uniform float uDensity, uStrength, uRoll;
void main() {
  vec4 c = texture(uTex, vUv);
  float line = sin((vUv.y + uTime * uRoll * 0.1) * uDensity * 3.14159);
  float mask = 1.0 - uStrength * 0.5 * (0.5 + 0.5 * line);
  float bar = smoothstep(0.0, 0.08, abs(fract(vUv.y - uTime * uRoll * 0.25) - 0.5));
  fragColor = vec4(c.rgb * mask * mix(1.0, bar, uStrength * 0.35), c.a);
}`,

  vignette: `${HEAD}
uniform float uAmount, uRadius;
void main() {
  vec4 c = texture(uTex, vUv);
  float d = distance(vUv, vec2(0.5)) / uRadius;
  float f = smoothstep(1.0, 0.35, d);
  fragColor = vec4(c.rgb * mix(1.0, f, uAmount), c.a);
}`,

  transform: `${HEAD}
uniform float uScale, uOffsetX, uOffsetY, uRotation;
void main() {
  vec2 uv = vUv - 0.5;
  float r = radians(uRotation);
  uv = mat2(cos(r), -sin(r), sin(r), cos(r)) * uv;
  uv /= max(uScale, 0.001);
  uv -= vec2(uOffsetX, -uOffsetY);
  uv += 0.5;
  vec4 c = texture(uTex, uv);
  float inside = step(0.0, uv.x) * step(uv.x, 1.0) * step(0.0, uv.y) * step(uv.y, 1.0);
  fragColor = vec4(c.rgb * inside, c.a * inside);
}`,

  timestamp: `${HEAD}
uniform sampler2D uOverlay;
uniform float uOpacity;
void main() {
  vec4 base = texture(uTex, vUv);
  vec4 ov = texture(uOverlay, vUv);
  fragColor = vec4(mix(base.rgb, ov.rgb, ov.a * uOpacity), base.a);
}`,
};

interface Target {
  fbo: WebGLFramebuffer;
  tex: WebGLTexture;
}

export class Compositor {
  private gl: WebGL2RenderingContext;
  private programs = new Map<string, WebGLProgram>();
  private targets: [Target, Target] | null = null;
  private sourceTex: WebGLTexture;
  private overlayTex: WebGLTexture;
  private overlayCanvas = document.createElement('canvas');
  private width = 0;
  private height = 0;

  constructor(private canvas: HTMLCanvasElement) {
    const gl = canvas.getContext('webgl2', { premultipliedAlpha: false, preserveDrawingBuffer: true });
    if (!gl) throw new Error('WebGL2 is required. Update your GPU driver or browser.');
    this.gl = gl;

    const quad = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, quad);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);

    for (const [key, frag] of Object.entries(FRAGMENTS)) {
      this.programs.set(key, this.compile(VERT, frag));
    }
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

    this.sourceTex = this.makeTexture();
    this.overlayTex = this.makeTexture();
    this.overlayCanvas.width = 1024;
    this.overlayCanvas.height = 256;
  }

  private compile(vs: string, fs: string): WebGLProgram {
    const gl = this.gl;
    const make = (type: number, src: string) => {
      const sh = gl.createShader(type)!;
      gl.shaderSource(sh, src);
      gl.compileShader(sh);
      if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
        throw new Error(`Shader failed to compile: ${gl.getShaderInfoLog(sh)}`);
      }
      return sh;
    };
    const prog = gl.createProgram()!;
    gl.attachShader(prog, make(gl.VERTEX_SHADER, vs));
    gl.attachShader(prog, make(gl.FRAGMENT_SHADER, fs));
    // Pin the attribute slot so one buffer binding serves every program.
    gl.bindAttribLocation(prog, 0, 'aPos');
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      throw new Error(`Program failed to link: ${gl.getProgramInfoLog(prog)}`);
    }
    return prog;
  }

  private makeTexture(): WebGLTexture {
    const gl = this.gl;
    const tex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    return tex;
  }

  resize(width: number, height: number): void {
    if (this.width === width && this.height === height && this.targets) return;
    const gl = this.gl;
    this.width = width;
    this.height = height;
    this.canvas.width = width;
    this.canvas.height = height;

    if (this.targets) {
      for (const t of this.targets) {
        gl.deleteFramebuffer(t.fbo);
        gl.deleteTexture(t.tex);
      }
    }
    const build = (): Target => {
      const tex = this.makeTexture();
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      const fbo = gl.createFramebuffer()!;
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
      return { fbo, tex };
    };
    this.targets = [build(), build()];
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  private setUniforms(prog: WebGLProgram, params: Record<string, number | string | boolean>, time: number): void {
    const gl = this.gl;
    gl.uniform2f(gl.getUniformLocation(prog, 'uRes'), this.width, this.height);
    gl.uniform1f(gl.getUniformLocation(prog, 'uTime'), time);
    gl.uniform1i(gl.getUniformLocation(prog, 'uTex'), 0);

    for (const [name, value] of Object.entries(params)) {
      const uniform = `u${name[0].toUpperCase()}${name.slice(1)}`;
      const loc = gl.getUniformLocation(prog, uniform);
      if (!loc) continue;
      if (typeof value === 'number') gl.uniform1f(loc, value);
      else if (typeof value === 'boolean') gl.uniform1f(loc, value ? 1 : 0);
      else if (typeof value === 'string' && value.startsWith('#')) {
        const [r, g, b] = hexToRgb(value);
        gl.uniform3f(loc, r, g, b);
      }
    }
  }

  /** Draws the burned-in timestamp used by the Timestamp Overlay node. */
  private updateOverlay(text: string, scale: number): void {
    const c = this.overlayCanvas;
    const ctx = c.getContext('2d')!;
    ctx.clearRect(0, 0, c.width, c.height);
    ctx.font = `${Math.round(46 * scale)}px "JetBrains Mono", monospace`;
    ctx.fillStyle = '#e8fdff';
    ctx.shadowColor = 'rgba(0,0,0,0.8)';
    ctx.shadowBlur = 8;
    ctx.fillText(text, 40, 80);
    ctx.fillStyle = '#ff2d8a';
    ctx.beginPath();
    ctx.arc(c.width - 70, 62, 14 * scale, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#e8fdff';
    ctx.font = `${Math.round(34 * scale)}px "JetBrains Mono", monospace`;
    ctx.fillText('REC', c.width - 190, 74);

    const gl = this.gl;
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.overlayTex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, c);
    gl.activeTexture(gl.TEXTURE0);
  }

  /**
   * @param source  Flattened layer canvas for this frame.
   * @param passes  Ordered node passes from the evaluator.
   * @param time    Sequence time, drives animated shader noise.
   * @param overlayText Timestamp string for the overlay pass.
   */
  render(source: TexImageSource, passes: EffectPass[], time: number, overlayText = ''): void {
    const gl = this.gl;
    if (!this.targets) this.resize(this.canvas.width || 1280, this.canvas.height || 720);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.sourceTex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);

    gl.viewport(0, 0, this.width, this.height);

    const runnable = passes.filter((p) => this.programs.has(p.pass));
    let input = this.sourceTex;
    let pingIndex = 0;

    const draw = (prog: WebGLProgram, tex: WebGLTexture, target: WebGLFramebuffer | null) => {
      gl.bindFramebuffer(gl.FRAMEBUFFER, target);
      gl.useProgram(prog);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    };

    if (runnable.length === 0) {
      const prog = this.programs.get('copy')!;
      gl.useProgram(prog);
      this.setUniforms(prog, {}, time);
      draw(prog, this.sourceTex, null);
      return;
    }

    runnable.forEach((pass, i) => {
      const prog = this.programs.get(pass.pass)!;
      const last = i === runnable.length - 1;
      const target = last ? null : this.targets![pingIndex].fbo;
      gl.useProgram(prog);
      this.setUniforms(prog, pass.params, time);

      if (pass.pass === 'timestamp') {
        this.updateOverlay(overlayText, Number(pass.params.scale ?? 1));
        gl.uniform1i(gl.getUniformLocation(prog, 'uOverlay'), 1);
        gl.activeTexture(gl.TEXTURE1);
        gl.bindTexture(gl.TEXTURE_2D, this.overlayTex);
      }

      draw(prog, input, target);
      if (!last) {
        input = this.targets![pingIndex].tex;
        pingIndex = 1 - pingIndex;
      }
    });

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  get element(): HTMLCanvasElement {
    return this.canvas;
  }
}
