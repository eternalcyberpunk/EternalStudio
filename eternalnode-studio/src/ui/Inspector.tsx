/**
 * ui/Inspector.tsx
 * One properties panel for whatever is selected — a clip, a node or a 3D
 * object. Node parameters carry a keyframe toggle (◆); switching it on writes a
 * key at the playhead and the parameter immediately becomes a curve in the
 * graph editor and an animated uniform in the compositor.
 */

import { edit, useProject } from '../core/project';
import { transportStore, useTransport } from '../core/store';
import type { GraphNode } from '../core/types';
import { insertKey, sample } from '../animation/keyframes';
import { NODE_MAP, type ParamDef } from '../nodes/registry';
import { findClip, setClipProp } from '../timeline/engine';
import { updateMaterial, updateObject } from '../threeD/scene';

export function Inspector(): JSX.Element {
  const project = useProject();
  const transport = useTransport();

  const clip = project.selection.clipIds[0] ? findClip(project, project.selection.clipIds[0]) : undefined;
  const node = project.graph.nodes.find((n) => n.id === project.selection.nodeIds[0]);
  const object = project.scene.objects.find((o) => o.id === project.selection.objectIds[0]);

  const empty = !clip && !node && !object;

  return (
    <aside className="panel panel--inspector">
      <header className="panel__head">
        <span className="panel__eyebrow">Inspector</span>
        <span className="panel__title">
          {node ? NODE_MAP[node.type]?.title : object ? object.name : clip ? clip.name : 'Nothing selected'}
        </span>
      </header>

      <div className="panel__body">
        {empty ? (
          <p className="hint">Select a clip, a node or a 3D object to edit its properties.</p>
        ) : null}

        {clip ? (
          <section className="props">
            <span className="panel__eyebrow">Clip</span>
            <NumberField
              label="Start"
              value={clip.start}
              min={0}
              max={project.meta.duration}
              step={0.01}
              onChange={(v) => setClipProp(clip.id, 'start', v, true)}
            />
            <NumberField
              label="Duration"
              value={clip.duration}
              min={0.1}
              max={project.meta.duration}
              step={0.01}
              onChange={(v) => setClipProp(clip.id, 'duration', v, true)}
            />
            <NumberField
              label="Opacity"
              value={clip.opacity}
              min={0}
              max={1}
              step={0.01}
              onChange={(v) => setClipProp(clip.id, 'opacity', v, true)}
            />
            <NumberField
              label="Speed"
              value={clip.speed}
              min={0.1}
              max={4}
              step={0.01}
              onChange={(v) => setClipProp(clip.id, 'speed', v, true)}
            />
            {clip.text !== undefined ? (
              <label className="field">
                <span>Text</span>
                <input
                  className="input"
                  value={clip.text}
                  onChange={(e) => setClipProp(clip.id, 'text', e.target.value, true)}
                />
              </label>
            ) : null}
          </section>
        ) : null}

        {node ? <NodeParams node={node} time={transport.time} /> : null}

        {object ? (
          <section className="props">
            <span className="panel__eyebrow">Transform</span>
            {(['position', 'rotation', 'scale'] as const).map((key) => (
              <div key={key} className="vector">
                <span className="vector__label">{key}</span>
                {[0, 1, 2].map((axis) => (
                  <input
                    key={axis}
                    className="input input--tight"
                    type="number"
                    step={key === 'rotation' ? 0.05 : 0.1}
                    value={Number(object[key][axis].toFixed(3))}
                    onChange={(e) => {
                      const next = [...object[key]] as [number, number, number];
                      next[axis] = Number(e.target.value);
                      updateObject(object.id, { [key]: next }, true);
                    }}
                  />
                ))}
              </div>
            ))}

            <span className="panel__eyebrow">Material</span>
            <label className="field field--inline">
              <span>Base color</span>
              <input
                type="color"
                value={object.material.color}
                onChange={(e) => updateMaterial(object.id, { color: e.target.value })}
              />
            </label>
            <NumberField
              label="Metallic"
              value={object.material.metallic}
              min={0}
              max={1}
              step={0.01}
              onChange={(v) => updateMaterial(object.id, { metallic: v })}
            />
            <NumberField
              label="Roughness"
              value={object.material.roughness}
              min={0}
              max={1}
              step={0.01}
              onChange={(v) => updateMaterial(object.id, { roughness: v })}
            />
            <NumberField
              label="Emission"
              value={object.material.emissive}
              min={0}
              max={4}
              step={0.01}
              onChange={(v) => updateMaterial(object.id, { emissive: v })}
            />
            <p className="hint">
              Node-based materials share this registry and land with the Material workspace.
            </p>
          </section>
        ) : null}
      </div>
    </aside>
  );
}

function NodeParams({ node, time }: { node: GraphNode; time: number }): JSX.Element {
  const def = NODE_MAP[node.type];

  const write = (name: string, value: number | string | boolean) =>
    edit(
      'Set parameter',
      (s) => ({
        ...s,
        graph: {
          ...s.graph,
          nodes: s.graph.nodes.map((n) =>
            n.id === node.id ? { ...n, params: { ...n.params, [name]: value } } : n,
          ),
        },
      }),
      { transient: true },
    );

  const toggleKey = (p: ParamDef) => {
    const animated = (node.animations[p.name]?.length ?? 0) > 0;
    edit('Toggle keyframe', (s) => ({
      ...s,
      graph: {
        ...s.graph,
        nodes: s.graph.nodes.map((n) => {
          if (n.id !== node.id) return n;
          const animations = { ...n.animations };
          if (animated) delete animations[p.name];
          else
            animations[p.name] = [
              { t: transportStore.get().time, v: Number(n.params[p.name] ?? 0), ease: 'easeInOut' },
            ];
          return { ...n, animations };
        }),
      },
    }));
  };

  const addKeyHere = (p: ParamDef, value: number) =>
    edit('Add keyframe', (s) => ({
      ...s,
      graph: {
        ...s.graph,
        nodes: s.graph.nodes.map((n) =>
          n.id === node.id
            ? {
                ...n,
                animations: {
                  ...n.animations,
                  [p.name]: insertKey(n.animations[p.name] ?? [], {
                    t: transportStore.get().time,
                    v: value,
                    ease: 'easeInOut',
                  }),
                },
              }
            : n,
        ),
      },
    }));

  return (
    <section className="props">
      <span className="panel__eyebrow">{def.category}</span>
      <p className="hint hint--tight">{def.description}</p>

      <label className="field field--inline">
        <span>Bypass</span>
        <input
          type="checkbox"
          checked={!!node.bypass}
          onChange={(e) =>
            edit('Bypass node', (s) => ({
              ...s,
              graph: {
                ...s.graph,
                nodes: s.graph.nodes.map((n) => (n.id === node.id ? { ...n, bypass: e.target.checked } : n)),
              },
            }))
          }
        />
      </label>

      {def.params.map((p) => {
        const animated = (node.animations[p.name]?.length ?? 0) > 0;
        const live = animated ? sample(node.animations[p.name], time) : Number(node.params[p.name] ?? 0);

        if (p.type === 'color') {
          return (
            <label key={p.name} className="field field--inline">
              <span>{p.label}</span>
              <input
                type="color"
                value={String(node.params[p.name] ?? '#ffffff')}
                onChange={(e) => write(p.name, e.target.value)}
              />
            </label>
          );
        }
        if (p.type === 'bool') {
          return (
            <label key={p.name} className="field field--inline">
              <span>{p.label}</span>
              <input
                type="checkbox"
                checked={!!node.params[p.name]}
                onChange={(e) => write(p.name, e.target.checked)}
              />
            </label>
          );
        }
        if (p.type === 'text') {
          return (
            <label key={p.name} className="field">
              <span>{p.label}</span>
              <input
                className="input"
                value={String(node.params[p.name] ?? '')}
                onChange={(e) => write(p.name, e.target.value)}
              />
            </label>
          );
        }

        return (
          <div key={p.name} className="param">
            <div className="param__head">
              <span>{p.label}</span>
              <div className="param__right">
                <span className="param__value">{live.toFixed(2)}</span>
                {p.animatable ? (
                  <button
                    className={`stopwatch ${animated ? 'is-on' : ''}`}
                    title={animated ? 'Remove animation' : 'Animate this parameter'}
                    onClick={() => toggleKey(p)}
                  >
                    ◆
                  </button>
                ) : null}
              </div>
            </div>
            <input
              type="range"
              min={p.min ?? 0}
              max={p.max ?? 1}
              step={p.step ?? 0.01}
              value={live}
              onChange={(e) => {
                const v = Number(e.target.value);
                if (animated) addKeyHere(p, v);
                else write(p.name, v);
              }}
            />
          </div>
        );
      })}
    </section>
  );
}

function NumberField({
  label,
  value,
  min,
  max,
  step,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
}): JSX.Element {
  return (
    <div className="param">
      <div className="param__head">
        <span>{label}</span>
        <span className="param__value">{value.toFixed(2)}</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </div>
  );
}
