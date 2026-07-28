/**
 * nodes/registry.ts
 * The catalogue of node types. One registry serves the compositor, the material
 * editor and the geometry graph, so a user learns one node language.
 *
 * A node definition declares its ports, its parameters and — for image
 * operators — the GPU pass the compositor should run. Plugins register new
 * definitions through the same API (see plugins/api.ts), which is how the
 * marketplace and Node Capsules extend the app without touching core.
 */

import type { GraphNode, PortType } from '../core/types';
import { uid } from '../core/utils';

export interface ParamDef {
  name: string;
  label: string;
  type: 'number' | 'color' | 'text' | 'bool' | 'select';
  default: number | string | boolean;
  min?: number;
  max?: number;
  step?: number;
  options?: string[];
  animatable?: boolean;
}

export interface PortDef {
  name: string;
  label: string;
  type: PortType;
}

export type NodeCategory =
  | 'Input'
  | 'Color'
  | 'Stylize'
  | 'Distort'
  | 'Composite'
  | '3D'
  | 'Material'
  | 'Geometry'
  | 'AI'
  | 'Output';

export interface NodeDef {
  type: string;
  title: string;
  category: NodeCategory;
  accent: PortType;
  inputs: PortDef[];
  outputs: PortDef[];
  params: ParamDef[];
  /** Compositor pass key. Absent = not an image operator (yet). */
  pass?: string;
  /** Shown on the node card when the feature is not fully implemented. */
  status?: 'planned';
  description: string;
}

const v = (name = 'in', label = 'Video'): PortDef => ({ name, label, type: 'video' });

export const NODE_DEFS: NodeDef[] = [
  {
    type: 'source',
    title: 'Media Source',
    category: 'Input',
    accent: 'video',
    inputs: [],
    outputs: [v('out', 'Video')],
    params: [],
    description: 'The composited timeline frame at the current time.',
  },
  {
    type: 'grade',
    title: 'Color Grade',
    category: 'Color',
    accent: 'video',
    inputs: [v()],
    outputs: [v('out')],
    pass: 'grade',
    params: [
      { name: 'exposure', label: 'Exposure', type: 'number', default: 0, min: -3, max: 3, step: 0.01, animatable: true },
      { name: 'contrast', label: 'Contrast', type: 'number', default: 1, min: 0, max: 3, step: 0.01, animatable: true },
      { name: 'saturation', label: 'Saturation', type: 'number', default: 1, min: 0, max: 3, step: 0.01, animatable: true },
      { name: 'temperature', label: 'Temperature', type: 'number', default: 0, min: -1, max: 1, step: 0.01, animatable: true },
      { name: 'tint', label: 'Tint', type: 'color', default: '#8bd8ff' },
      { name: 'tintAmount', label: 'Tint Amount', type: 'number', default: 0, min: 0, max: 1, step: 0.01, animatable: true },
    ],
    description: 'Exposure, contrast, saturation and a tint pass.',
  },
  {
    type: 'glow',
    title: 'Glow',
    category: 'Stylize',
    accent: 'video',
    inputs: [v()],
    outputs: [v('out')],
    pass: 'glow',
    params: [
      { name: 'threshold', label: 'Threshold', type: 'number', default: 0.6, min: 0, max: 1, step: 0.01, animatable: true },
      { name: 'intensity', label: 'Intensity', type: 'number', default: 0.8, min: 0, max: 3, step: 0.01, animatable: true },
      { name: 'radius', label: 'Radius', type: 'number', default: 3, min: 0.5, max: 12, step: 0.1, animatable: true },
    ],
    description: 'Threshold bloom with a separable blur.',
  },
  {
    type: 'corruption',
    title: 'Signal Corruption',
    category: 'Distort',
    accent: 'video',
    inputs: [v()],
    outputs: [v('out')],
    pass: 'corruption',
    params: [
      { name: 'amount', label: 'Amount', type: 'number', default: 0.35, min: 0, max: 1, step: 0.01, animatable: true },
      { name: 'blockSize', label: 'Block Size', type: 'number', default: 16, min: 2, max: 120, step: 1, animatable: true },
      { name: 'shift', label: 'RGB Shift', type: 'number', default: 0.4, min: 0, max: 3, step: 0.01, animatable: true },
      { name: 'speed', label: 'Speed', type: 'number', default: 1, min: 0, max: 6, step: 0.01, animatable: true },
    ],
    description: 'Block displacement and channel separation for damaged-signal looks.',
  },
  {
    type: 'grain',
    title: 'Digital Noise',
    category: 'Stylize',
    accent: 'video',
    inputs: [v()],
    outputs: [v('out')],
    pass: 'grain',
    params: [
      { name: 'amount', label: 'Amount', type: 'number', default: 0.12, min: 0, max: 1, step: 0.01, animatable: true },
      { name: 'size', label: 'Size', type: 'number', default: 1, min: 0.25, max: 6, step: 0.05, animatable: true },
      { name: 'chroma', label: 'Chroma Noise', type: 'number', default: 0.3, min: 0, max: 1, step: 0.01, animatable: true },
    ],
    description: 'Animated sensor grain with optional chroma noise.',
  },
  {
    type: 'scanlines',
    title: 'CRT Scanlines',
    category: 'Stylize',
    accent: 'video',
    inputs: [v()],
    outputs: [v('out')],
    pass: 'scanlines',
    params: [
      { name: 'density', label: 'Density', type: 'number', default: 320, min: 40, max: 1200, step: 1, animatable: true },
      { name: 'strength', label: 'Strength', type: 'number', default: 0.25, min: 0, max: 1, step: 0.01, animatable: true },
      { name: 'roll', label: 'Roll Speed', type: 'number', default: 0.15, min: -2, max: 2, step: 0.01, animatable: true },
    ],
    description: 'Horizontal line structure with a rolling refresh bar.',
  },
  {
    type: 'vignette',
    title: 'Vignette',
    category: 'Color',
    accent: 'video',
    inputs: [v()],
    outputs: [v('out')],
    pass: 'vignette',
    params: [
      { name: 'amount', label: 'Amount', type: 'number', default: 0.4, min: 0, max: 1, step: 0.01, animatable: true },
      { name: 'radius', label: 'Radius', type: 'number', default: 0.75, min: 0.1, max: 1.5, step: 0.01, animatable: true },
    ],
    description: 'Radial falloff toward the frame edge.',
  },
  {
    type: 'transform',
    title: 'Transform',
    category: 'Composite',
    accent: 'video',
    inputs: [v()],
    outputs: [v('out')],
    pass: 'transform',
    params: [
      { name: 'scale', label: 'Scale', type: 'number', default: 1, min: 0.1, max: 4, step: 0.01, animatable: true },
      { name: 'offsetX', label: 'Offset X', type: 'number', default: 0, min: -1, max: 1, step: 0.001, animatable: true },
      { name: 'offsetY', label: 'Offset Y', type: 'number', default: 0, min: -1, max: 1, step: 0.001, animatable: true },
      { name: 'rotation', label: 'Rotation', type: 'number', default: 0, min: -180, max: 180, step: 0.1, animatable: true },
    ],
    description: 'Scale, position and rotate the frame on the GPU.',
  },
  {
    type: 'timestamp',
    title: 'Timestamp Overlay',
    category: 'Composite',
    accent: 'video',
    inputs: [v()],
    outputs: [v('out')],
    pass: 'timestamp',
    params: [
      { name: 'opacity', label: 'Opacity', type: 'number', default: 0.85, min: 0, max: 1, step: 0.01, animatable: true },
      { name: 'scale', label: 'Size', type: 'number', default: 1, min: 0.5, max: 3, step: 0.05 },
    ],
    description: 'Burned-in recording timestamp drawn from the sequence time.',
  },
  {
    type: 'output',
    title: 'Final Output',
    category: 'Output',
    accent: 'video',
    inputs: [v()],
    outputs: [],
    params: [],
    description: 'What the viewport and the exporter render.',
  },

  /* ---- declared, evaluated as pass-through until their engines land ------ */
  {
    type: 'tracking',
    title: 'Motion Tracking',
    category: 'AI',
    accent: 'ai',
    inputs: [v()],
    outputs: [v('out'), { name: 'motion', label: 'Motion', type: 'anim' }],
    params: [{ name: 'confidence', label: 'Confidence', type: 'number', default: 0.7, min: 0, max: 1, step: 0.01 }],
    status: 'planned',
    description: 'Planned — point and planar tracking via the ONNX runtime.',
  },
  {
    type: 'depth',
    title: 'Depth Estimation',
    category: 'AI',
    accent: 'ai',
    inputs: [v()],
    outputs: [{ name: 'depth', label: 'Depth', type: 'video' }],
    params: [{ name: 'strength', label: 'Strength', type: 'number', default: 1, min: 0, max: 2, step: 0.01 }],
    status: 'planned',
    description: 'Planned — monocular depth for relighting and 3D placement.',
  },
  {
    type: 'matte',
    title: 'Background Removal',
    category: 'AI',
    accent: 'ai',
    inputs: [v()],
    outputs: [v('out'), { name: 'alpha', label: 'Alpha', type: 'video' }],
    params: [{ name: 'feather', label: 'Feather', type: 'number', default: 0.2, min: 0, max: 1, step: 0.01 }],
    status: 'planned',
    description: 'Planned — segmentation matte with edge refinement.',
  },
  {
    type: 'scene3d',
    title: '3D Scene',
    category: '3D',
    accent: 'geometry',
    inputs: [{ name: 'geo', label: 'Geometry', type: 'geometry' }],
    outputs: [v('out')],
    params: [{ name: 'blend', label: 'Blend', type: 'number', default: 1, min: 0, max: 1, step: 0.01, animatable: true }],
    status: 'planned',
    description: 'Planned — renders the 3D workspace scene into the composite.',
  },
];

export const NODE_MAP: Record<string, NodeDef> = Object.fromEntries(
  NODE_DEFS.map((d) => [d.type, d]),
);

export const PORT_COLORS: Record<PortType, string> = {
  video: '#22e4f5',
  audio: '#5ef2a4',
  geometry: '#a855f7',
  anim: '#ffb347',
  ai: '#ff2d8a',
  value: '#7c8798',
};

export function createNode(type: string, x: number, y: number): GraphNode {
  const def = NODE_MAP[type];
  if (!def) throw new Error(`Unknown node type: ${type}`);
  const params: Record<string, number | string | boolean> = {};
  for (const p of def.params) params[p.name] = p.default;
  return { id: uid('nd'), type, title: def.title, x, y, params, animations: {} };
}
