/**
 * ai/elaine.ts — E.L.A.I.N.E. Creative Intelligence (planner layer)
 *
 * The rule of this module: E.L.A.I.N.E. never produces a black box. Every
 * command resolves to a *plan* — a list of real nodes, clips, keyframes or
 * objects — which is then applied to the project through the ordinary edit
 * pipeline. The result is fully editable and fully undoable, identical to work
 * the user did by hand.
 *
 * Functional today: an on-device rule-based planner covering the look, motion,
 * title and 3D commands below, with graph layout and wiring.
 * Planned: the model-backed planner (local ONNX or remote), which will emit the
 * same Plan structure — so the rest of the app needs no changes when it lands.
 * Generative media nodes (text-to-image, upscale, interpolation, rotoscope,
 * voice) are declared in the registry and marked Planned until their runtimes
 * are wired in.
 */

import { edit, projectStore } from '../core/project';
import { transportStore } from '../core/store';
import type { GraphEdge, GraphNode, PrimitiveKind } from '../core/types';
import { uid } from '../core/utils';
import { createNode } from '../nodes/registry';
import { addPrimitive } from '../threeD/scene';
import { addTextClip } from '../timeline/engine';

export interface Plan {
  title: string;
  steps: string[];
  apply: () => void;
}

type Recipe = {
  match: RegExp;
  title: string;
  chain: Array<{ type: string; params?: Record<string, number | string | boolean> }>;
};

/** Look recipes. Each produces a chain the user can immediately re-tune. */
const RECIPES: Recipe[] = [
  {
    match: /(security|surveillance|cctv|damaged|corrupt|broken)/i,
    title: 'Damaged security recording',
    chain: [
      { type: 'source' },
      { type: 'grade', params: { exposure: -0.45, contrast: 1.25, saturation: 0.35, temperature: -0.2, tint: '#7fd7c0', tintAmount: 0.18 } },
      { type: 'corruption', params: { amount: 0.5, blockSize: 22, shift: 1.1, speed: 1.4 } },
      { type: 'grain', params: { amount: 0.22, size: 1.4, chroma: 0.45 } },
      { type: 'scanlines', params: { density: 420, strength: 0.35, roll: 0.3 } },
      { type: 'timestamp', params: { opacity: 0.9, scale: 1 } },
      { type: 'output' },
    ],
  },
  {
    match: /(cyberpunk|neon|purple and cyan|cyan and purple|eternal)/i,
    title: 'Cyberpunk neon grade',
    chain: [
      { type: 'source' },
      { type: 'grade', params: { exposure: 0.1, contrast: 1.2, saturation: 1.35, temperature: -0.25, tint: '#a855f7', tintAmount: 0.28 } },
      { type: 'glow', params: { threshold: 0.55, intensity: 1.1, radius: 4.5 } },
      { type: 'vignette', params: { amount: 0.5, radius: 0.8 } },
      { type: 'output' },
    ],
  },
  {
    match: /(vhs|analog|retro|tape|80s)/i,
    title: 'Analog tape look',
    chain: [
      { type: 'source' },
      { type: 'grade', params: { exposure: -0.1, contrast: 0.95, saturation: 1.15, temperature: 0.2 } },
      { type: 'corruption', params: { amount: 0.28, blockSize: 40, shift: 1.6, speed: 0.7 } },
      { type: 'scanlines', params: { density: 240, strength: 0.4, roll: 0.6 } },
      { type: 'grain', params: { amount: 0.18, size: 2, chroma: 0.6 } },
      { type: 'output' },
    ],
  },
  {
    match: /(cinematic|film|movie|teal and orange|filmic)/i,
    title: 'Cinematic contrast grade',
    chain: [
      { type: 'source' },
      { type: 'grade', params: { exposure: 0.05, contrast: 1.18, saturation: 0.95, temperature: 0.12, tint: '#ffb37a', tintAmount: 0.12 } },
      { type: 'vignette', params: { amount: 0.35, radius: 0.9 } },
      { type: 'grain', params: { amount: 0.06, size: 1.2, chroma: 0.1 } },
      { type: 'output' },
    ],
  },
  {
    match: /(hologram|holographic|glitch)/i,
    title: 'Holographic projection',
    chain: [
      { type: 'source' },
      { type: 'grade', params: { exposure: 0.2, contrast: 1.1, saturation: 0.6, tint: '#22e4f5', tintAmount: 0.5 } },
      { type: 'scanlines', params: { density: 700, strength: 0.5, roll: 0.9 } },
      { type: 'corruption', params: { amount: 0.25, blockSize: 14, shift: 1.8, speed: 2.2 } },
      { type: 'glow', params: { threshold: 0.4, intensity: 1.4, radius: 6 } },
      { type: 'output' },
    ],
  },
];

function layoutChain(recipe: Recipe): { nodes: GraphNode[]; edges: GraphEdge[] } {
  const nodes: GraphNode[] = recipe.chain.map((step, i) => {
    const node = createNode(step.type, 40 + i * 250, 120 + (i % 2) * 70);
    if (step.params) node.params = { ...node.params, ...step.params };
    return node;
  });
  const edges: GraphEdge[] = nodes.slice(0, -1).map((n, i) => ({
    id: uid('edg'),
    from: { node: n.id, port: 'out' },
    to: { node: nodes[i + 1].id, port: 'in' },
  }));
  return { nodes, edges };
}

const PRIMITIVE_WORDS: Array<[RegExp, PrimitiveKind]> = [
  [/sphere|ball|orb|planet/i, 'sphere'],
  [/torus|ring|donut/i, 'torus'],
  [/cylinder|pillar|column/i, 'cylinder'],
  [/cone|spike/i, 'cone'],
  [/plane|floor|ground/i, 'plane'],
  [/cube|box|block|building/i, 'cube'],
];

export function interpret(command: string): Plan {
  const text = command.trim();

  /* ---- titles ---------------------------------------------------------- */
  const titleMatch = text.match(/(?:add|create|make)\s+(?:a\s+)?(?:title|text|caption)\s+(?:that says\s+)?["“]?(.+?)["”]?$/i);
  if (titleMatch) {
    const words = titleMatch[1];
    return {
      title: `Add title "${words}"`,
      steps: ['Create a text clip on the Titles track at the playhead', 'Set a 4 second duration'],
      apply: () => {
        const state = projectStore.get();
        const track = state.tracks.find((t) => t.kind === 'text') ?? state.tracks[0];
        addTextClip(words, track.id, transportStore.get().time);
      },
    };
  }

  /* ---- 3D -------------------------------------------------------------- */
  if (/\b(3d|model|scene|object|geometry)\b/i.test(text)) {
    const kind = PRIMITIVE_WORDS.find(([re]) => re.test(text))?.[1] ?? 'cube';
    return {
      title: `Add a ${kind} to the 3D scene`,
      steps: [`Create a ${kind} primitive`, 'Select it so the gizmo is ready in the Model workspace'],
      apply: () => {
        addPrimitive(kind);
      },
    };
  }

  /* ---- camera / motion ------------------------------------------------- */
  if (/(camera move|push in|zoom in|dolly|cinematic move|pan)/i.test(text)) {
    return {
      title: 'Animate a slow push-in',
      steps: [
        'Add a Transform node in front of Final Output',
        'Keyframe scale from 1.00 to 1.12 across four seconds',
        'Ease in and out',
      ],
      apply: () => {
        const t0 = transportStore.get().time;
        const node = createNode('transform', 640, 120);
        node.animations = {
          scale: [
            { t: t0, v: 1, ease: 'easeInOut' },
            { t: t0 + 4, v: 1.12, ease: 'easeInOut' },
          ],
        };
        edit('E.L.A.I.N.E. — camera move', (s) => {
          const output = s.graph.nodes.find((n) => n.type === 'output');
          const nodes = [...s.graph.nodes, node];
          let edges = s.graph.edges;
          if (output) {
            const incoming = edges.find((e) => e.to.node === output.id);
            edges = edges.filter((e) => e !== incoming);
            if (incoming) edges = [...edges, { ...incoming, id: uid('edg'), to: { node: node.id, port: 'in' } }];
            edges = [...edges, { id: uid('edg'), from: { node: node.id, port: 'out' }, to: { node: output.id, port: 'in' } }];
          }
          return { ...s, graph: { nodes, edges }, selection: { ...s.selection, nodeIds: [node.id] } };
        });
      },
    };
  }

  /* ---- looks ----------------------------------------------------------- */
  const recipe = RECIPES.find((r) => r.match.test(text)) ?? RECIPES[1];
  const { nodes, edges } = layoutChain(recipe);
  return {
    title: recipe.title,
    steps: nodes.map((n) => n.title),
    apply: () => {
      edit(`E.L.A.I.N.E. — ${recipe.title}`, (s) => ({
        ...s,
        graph: { nodes, edges },
        selection: { ...s.selection, nodeIds: [nodes[1]?.id ?? nodes[0].id] },
        workspace: 'node',
      }));
    },
  };
}

export const SUGGESTIONS = [
  'Make this footage look like a damaged cyberpunk security recording',
  'Create a purple and cyan cyberpunk grade',
  'Give it an analog VHS look',
  'Create a smooth cinematic camera move',
  'Add a 3D torus to the scene',
  'Add a title that says ETERNAL CYBERIA',
];
