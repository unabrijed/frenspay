'use client';

import { useEffect, useRef, useState } from 'react';

import { useCity } from './CityContext';
import { QrCode } from './QrHero';
import { M, PIXELS, QR_H, QR_W } from './qrGeometry';
import { mulberry32 } from './rand';

/* The pixel break, in raw WebGL2 — ~40k point sprites instead of 231 rects.

   No library: a point-sprite system is one program, one buffer set and one
   draw call, so three.js or ogl would be 50–600KB buying nothing.

   The formation is not computed, it is RASTERISED. One helper draws a shape to
   an offscreen 2D canvas and samples its opaque pixels into positions, which
   means the QR and the destination currency mark come from the same eight
   lines — and the glyph sidesteps the font-subsetting problem entirely,
   because we only ever read pixels, never lay out text.

   The SVG QR stays the fallback and is what the server renders, so no-JS,
   reduced-motion, no-WebGL2 and a lost GL context all land on real content
   rather than an empty box. */

const VERT = `#version 300 es
in vec2 aHome;
in vec2 aMorph;
in vec3 aSeed;
in float aTint;
in float aRest;   // resting opacity, sampled from the source artwork's RAMP

uniform vec2 uAnchor;   // centre of the QR box, css px
uniform vec2 uSize;     // size of the QR box, css px
uniform vec2 uRes;      // viewport, css px
uniform vec2 uPointer;  // cursor, css px
uniform float uTime;
uniform float uScroll;  // 0..1 shatter
uniform float uMorph;   // 0..1 QR -> currency mark
uniform float uDpr;

out float vTint;
out float vAlpha;

void main() {
  vec2 p = uAnchor + mix(aHome, aMorph, uMorph) * uSize;

  // Idle drift, so the field is alive even when nothing is happening. Kept well
  // under a pixel: the module pitch is 12px, and anything approaching half a
  // module here means the grid never resolves and the code reads as a smear.
  p += vec2(sin(uTime * (0.3 + aSeed.z * 0.5) + aSeed.x * 6.283),
            cos(uTime * (0.25 + aSeed.y * 0.4) + aSeed.y * 6.283)) * (0.4 + aSeed.z * 0.6);

  // Release. aHome is normalised -0.5..0.5, so its x IS the column — the right
  // edge (the dissolving side) goes first and the finder corner goes last, which
  // is the same left-to-right wave the SVG assembles on, run backwards.
  //
  // Two things make this read as an event rather than as fog: the dead zone,
  // where the code simply holds and nothing moves at all; and the shared
  // heading. Independent per-particle angles average out to an isotropic cloud
  // no matter how they are tuned.
  float col  = aHome.x + 0.5;
  float s    = max(0.0, (uScroll - 0.15) / 0.85);
  float thr  = (1.0 - col) * 0.55;
  float band = clamp((s - thr) / 0.45, 0.0, 1.0);
  band *= band;

  float ang = -0.62 + (aSeed.x - 0.5) * 0.42;   // up and to the right, +-12 degrees
  p += vec2(cos(ang), sin(ang)) * band * 900.0;

  // Cursor wake. Exponential falloff so it is a push, not a force field.
  vec2 d = p - uPointer;
  p += normalize(d + 1e-4) * exp(-length(d) / 90.0) * 18.0;

  // Quantized decay, matching the SVG's RAMP: five steps, not a linear fade.
  // aRest carries that same ramp at rest — on a WebGL machine the SVG is hidden,
  // so if the ramp did not live here too, nobody would ever see it.
  // 4.999 rather than 5.0: at band 0 the latter floors to 5, giving q = 1.25 and
  // an alpha the framebuffer then clamps — which silently merges the top two
  // steps of a five-step ramp back into one.
  float q = floor((1.0 - band) * 4.999) / 4.0;
  vAlpha = aRest * mix(0.30, 1.0, q) * (1.0 - step(0.999, band)) * (0.55 + aSeed.z * 0.45);
  vTint = aTint;

  vec2 clip = (p / uRes) * 2.0 - 1.0;
  gl_Position = vec4(clip.x, -clip.y, 0.0, 1.0);
  // Constant size. Growing the sprites on the way out read as blur, not dispersal.
  gl_PointSize = (1.0 + aSeed.z * 2.2) * uDpr;
}`;

const FRAG = `#version 300 es
precision mediump float;
in float vTint;
in float vAlpha;
out vec4 frag;
void main() {
  vec2 c = gl_PointCoord - 0.5;
  if (dot(c, c) > 0.25) discard;              // round sprite
  vec3 ink = vec3(0.118, 0.106, 0.098);       // #1e1b19
  vec3 terra = vec3(0.651, 0.204, 0.122);     // #a6341f
  frag = vec4(mix(ink, terra, vTint), vAlpha);
}`;

type Cloud = { xy: Float32Array; tint: Float32Array; rest: Float32Array };

/* Draw a shape, read it back, scatter `count` particles over its opaque pixels.
   Positions come out normalised to -0.5..0.5 of the source box, so the shader
   only has to scale them by whatever the QR box measures on screen. The source
   pixel's own alpha rides along as `rest`, which is how the opacity ramp painted
   into the artwork survives into the particle field. */
function rasterise(paint: (ctx: CanvasRenderingContext2D) => void, count: number, seed: number): Cloud {
  const xy = new Float32Array(count * 2);
  const tint = new Float32Array(count);
  const rest = new Float32Array(count);
  const c = document.createElement('canvas');
  c.width = QR_W;
  c.height = QR_H;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  if (!ctx) return { xy, tint, rest };

  paint(ctx);
  const px = ctx.getImageData(0, 0, QR_W, QR_H).data;

  const hx: number[] = [];
  const hy: number[] = [];
  const ht: number[] = [];
  const ha: number[] = [];
  // Threshold well under the ramp's 0.3 floor (~77/255), so the faintest
  // surviving modules still seed particles instead of vanishing entirely.
  for (let i = 0, p = 0; i < px.length; i += 4, p++) {
    if (px[i + 3] < 24) continue;
    hx.push(p % QR_W);
    hy.push((p / QR_W) | 0);
    ht.push(px[i] > 120 ? 1 : 0); // red channel separates terracotta from ink
    ha.push(px[i + 3] / 255);
  }
  if (!hx.length) return { xy, tint, rest };

  const rnd = mulberry32(seed);
  for (let k = 0; k < count; k++) {
    const j = (rnd() * hx.length) | 0;
    // Jitter within the source pixel so repeats don't stack into hard dots.
    xy[k * 2] = (hx[j] + rnd()) / QR_W - 0.5;
    xy[k * 2 + 1] = (hy[j] + rnd()) / QR_H - 0.5;
    tint[k] = ht[j];
    rest[k] = ha[j];
  }
  return { xy, tint, rest };
}

const paintQr = (ctx: CanvasRenderingContext2D) => {
  for (const p of PIXELS) {
    ctx.fillStyle = p.terra ? '#a6341f' : '#1e1b19';
    ctx.globalAlpha = p.o; // the RAMP, carried through to the particles as aRest
    ctx.fillRect(p.x, p.y, M - 2, M - 2);
  }
  ctx.globalAlpha = 1;
};

const paintGlyph = (symbol: string, family: string) => (ctx: CanvasRenderingContext2D) => {
  ctx.fillStyle = '#a6341f';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  // Fit to the same box as the QR, so the morph doesn't stretch either shape.
  ctx.font = `800 ${QR_H * 0.92}px ${family}`;
  const w = ctx.measureText(symbol).width;
  const max = QR_W * 0.8;
  if (w > max) ctx.font = `800 ${QR_H * 0.92 * (max / w)}px ${family}`;
  ctx.fillText(symbol, QR_W / 2, QR_H / 2);
};

function compile(gl: WebGL2RenderingContext, type: number, src: string) {
  const s = gl.createShader(type);
  if (!s) throw new Error('shader');
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) ?? 'shader');
  return s;
}

/* Renders the SVG QR (the fallback, and what the server emits) plus a fixed
   canvas over the viewport. When the canvas comes up the SVG is hidden but
   stays in the layout — it is what the particles are anchored to. */
export function QrStage() {
  const anchor = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [live, setLive] = useState(false);
  const { city } = useCity();

  // The loop owns GL. City changes hand it a symbol and it picks it up on the
  // next frame, rather than a second effect reaching into the context.
  const pending = useRef<string | null>(null);
  const known = useRef(city.symbol);
  useEffect(() => {
    if (known.current === city.symbol) return;
    known.current = city.symbol;
    pending.current = city.symbol;
  }, [city.symbol]);

  useEffect(() => {
    const cv = canvas.current;
    const box = anchor.current;
    if (!cv || !box) return;
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    const gl = cv.getContext('webgl2', { antialias: false, alpha: true, premultipliedAlpha: false });
    if (!gl) return;

    // Scaled to the viewport: a phone gets ~7k, a desktop the full 40k.
    const COUNT = Math.min(40000, Math.max(5000, Math.round((innerWidth * innerHeight) / 45)));

    let prog: WebGLProgram;
    try {
      prog = gl.createProgram()!;
      gl.attachShader(prog, compile(gl, gl.VERTEX_SHADER, VERT));
      gl.attachShader(prog, compile(gl, gl.FRAGMENT_SHADER, FRAG));
      gl.linkProgram(prog);
      if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog) ?? 'link');
    } catch {
      return; // stay on the SVG
    }
    gl.useProgram(prog);

    const home = rasterise(paintQr, COUNT, 20260731);
    const seeds = new Float32Array(COUNT * 3);
    const srnd = mulberry32(20260802);
    for (let i = 0; i < seeds.length; i++) seeds[i] = srnd();

    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    const attach = (name: string, data: Float32Array, size: number, usage: number) => {
      const buf = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      gl.bufferData(gl.ARRAY_BUFFER, data, usage);
      const loc = gl.getAttribLocation(prog, name);
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, size, gl.FLOAT, false, 0, 0);
      return buf;
    };
    attach('aHome', home.xy, 2, gl.STATIC_DRAW);
    // Starts as a copy of home, so uMorph is a no-op until a city is tapped.
    const morphBuf = attach('aMorph', home.xy, 2, gl.DYNAMIC_DRAW);
    attach('aSeed', seeds, 3, gl.STATIC_DRAW);
    attach('aTint', home.tint, 1, gl.STATIC_DRAW);
    attach('aRest', home.rest, 1, gl.STATIC_DRAW);

    const u = (n: string) => gl.getUniformLocation(prog, n);
    const uAnchor = u('uAnchor');
    const uSize = u('uSize');
    const uRes = u('uRes');
    const uPointer = u('uPointer');
    const uTime = u('uTime');
    const uScroll = u('uScroll');
    const uMorph = u('uMorph');
    const uDpr = u('uDpr');

    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

    let dpr = 1;
    const resize = () => {
      dpr = Math.min(devicePixelRatio || 1, 2);
      cv.width = Math.floor(innerWidth * dpr);
      cv.height = Math.floor(innerHeight * dpr);
      gl.viewport(0, 0, cv.width, cv.height);
      gl.uniform2f(uRes, innerWidth, innerHeight);
      gl.uniform1f(uDpr, dpr);
    };
    resize();

    // Parked off-screen until the cursor actually shows up.
    const ptr = { x: -9999, y: -9999 };
    const onMove = (e: PointerEvent) => {
      if (e.pointerType !== 'mouse') return;
      ptr.x = e.clientX;
      ptr.y = e.clientY;
    };
    const onLeave = () => {
      ptr.x = -9999;
      ptr.y = -9999;
    };

    let visible = true;
    const io = new IntersectionObserver(([e]) => (visible = e.isIntersecting), { rootMargin: '20%' });
    io.observe(box);

    let raf = 0;
    let morphAt = -1e9;
    const t0 = performance.now();

    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      if (!visible) return;

      if (pending.current) {
        const symbol = pending.current;
        pending.current = null;
        const family =
          getComputedStyle(document.documentElement).getPropertyValue('--font-hanken').trim() || 'system-ui';
        const cloud = rasterise(paintGlyph(symbol, `${family}, system-ui, sans-serif`), COUNT, 20260803);
        gl.bindBuffer(gl.ARRAY_BUFFER, morphBuf);
        gl.bufferData(gl.ARRAY_BUFFER, cloud.xy, gl.DYNAMIC_DRAW);
        morphAt = now;
      }

      // ponytail: layout read per frame. Nothing in this loop mutates the DOM,
      // so it never forces a reflow; revisit only if a profile says otherwise.
      const r = box.getBoundingClientRect();
      const k = (now - morphAt) / 1700;
      gl.uniform2f(uAnchor, r.left + r.width / 2, r.top + r.height / 2);
      gl.uniform2f(uSize, r.width, r.height);
      gl.uniform2f(uPointer, ptr.x, ptr.y);
      gl.uniform1f(uTime, (now - t0) / 1000);
      gl.uniform1f(uScroll, Math.min(1, scrollY / (innerHeight * 1.6)));
      // Out to the currency mark and back — the QR is the motif, so it returns.
      gl.uniform1f(uMorph, k < 0 || k > 1 ? 0 : Math.sin(k * Math.PI));

      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.drawArrays(gl.POINTS, 0, COUNT);
    };

    const onLost = (e: Event) => {
      e.preventDefault();
      cancelAnimationFrame(raf);
      setLive(false); // back to the SVG
    };

    cv.addEventListener('webglcontextlost', onLost);
    addEventListener('resize', resize);
    addEventListener('pointermove', onMove);
    document.addEventListener('pointerleave', onLeave);
    raf = requestAnimationFrame(frame);
    setLive(true);

    return () => {
      cancelAnimationFrame(raf);
      io.disconnect();
      cv.removeEventListener('webglcontextlost', onLost);
      removeEventListener('resize', resize);
      removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerleave', onLeave);
      gl.getExtension('WEBGL_lose_context')?.loseContext();
    };
  }, []);

  return (
    <>
      <div ref={anchor} className={live ? 'invisible' : undefined}>
        <QrCode />
      </div>
      <canvas ref={canvas} aria-hidden className="pointer-events-none fixed inset-0 z-[4] h-full w-full" />
    </>
  );
}
