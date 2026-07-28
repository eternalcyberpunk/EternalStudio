/**
 * animation/keyframes.ts
 * Evaluation of animated parameters. Any numeric parameter anywhere in the
 * application — node params, clip opacity, 3D transforms, material values —
 * becomes animatable by storing a Keyframe[] against its name.
 *
 * Functional: linear/hold/ease/spring interpolation, insert & remove keys,
 * value sampling at arbitrary time, curve sampling for the graph editor.
 * Planned: per-key bezier handles exposed in the UI, expressions, audio-reactive
 * drivers, animation layers and blending.
 */

import type { EaseKind, GraphNode, Keyframe } from '../core/types';

export function ease(kind: EaseKind, t: number): number {
  switch (kind) {
    case 'hold':
      return 0;
    case 'easeIn':
      return t * t * t;
    case 'easeOut':
      return 1 - Math.pow(1 - t, 3);
    case 'easeInOut':
      return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
    case 'spring': {
      // Critically-ish damped overshoot, normalised to land on 1 at t=1.
      const c = 8;
      return 1 - Math.exp(-c * t) * Math.cos(10 * t * (1 - t) * Math.PI);
    }
    case 'linear':
    default:
      return t;
  }
}

export function sample(keys: Keyframe[], time: number, fallback = 0): number {
  if (!keys || keys.length === 0) return fallback;
  if (keys.length === 1) return keys[0].v;
  const sorted = keys;
  if (time <= sorted[0].t) return sorted[0].v;
  if (time >= sorted[sorted.length - 1].t) return sorted[sorted.length - 1].v;
  for (let i = 0; i < sorted.length - 1; i++) {
    const a = sorted[i];
    const b = sorted[i + 1];
    if (time >= a.t && time <= b.t) {
      const span = b.t - a.t || 1e-6;
      const t = ease(a.ease, (time - a.t) / span);
      return a.v + (b.v - a.v) * t;
    }
  }
  return fallback;
}

export function insertKey(keys: Keyframe[], key: Keyframe): Keyframe[] {
  const without = keys.filter((k) => Math.abs(k.t - key.t) > 1e-4);
  return [...without, key].sort((a, b) => a.t - b.t);
}

export function removeKey(keys: Keyframe[], time: number): Keyframe[] {
  return keys.filter((k) => Math.abs(k.t - time) > 1e-4);
}

/** Resolve every param of a node at a given time, animated or static. */
export function resolveParams(node: GraphNode, time: number): Record<string, number | string | boolean> {
  const out: Record<string, number | string | boolean> = { ...node.params };
  for (const [name, keys] of Object.entries(node.animations ?? {})) {
    if (keys && keys.length) out[name] = sample(keys, time, Number(node.params[name] ?? 0));
  }
  return out;
}

/** Dense samples for drawing a curve in the graph editor. */
export function sampleCurve(keys: Keyframe[], from: number, to: number, steps = 240): Array<[number, number]> {
  const pts: Array<[number, number]> = [];
  for (let i = 0; i <= steps; i++) {
    const t = from + ((to - from) * i) / steps;
    pts.push([t, sample(keys, t)]);
  }
  return pts;
}

export function valueRange(keys: Keyframe[]): [number, number] {
  if (!keys.length) return [0, 1];
  let min = Infinity;
  let max = -Infinity;
  for (const k of keys) {
    min = Math.min(min, k.v);
    max = Math.max(max, k.v);
  }
  if (min === max) {
    min -= 0.5;
    max += 0.5;
  }
  const pad = (max - min) * 0.15;
  return [min - pad, max + pad];
}
