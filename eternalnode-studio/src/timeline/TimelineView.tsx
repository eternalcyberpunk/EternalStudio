/**
 * timeline/TimelineView.tsx
 * The Edit workspace's timeline. Deliberately plain: tracks, clips, a playhead
 * and direct manipulation. The node graph exists underneath but never gets in
 * the way here.
 *
 * Functional: scrub, zoom, drag-move across tracks, edge trim, shift-drag slip,
 * magnetic snapping with a live guide, marquee-free multi-select via shift,
 * split at playhead, ripple delete, drop media from the project panel, mute /
 * lock / hide per track, markers.
 * Planned: multicam, nested compositions, speed-ramp handles, transitions UI.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { beginTransaction, commitTransaction, edit, setUI, useProject } from '../core/project';
import { transportStore, useTransport } from '../core/store';
import type { Clip, Track } from '../core/types';
import { clamp, timecode, uid } from '../core/utils';
import {
  SNAP_THRESHOLD_PX,
  addClipFromAsset,
  addTrack,
  applySnap,
  clipEnd,
  deleteClips,
  moveClip,
  seek,
  selectClips,
  slipClip,
  snapPoints,
  splitAt,
  trimClip,
} from './engine';

const HEADER_W = 172;
const RULER_H = 30;

type DragMode = 'move' | 'trim-start' | 'trim-end' | 'slip';

interface DragState {
  mode: DragMode;
  clipId: string;
  originX: number;
  originStart: number;
  originDuration: number;
  originIn: number;
  originTrack: string;
}

const KIND_ACCENT: Record<Track['kind'], string> = {
  video: 'var(--port-video)',
  audio: 'var(--port-audio)',
  image: 'var(--port-video)',
  text: 'var(--accent-purple)',
  object3d: 'var(--port-geometry)',
  adjustment: 'var(--port-value)',
};

export function TimelineView(): JSX.Element {
  const project = useProject();
  const transport = useTransport();
  const laneRef = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<DragState | null>(null);
  const [snapGuide, setSnapGuide] = useState<number | null>(null);

  const pps = project.ui.pixelsPerSecond;
  const duration = project.meta.duration;
  const width = Math.max(duration * pps, 600);

  const xToTime = useCallback(
    (clientX: number) => {
      const lane = laneRef.current;
      if (!lane) return 0;
      const rect = lane.getBoundingClientRect();
      return clamp((clientX - rect.left + lane.scrollLeft) / pps, 0, duration);
    },
    [pps, duration],
  );

  /* ------------------------------------------------------------ scrubbing */

  const scrub = (e: React.PointerEvent) => {
    (e.target as Element).setPointerCapture(e.pointerId);
    seek(xToTime(e.clientX));
  };

  /* ----------------------------------------------------------- clip drags */

  const startDrag = (e: React.PointerEvent, clip: Clip, mode: DragMode) => {
    e.stopPropagation();
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
    selectClips([clip.id], e.shiftKey);
    beginTransaction();
    setDrag({
      mode,
      clipId: clip.id,
      originX: e.clientX,
      originStart: clip.start,
      originDuration: clip.duration,
      originIn: clip.inPoint,
      originTrack: clip.trackId,
    });
  };

  useEffect(() => {
    if (!drag) return;

    const tolerance = SNAP_THRESHOLD_PX / pps;
    const points = project.ui.snapping ? snapPoints(project, drag.clipId) : [];

    const onMove = (e: PointerEvent) => {
      const deltaSeconds = (e.clientX - drag.originX) / pps;

      if (drag.mode === 'move') {
        let start = Math.max(0, drag.originStart + deltaSeconds);
        const snappedStart = applySnap(start, points, tolerance);
        const snappedEnd = applySnap(start + drag.originDuration, points, tolerance) - drag.originDuration;
        const useEnd = Math.abs(snappedEnd - start) < Math.abs(snappedStart - start);
        const next = useEnd ? snappedEnd : snappedStart;
        setSnapGuide(next !== start ? (useEnd ? next + drag.originDuration : next) : null);
        start = next;

        // Track switching follows the pointer's vertical position.
        const el = document.elementFromPoint(e.clientX, e.clientY);
        const laneEl = el?.closest('[data-track-id]') as HTMLElement | null;
        const targetTrack = laneEl?.dataset.trackId ?? drag.originTrack;
        moveClip(drag.clipId, start, targetTrack, true);
      } else if (drag.mode === 'slip') {
        slipClip(drag.clipId, -deltaSeconds * 0.5, true);
      } else if (drag.mode === 'trim-start') {
        const t = applySnap(drag.originStart + deltaSeconds, points, tolerance);
        setSnapGuide(t);
        trimClip(drag.clipId, 'start', t, true);
      } else {
        const t = applySnap(drag.originStart + drag.originDuration + deltaSeconds, points, tolerance);
        setSnapGuide(t);
        trimClip(drag.clipId, 'end', t, true);
      }
    };

    const onUp = () => {
      const label =
        drag.mode === 'move' ? 'Move clip' : drag.mode === 'slip' ? 'Slip clip' : 'Trim clip';
      commitTransaction(label);
      setDrag(null);
      setSnapGuide(null);
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp, { once: true });
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
  }, [drag, pps, project]);

  /* ----------------------------------------------------------- drop media */

  const onDrop = (e: React.DragEvent, trackId: string) => {
    e.preventDefault();
    const assetId = e.dataTransfer.getData('application/x-eternalnode-asset');
    const asset = project.media.find((m) => m.id === assetId);
    if (!asset) return;
    addClipFromAsset(asset, trackId, xToTime(e.clientX));
  };

  /* --------------------------------------------------------------- ruler */

  const ticks = useMemo(() => {
    const targets = [0.5, 1, 2, 5, 10, 30, 60];
    const step = targets.find((s) => s * pps > 70) ?? 120;
    const out: number[] = [];
    for (let t = 0; t <= duration; t += step) out.push(t);
    return out;
  }, [pps, duration]);

  const addMarker = () =>
    edit('Add marker', (s) => ({
      ...s,
      markers: [
        ...s.markers,
        { id: uid('mk'), time: transportStore.get().time, label: `Marker ${s.markers.length + 1}`, color: '#ff2d8a' },
      ],
    }));

  return (
    <section className="timeline">
      <header className="timeline__bar">
        <div className="timeline__tools">
          <button className="chip" onClick={() => splitAt(transport.time)} title="Split at playhead (S)">
            Split
          </button>
          <button
            className="chip"
            onClick={() => deleteClips(project.selection.clipIds, true)}
            disabled={!project.selection.clipIds.length}
            title="Ripple delete (Shift+Del)"
          >
            Ripple delete
          </button>
          <button className="chip" onClick={addMarker} title="Add marker (M)">
            Marker
          </button>
          <button
            className={`chip ${project.ui.snapping ? 'is-active' : ''}`}
            onClick={() => setUI({ snapping: !project.ui.snapping })}
            title="Magnetic snapping (N)"
          >
            Snap
          </button>
          <button
            className={`chip ${project.ui.graphEditorOpen ? 'is-active' : ''}`}
            onClick={() => setUI({ graphEditorOpen: !project.ui.graphEditorOpen })}
          >
            Graph editor
          </button>
        </div>

        <div className="timeline__tools">
          <button className="chip" onClick={() => addTrack('video')}>
            + Video track
          </button>
          <button className="chip" onClick={() => addTrack('audio')}>
            + Audio track
          </button>
          <label className="zoom">
            <span>Zoom</span>
            <input
              type="range"
              min={20}
              max={400}
              value={pps}
              onChange={(e) => setUI({ pixelsPerSecond: Number(e.target.value) })}
            />
          </label>
        </div>
      </header>

      <div className="timeline__body">
        <div className="timeline__heads" style={{ width: HEADER_W }}>
          <div className="timeline__corner" style={{ height: RULER_H }} />
          {project.tracks.map((track) => (
            <div key={track.id} className="track-head" style={{ height: track.height }}>
              <span className="track-head__dot" style={{ background: KIND_ACCENT[track.kind] }} />
              <span className="track-head__name">{track.name}</span>
              <div className="track-head__flags">
                <button
                  className={`flag ${track.hidden ? 'is-off' : ''}`}
                  title="Hide track"
                  onClick={() =>
                    edit('Toggle track visibility', (s) => ({
                      ...s,
                      tracks: s.tracks.map((t) => (t.id === track.id ? { ...t, hidden: !t.hidden } : t)),
                    }))
                  }
                >
                  ◉
                </button>
                <button
                  className={`flag ${track.muted ? 'is-off' : ''}`}
                  title="Mute track"
                  onClick={() =>
                    edit('Toggle track mute', (s) => ({
                      ...s,
                      tracks: s.tracks.map((t) => (t.id === track.id ? { ...t, muted: !t.muted } : t)),
                    }))
                  }
                >
                  ♪
                </button>
              </div>
            </div>
          ))}
        </div>

        <div className="timeline__lanes" ref={laneRef}>
          <div className="timeline__scroll" style={{ width }}>
            <div
              className="ruler"
              style={{ height: RULER_H }}
              onPointerDown={scrub}
              onPointerMove={(e) => e.buttons === 1 && seek(xToTime(e.clientX))}
            >
              {ticks.map((t) => (
                <div key={t} className="ruler__tick" style={{ left: t * pps }}>
                  <span>{timecode(t, project.meta.fps).slice(3, 8)}</span>
                </div>
              ))}
              {project.markers.map((m) => (
                <div key={m.id} className="ruler__marker" style={{ left: m.time * pps, background: m.color }} title={m.label} />
              ))}
            </div>

            {project.tracks.map((track) => (
              <div
                key={track.id}
                className={`lane ${track.hidden ? 'is-hidden' : ''}`}
                data-track-id={track.id}
                style={{ height: track.height }}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => onDrop(e, track.id)}
              >
                {track.clips.map((clip) => {
                  const selected = project.selection.clipIds.includes(clip.id);
                  return (
                    <div
                      key={clip.id}
                      className={`clip ${selected ? 'is-selected' : ''}`}
                      style={{
                        left: clip.start * pps,
                        width: Math.max(6, clip.duration * pps),
                        ['--clip-accent' as string]: KIND_ACCENT[track.kind],
                      }}
                      onPointerDown={(e) => startDrag(e, clip, e.shiftKey ? 'slip' : 'move')}
                    >
                      <div className="clip__handle clip__handle--l" onPointerDown={(e) => startDrag(e, clip, 'trim-start')} />
                      <div className="clip__label">
                        <span className="clip__name">{clip.text ?? clip.name}</span>
                        <span className="clip__time">{clip.duration.toFixed(2)}s</span>
                      </div>
                      {track.kind === 'audio' ? <Waveform playing={transport.playing} /> : null}
                      <div className="clip__handle clip__handle--r" onPointerDown={(e) => startDrag(e, clip, 'trim-end')} />
                    </div>
                  );
                })}
              </div>
            ))}

            {snapGuide !== null ? <div className="snap-guide" style={{ left: snapGuide * pps }} /> : null}
            <div className="playhead" style={{ left: transport.time * pps }}>
              <div className="playhead__grip" />
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

/** Cheap CSS-driven waveform stand-in; real peaks come from the audio engine. */
function Waveform({ playing }: { playing: boolean }): JSX.Element {
  const bars = useMemo(() => Array.from({ length: 48 }, () => 0.25 + Math.random() * 0.75), []);
  return (
    <div className={`wave ${playing ? 'is-playing' : ''}`}>
      {bars.map((h, i) => (
        <span key={i} style={{ height: `${h * 100}%`, animationDelay: `${i * 40}ms` }} />
      ))}
    </div>
  );
}
