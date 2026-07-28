/**
 * nodes/NodeEditor.tsx
 * The visual node graph. Connections are typed and drawn differently per data
 * kind, so a glance tells you whether a wire carries frames, geometry,
 * animation or model output.
 *
 * Functional: pan, zoom, node drag, drag-to-connect with live preview and cycle
 * rejection, typed port colours and connection styles, node search palette,
 * bypass, delete, selection wired to the Inspector, live parameter edits that
 * hit the compositor on the next frame.
 * Planned: groups and frames, comments, minimap, auto-layout, Node Capsules.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { beginTransaction, commitTransaction, edit, projectStore, useProject } from '../core/project';
import type { GraphEdge, GraphNode, PortType } from '../core/types';
import { clamp, uid } from '../core/utils';
import { canConnect, isGraphConnected } from './evaluator';
import { NODE_DEFS, NODE_MAP, PORT_COLORS, createNode } from './registry';

const NODE_W = 208;
const HEADER_H = 34;
const ROW_H = 20;

interface Pending {
  from: { node: string; port: string };
  type: PortType;
  x: number;
  y: number;
}

const portY = (index: number) => HEADER_H + 14 + index * ROW_H;

function nodeHeight(node: GraphNode): number {
  const def = NODE_MAP[node.type];
  const rows = Math.max(def.inputs.length, def.outputs.length, 1);
  return HEADER_H + rows * ROW_H + 22;
}

/** Connection geometry: a horizontal-biased cubic keeps graphs readable. */
function wirePath(x1: number, y1: number, x2: number, y2: number): string {
  const dx = Math.max(40, Math.abs(x2 - x1) * 0.5);
  return `M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`;
}

export function NodeEditor({ compact = false }: { compact?: boolean }): JSX.Element {
  const project = useProject();
  const svgRef = useRef<SVGSVGElement>(null);
  const [view, setView] = useState({ x: 60, y: 40, k: 1 });
  const [dragNode, setDragNode] = useState<{ id: string; dx: number; dy: number } | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [query, setQuery] = useState('');

  const { nodes, edges } = project.graph;
  const connected = isGraphConnected(nodes, edges);

  const toWorld = (clientX: number, clientY: number) => {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return { x: 0, y: 0 };
    return { x: (clientX - rect.left - view.x) / view.k, y: (clientY - rect.top - view.y) / view.k };
  };

  /* ------------------------------------------------------------- panning */

  const onBackgroundDown = (e: React.PointerEvent) => {
    if (e.target !== e.currentTarget) return;
    projectStore.set({ ...projectStore.get(), selection: { ...project.selection, nodeIds: [] } });
    const startX = e.clientX;
    const startY = e.clientY;
    const origin = { ...view };
    const move = (ev: PointerEvent) =>
      setView({ ...origin, x: origin.x + (ev.clientX - startX), y: origin.y + (ev.clientY - startY) });
    const up = () => window.removeEventListener('pointermove', move);
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up, { once: true });
  };

  const onWheel = (e: React.WheelEvent) => {
    const k = clamp(view.k * (e.deltaY < 0 ? 1.1 : 0.9), 0.35, 2.5);
    setView((v) => ({ ...v, k }));
  };

  /* -------------------------------------------------------- node dragging */

  useEffect(() => {
    if (!dragNode) return;
    const move = (e: PointerEvent) => {
      const p = toWorld(e.clientX, e.clientY);
      edit(
        'Move node',
        (s) => ({
          ...s,
          graph: {
            ...s.graph,
            nodes: s.graph.nodes.map((n) =>
              n.id === dragNode.id ? { ...n, x: p.x - dragNode.dx, y: p.y - dragNode.dy } : n,
            ),
          },
        }),
        { transient: true },
      );
    };
    const up = () => {
      commitTransaction('Move node');
      setDragNode(null);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up, { once: true });
    return () => window.removeEventListener('pointermove', move);
  }, [dragNode, view]);

  /* ------------------------------------------------------------ connecting */

  useEffect(() => {
    if (!pending) return;
    const move = (e: PointerEvent) => {
      const p = toWorld(e.clientX, e.clientY);
      setPending((prev) => (prev ? { ...prev, x: p.x, y: p.y } : prev));
    };
    const up = (e: PointerEvent) => {
      const el = (e.target as Element)?.closest('[data-port-in]') as HTMLElement | null;
      const target = el?.dataset.portIn;
      if (target) {
        const [nodeId, port] = target.split(':');
        const state = projectStore.get();
        if (canConnect(state.graph.nodes, state.graph.edges, pending.from, { node: nodeId, port })) {
          edit('Connect nodes', (s) => ({
            ...s,
            graph: {
              ...s.graph,
              edges: [
                // one connection per input port
                ...s.graph.edges.filter((ed) => !(ed.to.node === nodeId && ed.to.port === port)),
                { id: uid('edg'), from: pending.from, to: { node: nodeId, port } } as GraphEdge,
              ],
            },
          }));
        }
      }
      setPending(null);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up, { once: true });
    return () => window.removeEventListener('pointermove', move);
  }, [pending, view]);

  /* ----------------------------------------------------------- operations */

  const addNode = (type: string) => {
    const p = toWorld(
      (svgRef.current?.getBoundingClientRect().left ?? 0) + 220,
      (svgRef.current?.getBoundingClientRect().top ?? 0) + 160,
    );
    const node = createNode(type, p.x + Math.random() * 40, p.y + Math.random() * 40);
    edit('Add node', (s) => ({
      ...s,
      graph: { ...s.graph, nodes: [...s.graph.nodes, node] },
      selection: { ...s.selection, nodeIds: [node.id] },
    }));
    setPaletteOpen(false);
    setQuery('');
  };

  const deleteSelected = () => {
    const ids = project.selection.nodeIds;
    if (!ids.length) return;
    edit('Delete nodes', (s) => ({
      ...s,
      graph: {
        nodes: s.graph.nodes.filter((n) => !ids.includes(n.id)),
        edges: s.graph.edges.filter((e) => !ids.includes(e.from.node) && !ids.includes(e.to.node)),
      },
      selection: { ...s.selection, nodeIds: [] },
    }));
  };

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    return NODE_DEFS.filter(
      (d) => !q || d.title.toLowerCase().includes(q) || d.category.toLowerCase().includes(q),
    );
  }, [query]);

  const nodeById = (id: string) => nodes.find((n) => n.id === id);

  return (
    <section className={`nodes ${compact ? 'nodes--compact' : ''}`}>
      <header className="nodes__bar">
        <button className="chip chip--accent" onClick={() => setPaletteOpen((o) => !o)}>
          + Add node
        </button>
        <button className="chip" onClick={deleteSelected} disabled={!project.selection.nodeIds.length}>
          Delete
        </button>
        <button className="chip" onClick={() => setView({ x: 60, y: 40, k: 1 })}>
          Reset view
        </button>
        <span className={`graph-status ${connected ? 'is-live' : ''}`}>
          {connected ? 'Chain live — rendering to viewport' : 'Connect Media Source → Final Output to render'}
        </span>
      </header>

      {paletteOpen ? (
        <div className="palette">
          <input
            autoFocus
            className="palette__input"
            placeholder="Search nodes…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') setPaletteOpen(false);
              if (e.key === 'Enter' && results[0]) addNode(results[0].type);
            }}
          />
          <div className="palette__list">
            {results.map((def) => (
              <button key={def.type} className="palette__item" onClick={() => addNode(def.type)}>
                <span className="palette__dot" style={{ background: PORT_COLORS[def.accent] }} />
                <span className="palette__title">{def.title}</span>
                <span className="palette__meta">{def.category}</span>
                {def.status === 'planned' ? <span className="tag tag--planned">Planned</span> : null}
              </button>
            ))}
          </div>
        </div>
      ) : null}

      <svg ref={svgRef} className="nodes__canvas" onPointerDown={onBackgroundDown} onWheel={onWheel}>
        <defs>
          <pattern id="grid" width="24" height="24" patternUnits="userSpaceOnUse">
            <circle cx="1" cy="1" r="1" fill="rgba(255,255,255,0.06)" />
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill="url(#grid)" />

        <g transform={`translate(${view.x},${view.y}) scale(${view.k})`}>
          {edges.map((e) => {
            const from = nodeById(e.from.node);
            const to = nodeById(e.to.node);
            if (!from || !to) return null;
            const fromDef = NODE_MAP[from.type];
            const toDef = NODE_MAP[to.type];
            const oi = fromDef.outputs.findIndex((p) => p.name === e.from.port);
            const ii = toDef.inputs.findIndex((p) => p.name === e.to.port);
            const type = fromDef.outputs[oi]?.type ?? 'video';
            return (
              <path
                key={e.id}
                className={`wire wire--${type}`}
                stroke={PORT_COLORS[type]}
                d={wirePath(from.x + NODE_W, from.y + portY(oi), to.x, to.y + portY(ii))}
                onDoubleClick={() =>
                  edit('Disconnect', (s) => ({
                    ...s,
                    graph: { ...s.graph, edges: s.graph.edges.filter((ed) => ed.id !== e.id) },
                  }))
                }
              />
            );
          })}

          {pending ? (
            <path
              className="wire wire--pending"
              stroke={PORT_COLORS[pending.type]}
              d={wirePath(
                (nodeById(pending.from.node)?.x ?? 0) + NODE_W,
                (nodeById(pending.from.node)?.y ?? 0) +
                  portY(NODE_MAP[nodeById(pending.from.node)?.type ?? 'source'].outputs.findIndex((p) => p.name === pending.from.port)),
                pending.x,
                pending.y,
              )}
            />
          ) : null}

          {nodes.map((node) => {
            const def = NODE_MAP[node.type];
            if (!def) return null;
            const selected = project.selection.nodeIds.includes(node.id);
            return (
              <g
                key={node.id}
                transform={`translate(${node.x},${node.y})`}
                className={`node ${selected ? 'is-selected' : ''} ${node.bypass ? 'is-bypassed' : ''}`}
              >
                <rect
                  className="node__body"
                  width={NODE_W}
                  height={nodeHeight(node)}
                  rx={10}
                  stroke={selected ? PORT_COLORS[def.accent] : 'rgba(255,255,255,0.09)'}
                />
                <rect className="node__accent" width={NODE_W} height={3} rx={2} fill={PORT_COLORS[def.accent]} />
                <text
                  className="node__title"
                  x={12}
                  y={23}
                  onPointerDown={(e) => {
                    e.stopPropagation();
                    projectStore.set({
                      ...projectStore.get(),
                      selection: { ...project.selection, nodeIds: [node.id] },
                    });
                    beginTransaction();
                    const p = toWorld(e.clientX, e.clientY);
                    setDragNode({ id: node.id, dx: p.x - node.x, dy: p.y - node.y });
                  }}
                >
                  {def.title}
                </text>
                {def.status === 'planned' ? (
                  <text className="node__badge" x={NODE_W - 12} y={23} textAnchor="end">
                    PLANNED
                  </text>
                ) : null}

                {def.inputs.map((port, i) => (
                  <g key={port.name}>
                    <circle
                      className="port port--in"
                      data-port-in={`${node.id}:${port.name}`}
                      cx={0}
                      cy={portY(i)}
                      r={6}
                      fill={PORT_COLORS[port.type]}
                    />
                    <text className="port__label" x={14} y={portY(i) + 4}>
                      {port.label}
                    </text>
                  </g>
                ))}

                {def.outputs.map((port, i) => (
                  <g key={port.name}>
                    <circle
                      className="port port--out"
                      cx={NODE_W}
                      cy={portY(i)}
                      r={6}
                      fill={PORT_COLORS[port.type]}
                      onPointerDown={(e) => {
                        e.stopPropagation();
                        const p = toWorld(e.clientX, e.clientY);
                        setPending({ from: { node: node.id, port: port.name }, type: port.type, x: p.x, y: p.y });
                      }}
                    />
                    <text className="port__label port__label--out" x={NODE_W - 14} y={portY(i) + 4} textAnchor="end">
                      {port.label}
                    </text>
                  </g>
                ))}
              </g>
            );
          })}
        </g>
      </svg>
    </section>
  );
}
