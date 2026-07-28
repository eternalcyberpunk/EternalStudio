/**
 * animation/GraphEditor.tsx
 * Curve editing for any animated parameter on the selected node.
 *
 * Functional: channel list, curve drawing, add key by clicking the curve area,
 * drag keys in time and value, easing per key, delete key, playhead readout.
 * Planned: bezier handle manipulation, multi-channel normalisation, snapping to
 * beats from the audio engine, expression channels.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { beginTransaction, commitTransaction, edit, useProject } from '../core/project';
import { transportStore, useTransport } from '../core/store';
import type { EaseKind, Keyframe } from '../core/types';
import { clamp } from '../core/utils';
import { insertKey, removeKey, sample, sampleCurve, valueRange } from './keyframes';

const PAD = { l: 92, r: 16, t: 14, b: 26 };
const EASES: EaseKind[] = ['linear', 'easeIn', 'easeOut', 'easeInOut', 'spring', 'hold'];

export function GraphEditor(): JSX.Element {
  const project = useProject();
  const transport = useTransport();
  const boxRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 900, h: 190 });
  const [channel, setChannel] = useState<string | null>(null);
  const [activeKey, setActiveKey] = useState<number | null>(null);

  const nodeId = project.selection.nodeIds[0];
  const node = project.graph.nodes.find((n) => n.id === nodeId);
  const channels = node ? Object.keys(node.animations).filter((k) => node.animations[k]?.length) : [];
  const current = channel && channels.includes(channel) ? channel : channels[0] ?? null;
  const keys: Keyframe[] = (current && node?.animations[current]) || [];

  const duration = project.meta.duration;
  const [minV, maxV] = useMemo(() => valueRange(keys), [keys]);

  const plotW = size.w - PAD.l - PAD.r;
  const plotH = size.h - PAD.t - PAD.b;
  const tToX = (t: number) => PAD.l + (t / duration) * plotW;
  const vToY = (v: number) => PAD.t + plotH - ((v - minV) / (maxV - minV || 1)) * plotH;
  const xToT = (x: number) => clamp(((x - PAD.l) / plotW) * duration, 0, duration);
  const yToV = (y: number) => minV + ((PAD.t + plotH - y) / plotH) * (maxV - minV || 1);

  const path = useMemo(() => {
    if (!keys.length) return '';
    return sampleCurve(keys, 0, duration, 200)
      .map(([t, v], i) => `${i === 0 ? 'M' : 'L'} ${tToX(t).toFixed(1)} ${vToY(v).toFixed(1)}`)
      .join(' ');
  }, [keys, duration, size, minV, maxV]);

  const writeKeys = (next: Keyframe[], label: string, transient = false) => {
    if (!node || !current) return;
    edit(
      label,
      (s) => ({
        ...s,
        graph: {
          ...s.graph,
          nodes: s.graph.nodes.map((n) =>
            n.id === node.id ? { ...n, animations: { ...n.animations, [current]: next } } : n,
          ),
        },
      }),
      { transient },
    );
  };

  const onCanvasDown = (e: React.PointerEvent<SVGSVGElement>) => {
    if (!node || !current) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const t = xToT(e.clientX - rect.left);
    const v = yToV(e.clientY - rect.top);
    writeKeys(insertKey(keys, { t, v, ease: 'easeInOut' }), 'Add keyframe');
  };

  const dragKey = (e: React.PointerEvent, index: number) => {
    e.stopPropagation();
    setActiveKey(index);
    beginTransaction();
    const svg = (e.currentTarget as SVGElement).ownerSVGElement!;
    const rect = svg.getBoundingClientRect();
    const move = (ev: PointerEvent) => {
      const t = xToT(ev.clientX - rect.left);
      const v = yToV(ev.clientY - rect.top);
      const next = keys.map((k, i) => (i === index ? { ...k, t, v } : k)).sort((a, b) => a.t - b.t);
      writeKeys(next, 'Move keyframe', true);
    };
    const up = () => {
      commitTransaction('Move keyframe');
      window.removeEventListener('pointermove', move);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up, { once: true });
  };

  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return (
    <section className="grapheditor" ref={boxRef}>
      <div className="grapheditor__channels">
        <span className="panel__eyebrow">Curves</span>
        {!node ? <p className="hint">Select a node to edit its animation.</p> : null}
        {node && !channels.length ? (
          <p className="hint">
            No animated parameters yet. Click the ◆ next to a value in the Inspector to add a keyframe.
          </p>
        ) : null}
        {channels.map((c) => (
          <button
            key={c}
            className={`channel ${c === current ? 'is-active' : ''}`}
            onClick={() => setChannel(c)}
          >
            <span className="channel__dot" />
            {c}
            <span className="channel__value">
              {sample(node!.animations[c], transport.time).toFixed(2)}
            </span>
          </button>
        ))}
        {current && activeKey !== null && keys[activeKey] ? (
          <label className="field field--inline">
            <span>Ease</span>
            <select
              className="select"
              value={keys[activeKey].ease}
              onChange={(e) =>
                writeKeys(
                  keys.map((k, i) => (i === activeKey ? { ...k, ease: e.target.value as EaseKind } : k)),
                  'Set easing',
                )
              }
            >
              {EASES.map((e) => (
                <option key={e}>{e}</option>
              ))}
            </select>
          </label>
        ) : null}
      </div>

      <svg className="grapheditor__plot" width="100%" height="100%" onPointerDown={onCanvasDown}>
        {[0, 0.25, 0.5, 0.75, 1].map((f) => (
          <line
            key={f}
            className="grid-line"
            x1={PAD.l}
            x2={size.w - PAD.r}
            y1={PAD.t + plotH * f}
            y2={PAD.t + plotH * f}
          />
        ))}
        <path className="curve" d={path} />
        {keys.map((k, i) => (
          <g key={i} onPointerDown={(e) => dragKey(e, i)}>
            <circle
              className={`keyframe ${activeKey === i ? 'is-active' : ''}`}
              cx={tToX(k.t)}
              cy={vToY(k.v)}
              r={5}
            />
          </g>
        ))}
        <line
          className="graph-playhead"
          x1={tToX(transport.time)}
          x2={tToX(transport.time)}
          y1={PAD.t}
          y2={PAD.t + plotH}
        />
        {current && activeKey !== null ? (
          <text
            className="graph-hint"
            x={size.w - PAD.r}
            y={size.h - 8}
            textAnchor="end"
            onClick={() => {
              writeKeys(removeKey(keys, keys[activeKey].t), 'Delete keyframe');
              setActiveKey(null);
            }}
          >
            delete key
          </text>
        ) : null}
      </svg>
    </section>
  );
}

export function keyframeAtPlayhead(): number {
  return transportStore.get().time;
}
