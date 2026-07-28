/**
 * ui/ProjectPanel.tsx
 * The project browser: media, models, audio and AI starting points.
 * Media items are drag sources for the timeline and double-click to append.
 */

import { useRef, useState } from 'react';
import { SUGGESTIONS, interpret } from '../ai/elaine';
import { edit, setStatus, useProject } from '../core/project';
import type { MediaAsset } from '../core/types';
import { importFile } from '../media/mediaEngine';
import { addClipFromAsset, contentDuration } from '../timeline/engine';
import { addPrimitive, deleteObjects, selectObjects } from '../threeD/scene';

type Tab = 'media' | 'models' | 'audio' | 'ai';

export function ProjectPanel(): JSX.Element {
  const project = useProject();
  const [tab, setTab] = useState<Tab>('media');
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const onFiles = async (files: FileList | null) => {
    if (!files?.length) return;
    setError(null);
    const imported: MediaAsset[] = [];
    for (const file of Array.from(files)) {
      try {
        imported.push(await importFile(file));
      } catch (e) {
        setError(`${file.name} — ${(e as Error).message}`);
      }
    }
    if (imported.length) {
      edit('Import media', (s) => ({ ...s, media: [...s.media, ...imported] }));
      setStatus(`Imported ${imported.length} file${imported.length > 1 ? 's' : ''}`);
    }
  };

  const appendToTimeline = (asset: MediaAsset) => {
    const kind = asset.kind === 'audio' ? 'audio' : 'video';
    const track = project.tracks.find((t) => t.kind === kind) ?? project.tracks[0];
    addClipFromAsset(asset, track.id, contentDuration(project));
  };

  const visible =
    tab === 'audio' ? project.media.filter((m) => m.kind === 'audio') : project.media.filter((m) => m.kind !== 'audio');

  return (
    <aside className="panel panel--project">
      <nav className="panel__tabs">
        {(['media', 'models', 'audio', 'ai'] as Tab[]).map((t) => (
          <button key={t} className={`panel__tab ${tab === t ? 'is-active' : ''}`} onClick={() => setTab(t)}>
            {t}
          </button>
        ))}
      </nav>

      {tab === 'media' || tab === 'audio' ? (
        <div className="panel__body">
          <button className="btn btn--ghost" onClick={() => fileRef.current?.click()}>
            Import media
          </button>
          <input
            ref={fileRef}
            type="file"
            multiple
            accept="video/*,audio/*,image/*"
            hidden
            onChange={(e) => void onFiles(e.target.files)}
          />
          {error ? <p className="error">{error}</p> : null}

          {visible.length === 0 ? (
            <p className="hint">
              Nothing imported yet. Add video, audio or stills, then drag them onto a track.
            </p>
          ) : null}

          <ul className="bin">
            {visible.map((asset) => (
              <li
                key={asset.id}
                className="bin__item"
                draggable
                onDragStart={(e) => e.dataTransfer.setData('application/x-eternalnode-asset', asset.id)}
                onDoubleClick={() => appendToTimeline(asset)}
                title="Drag onto a track, or double-click to append"
              >
                <div className="bin__thumb">
                  {asset.thumbnail ? <img src={asset.thumbnail} alt="" /> : <span>{asset.kind[0].toUpperCase()}</span>}
                </div>
                <div className="bin__meta">
                  <strong>{asset.name}</strong>
                  <span>
                    {asset.kind} · {asset.duration.toFixed(1)}s
                    {asset.width ? ` · ${asset.width}×${asset.height}` : ''}
                  </span>
                  {asset.missing ? <span className="tag tag--warn">Relink needed</span> : null}
                </div>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {tab === 'models' ? (
        <div className="panel__body">
          <div className="grid2">
            {(['cube', 'sphere', 'cylinder', 'cone', 'torus', 'plane'] as const).map((k) => (
              <button key={k} className="btn btn--ghost" onClick={() => addPrimitive(k)}>
                {k}
              </button>
            ))}
          </div>
          <ul className="bin bin--flat">
            {project.scene.objects.map((o) => (
              <li
                key={o.id}
                className={`bin__row ${project.selection.objectIds.includes(o.id) ? 'is-selected' : ''}`}
                onClick={() => selectObjects([o.id])}
              >
                <span className="dot" style={{ background: o.material.color }} />
                <span>{o.name}</span>
                <button
                  className="icon-btn icon-btn--tiny"
                  onClick={(e) => {
                    e.stopPropagation();
                    deleteObjects([o.id]);
                  }}
                >
                  ✕
                </button>
              </li>
            ))}
          </ul>
          {!project.scene.objects.length ? <p className="hint">Add a primitive to start a scene.</p> : null}
        </div>
      ) : null}

      {tab === 'ai' ? (
        <div className="panel__body">
          <p className="hint">One click builds an editable node chain. Nothing is baked in.</p>
          {SUGGESTIONS.map((s) => (
            <button
              key={s}
              className="btn btn--ghost btn--wrap"
              onClick={() => {
                const plan = interpret(s);
                plan.apply();
                setStatus(`E.L.A.I.N.E. — ${plan.title}`);
              }}
            >
              {s}
            </button>
          ))}
        </div>
      ) : null}
    </aside>
  );
}
