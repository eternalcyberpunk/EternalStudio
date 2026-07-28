/**
 * plugins/api.ts
 * The extension surface. A plugin is a module that calls `registerNode` (and
 * later `registerEffectPass`, `registerExporter`, `registerGenerator`) at load
 * time. The marketplace — EternalNode Market — installs plugins into a folder
 * the loader scans on startup.
 *
 * Functional: node registration, Node Capsules (a saved sub-graph you can drop
 * in as one unit).
 * Planned: sandboxed WASM plugin loading, signed manifests, GPU pass
 * registration from plugin GLSL/WGSL, marketplace client.
 */

import type { GraphEdge, GraphNode, ProjectState } from '../core/types';
import { uid } from '../core/utils';
import { NODE_DEFS, NODE_MAP, type NodeDef } from '../nodes/registry';

export interface PluginManifest {
  id: string;
  name: string;
  version: string;
  author: string;
  category: 'effect' | 'node' | 'generator' | 'material' | 'export' | 'ai' | 'template';
}

const plugins = new Map<string, PluginManifest>();

export function registerNode(def: NodeDef, manifest?: PluginManifest): void {
  if (NODE_MAP[def.type]) throw new Error(`Node type "${def.type}" is already registered.`);
  NODE_DEFS.push(def);
  NODE_MAP[def.type] = def;
  if (manifest) plugins.set(manifest.id, manifest);
}

export const installedPlugins = (): PluginManifest[] => [...plugins.values()];

/* -------------------------------------------------------------- capsules --- */

export interface NodeCapsule {
  id: string;
  name: string;
  description: string;
  nodes: GraphNode[];
  edges: GraphEdge[];
}

/** Save the current selection as a reusable capsule. */
export function captureCapsule(state: ProjectState, name: string, description = ''): NodeCapsule {
  const ids = new Set(state.selection.nodeIds);
  return {
    id: uid('cap'),
    name,
    description,
    nodes: state.graph.nodes.filter((n) => ids.has(n.id)),
    edges: state.graph.edges.filter((e) => ids.has(e.from.node) && ids.has(e.to.node)),
  };
}

/** Paste a capsule into a project at an offset, re-issuing every id. */
export function instantiateCapsule(
  state: ProjectState,
  capsule: NodeCapsule,
  offsetX = 0,
  offsetY = 0,
): ProjectState {
  const idMap = new Map(capsule.nodes.map((n) => [n.id, uid('nd')]));
  const nodes = capsule.nodes.map((n) => ({
    ...n,
    id: idMap.get(n.id)!,
    x: n.x + offsetX,
    y: n.y + offsetY,
  }));
  const edges = capsule.edges.map((e) => ({
    id: uid('edg'),
    from: { node: idMap.get(e.from.node)!, port: e.from.port },
    to: { node: idMap.get(e.to.node)!, port: e.to.port },
  }));
  return {
    ...state,
    graph: { nodes: [...state.graph.nodes, ...nodes], edges: [...state.graph.edges, ...edges] },
  };
}
