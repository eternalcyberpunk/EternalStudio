/**
 * renderer/ExportPanel.tsx
 * Export UI. Presets on the left, settings on the right, honest labelling of
 * which codecs exist today and which arrive with the native backend.
 */

import { useMemo, useState } from 'react';
import { setUI, useProject } from '../core/project';
import { formatBytes } from '../core/utils';
import {
  PLANNED_FORMATS,
  PRESETS,
  type ExportProgress,
  cancelExport,
  estimate,
  runExport,
} from './exporter';

export function ExportPanel(): JSX.Element | null {
  const project = useProject();
  const [presetId, setPresetId] = useState(PRESETS[0].id);
  const [start, setStart] = useState(0);
  const [end, setEnd] = useState(project.meta.duration);
  const [audio, setAudio] = useState(true);
  const [progress, setProgress] = useState<ExportProgress>({ phase: 'idle', progress: 0, message: '' });

  const preset = PRESETS.find((p) => p.id === presetId)!;
  const job = { preset, rangeStart: start, rangeEnd: end, includeAudio: audio };
  const est = useMemo(() => estimate(job), [preset, start, end]);
  const busy = progress.phase === 'rendering' || progress.phase === 'encoding';

  if (!project.ui.exportOpen) return null;

  return (
    <div className="modal" onPointerDown={() => !busy && setUI({ exportOpen: false })}>
      <div className="export" onPointerDown={(e) => e.stopPropagation()}>
        <header className="export__head">
          <h2>Export</h2>
          <button className="icon-btn" onClick={() => !busy && setUI({ exportOpen: false })}>
            ✕
          </button>
        </header>

        <div className="export__body">
          <div className="export__presets">
            <span className="panel__eyebrow">Presets</span>
            {PRESETS.map((p) => (
              <button
                key={p.id}
                className={`preset ${p.id === presetId ? 'is-active' : ''}`}
                onClick={() => setPresetId(p.id)}
              >
                <strong>{p.label}</strong>
                <span>
                  {p.width}×{p.height} · {p.fps} fps
                </span>
              </button>
            ))}

            <span className="panel__eyebrow">Planned formats</span>
            {PLANNED_FORMATS.map((f) => (
              <div key={f.id} className="preset preset--planned">
                <strong>{f.label}</strong>
                <span>{f.note}</span>
              </div>
            ))}
          </div>

          <div className="export__settings">
            <div className="field">
              <span>Render range</span>
              <div className="row">
                <input
                  type="number"
                  className="input"
                  min={0}
                  max={project.meta.duration}
                  step={0.1}
                  value={start}
                  onChange={(e) => setStart(Number(e.target.value))}
                />
                <input
                  type="number"
                  className="input"
                  min={0}
                  max={project.meta.duration}
                  step={0.1}
                  value={end}
                  onChange={(e) => setEnd(Number(e.target.value))}
                />
              </div>
            </div>

            <label className="field field--inline">
              <span>Include audio</span>
              <input type="checkbox" checked={audio} onChange={(e) => setAudio(e.target.checked)} />
            </label>

            <dl className="export__stats">
              <div>
                <dt>Resolution</dt>
                <dd>
                  {preset.width}×{preset.height}
                </dd>
              </div>
              <div>
                <dt>Frame rate</dt>
                <dd>{preset.fps} fps</dd>
              </div>
              <div>
                <dt>Codec</dt>
                <dd>{preset.format === 'webm' ? 'VP9 (WebM)' : preset.format.toUpperCase()}</dd>
              </div>
              <div>
                <dt>Estimated size</dt>
                <dd>{preset.bitrateMbps ? formatBytes(est.bytes) : '—'}</dd>
              </div>
              <div>
                <dt>Estimated time</dt>
                <dd>{preset.format === 'webm' ? `${est.seconds.toFixed(1)}s (real time)` : 'Fast'}</dd>
              </div>
            </dl>

            {progress.phase !== 'idle' ? (
              <div className={`export__progress is-${progress.phase}`}>
                <div className="bar">
                  <span style={{ width: `${Math.round(progress.progress * 100)}%` }} />
                </div>
                <span>{progress.message}</span>
              </div>
            ) : null}

            <p className="hint">
              WebM export records the live GPU composite in real time, so leave the window focused
              while it runs.
            </p>

            <div className="export__actions">
              {busy ? (
                <button className="btn" onClick={cancelExport}>
                  Cancel
                </button>
              ) : null}
              <button className="btn btn--primary" disabled={busy} onClick={() => void runExport(job, setProgress)}>
                {busy ? 'Exporting…' : 'Start export'}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
