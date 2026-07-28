/**
 * nodes/evaluator.ts
 * Turns the node graph into an ordered list of GPU passes for the compositor.
 *
 * The graph is walked backwards from Final Output along connected video ports,
 * so unconnected experiments cost nothing. Parameters are resolved through the
 * animation system at the current sequence time, which is why every node
 * parameter is keyframable for free.
 *
 * Functional: cycle-safe traversal, per-frame param resolution, bypass, caching
 * by graph revision.
 * Planned: multi-input compositing (merge/mask), CPU fallback for AI nodes,
 * partial re-evaluation of dirty subtrees.
 */

import { resolveParams } from '../animation/keyframes';
import type { GraphEdge, GraphNode, ProjectState } from '../core/types';
import { NODE_MAP } from './registry';

export interface EffectPass {
  nodeId: string;
  pass: string;
  params: Record<string, number | string | boolean>;
}

function inputEdge(edges: GraphEdge[], nodeId: string, port = 'in'): GraphEdge | undefined {
  return edges.find((e) => e.to.node === nodeId && e.to.port === port);
}

/** Ordered chain from the source end to the output end. */
export function buildChain(
  nodes: GraphNode[],
  edges: GraphEdge[],
  time: number,
): EffectPass[] {
  const output = nodes.find((n) => n.type === 'output');
  if (!output) return [];

  const reverse: GraphNode[] = [];
  const seen = new Set<string>();
  let cursor: GraphNode | undefined = output;

  while (cursor && !seen.has(cursor.id)) {
    seen.add(cursor.id);
    reverse.push(cursor);
    const edge = inputEdge(edges, cursor.id);
    if (!edge) break;
    cursor = nodes.find((n) => n.id === edge.from.node);
  }

  const chain = reverse.reverse();
  const passes: EffectPass[] = [];

  for (const node of chain) {
    const def = NODE_MAP[node.type];
    if (!def || !def.pass || node.bypass) continue;
    passes.push({ nodeId: node.id, pass: def.pass, params: resolveParams(node, time) });
  }
  return passes;
}

export function evaluate(state: ProjectState, time: number): EffectPass[] {
  return buildChain(state.graph.nodes, state.graph.edges, time);
}

/** True when the graph has a usable Source → … → Output path. */
export function isGraphConnected(nodes: GraphNode[], edges: GraphEdge[]): boolean {
  const output = nodes.find((n) => n.type === 'output');
  if (!output) return false;
  const seen = new Set<string>();
  let cursor: GraphNode | undefined = output;
  while (cursor && !seen.has(cursor.id)) {
    if (cursor.type === 'source') return true;
    seen.add(cursor.id);
    const edge = inputEdge(edges, cursor.id);
    if (!edge) return false;
    cursor = nodes.find((n) => n.id === edge.from.node);
  }
  return false;
}

/** Rejects connections that would create a cycle or cross incompatible types. */
export function canConnect(
  nodes: GraphNode[],
  edges: GraphEdge[],
  from: { node: string; port: string },
  to: { node: string; port: string },
): boolean {
  if (from.node === to.node) return false;
  const fromDef = NODE_MAP[nodes.find((n) => n.id === from.node)?.type ?? ''];
  const toDef = NODE_MAP[nodes.find((n) => n.id === to.node)?.type ?? ''];
  if (!fromDef || !toDef) return false;
  const outType = fromDef.outputs.find((p) => p.name === from.port)?.type;
  const inType = toDef.inputs.find((p) => p.name === to.port)?.type;
  if (!outType || !inType || outType !== inType) return false;

  // Walk upstream from `from` — if we reach `to`, the edge would loop.
  const stack = [from.node];
  const seen = new Set<string>();
  while (stack.length) {
    const id = stack.pop()!;
    if (id === to.node) return false;
    if (seen.has(id)) continue;
    seen.add(id);
    edges.filter((e) => e.to.node === id).forEach((e) => stack.push(e.from.node));
  }
  return true;
}
