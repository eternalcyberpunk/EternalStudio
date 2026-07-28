/**
 * timeline/engine.ts
 * Pure timeline operations plus the transport clock.
 *
 * Nothing here touches React. The timeline view calls these; so does the AI
 * command bar, the exporter and (later) the plugin SDK. Every clip mutation
 * routes through core/project's `edit()` so it lands in undo history.
 *
 * Functional: add/move/trim/split/delete, ripple delete, slip, magnetic snap,
 * track add/remove, playhead transport with looping and rate.
 * Planned: multicam angles, nested compositions, speed ramps with curves.
 */

import { edit, projectStore } from '../core/project';
import { transportStore } from '../core/store';
import type { Clip, MediaAsset, ProjectState, Track, TrackKind } from '../core/types';
import { clamp, snapToFrame, uid } from '../core/utils';

export const SNAP_THRESHOLD_PX = 8;

/* ------------------------------------------------------------- selectors --- */

export const allClips = (s: ProjectState): Clip[] => s.tracks.flatMap((t) => t.clips);

export const findClip = (s: ProjectState, id: string): Clip | undefined =>
  allClips(s).find((c) => c.id === id);

export const clipEnd = (c: Clip) => c.start + c.duration;

export function clipsAt(s: ProjectState, time: number): Clip[] {
  return allClips(s).filter((c) => time >= c.start && time < clipEnd(c));
}

/** Longest clip end, used to auto-grow the sequence. */
export function contentDuration(s: ProjectState): number {
  return allClips(s).reduce((m, c) => Math.max(m, clipEnd(c)), 0);
}

/* --------------------------------------------------------------- helpers --- */

function mapTrack(s: ProjectState, trackId: string, fn: (t: Track) => Track): ProjectState {
  return { ...s, tracks: s.tracks.map((t) => (t.id === trackId ? fn(t) : t)) };
}

function mapClip(s: ProjectState, clipId: string, fn: (c: Clip) => Clip): ProjectState {
  return {
    ...s,
    tracks: s.tracks.map((t) => ({
      ...t,
      clips: t.clips.map((c) => (c.id === clipId ? fn(c) : c)),
    })),
  };
}

const sortClips = (clips: Clip[]) => [...clips].sort((a, b) => a.start - b.start);

/** Candidate snap points: other clip edges, markers, playhead, sequence start. */
export function snapPoints(s: ProjectState, exceptClipId?: string): number[] {
  const pts = [0, transportStore.get().time, ...s.markers.map((m) => m.time)];
  for (const c of allClips(s)) {
    if (c.id === exceptClipId) continue;
    pts.push(c.start, clipEnd(c));
  }
  return pts;
}

export function applySnap(value: number, points: number[], toleranceSeconds: number): number {
  let best = value;
  let bestDist = toleranceSeconds;
  for (const p of points) {
    const d = Math.abs(p - value);
    if (d < bestDist) {
      bestDist = d;
      best = p;
    }
  }
  return best;
}

/* ------------------------------------------------------------ operations --- */

export function addTrack(kind: TrackKind, name?: string): void {
  edit('Add track', (s) => {
    const track: Track = {
      id: uid('trk'),
      kind,
      name:
        name ??
        `${kind[0].toUpperCase()}${kind.slice(1)} ${s.tracks.filter((t) => t.kind === kind).length + 1}`,
      height: kind === 'audio' ? 54 : 62,
      muted: false,
      locked: false,
      hidden: false,
      clips: [],
    };
    // Audio stacks at the bottom; everything else sits above the audio block.
    if (kind === 'audio') return { ...s, tracks: [...s.tracks, track] };
    const firstAudio = s.tracks.findIndex((t) => t.kind === 'audio');
    const at = firstAudio === -1 ? s.tracks.length : firstAudio;
    return { ...s, tracks: [...s.tracks.slice(0, at), track, ...s.tracks.slice(at)] };
  });
}

/** Drop an asset onto a track at a time. Returns the new clip id. */
export function addClipFromAsset(asset: MediaAsset, trackId: string, start: number): string {
  const id = uid('clp');
  edit('Add clip', (s) => {
    const track = s.tracks.find((t) => t.id === trackId);
    if (!track) return s;
    const clip: Clip = {
      id,
      trackId,
      name: asset.name,
      assetId: asset.id,
      start: snapToFrame(Math.max(0, start), s.meta.fps),
      duration: Math.max(0.2, asset.duration || 5),
      inPoint: 0,
      speed: 1,
      opacity: 1,
      effectNodeIds: [],
    };
    const next = mapTrack(s, trackId, (t) => ({ ...t, clips: sortClips([...t.clips, clip]) }));
    return {
      ...next,
      meta: { ...next.meta, duration: Math.max(next.meta.duration, clipEnd(clip) + 2) },
      selection: { ...next.selection, clipIds: [id] },
    };
  });
  return id;
}

export function addTextClip(text: string, trackId: string, start: number, duration = 4): string {
  const id = uid('clp');
  edit('Add title', (s) =>
    mapTrack(s, trackId, (t) => ({
      ...t,
      clips: sortClips([
        ...t.clips,
        {
          id,
          trackId,
          name: text.slice(0, 24),
          start,
          duration,
          inPoint: 0,
          speed: 1,
          opacity: 1,
          effectNodeIds: [],
          text,
        },
      ]),
    })),
  );
  return id;
}

export function moveClip(clipId: string, newStart: number, newTrackId?: string, transient = false): void {
  edit(
    'Move clip',
    (s) => {
      const clip = findClip(s, clipId);
      if (!clip) return s;
      const targetTrack = newTrackId ?? clip.trackId;
      const start = Math.max(0, snapToFrame(newStart, s.meta.fps));
      let next = s;
      if (targetTrack !== clip.trackId) {
        next = {
          ...s,
          tracks: s.tracks.map((t) => {
            if (t.id === clip.trackId) return { ...t, clips: t.clips.filter((c) => c.id !== clipId) };
            if (t.id === targetTrack)
              return { ...t, clips: sortClips([...t.clips, { ...clip, trackId: targetTrack, start }]) };
            return t;
          }),
        };
      } else {
        next = mapTrack(s, clip.trackId, (t) => ({
          ...t,
          clips: sortClips(t.clips.map((c) => (c.id === clipId ? { ...c, start } : c))),
        }));
      }
      return { ...next, meta: { ...next.meta, duration: Math.max(next.meta.duration, contentDuration(next) + 2) } };
    },
    { transient },
  );
}

export type TrimEdge = 'start' | 'end';

export function trimClip(clipId: string, edge: TrimEdge, time: number, transient = false): void {
  edit(
    'Trim clip',
    (s) =>
      mapClip(s, clipId, (c) => {
        const fps = s.meta.fps;
        if (edge === 'start') {
          const start = clamp(snapToFrame(time, fps), 0, clipEnd(c) - 1 / fps);
          const delta = start - c.start;
          return { ...c, start, duration: c.duration - delta, inPoint: Math.max(0, c.inPoint + delta) };
        }
        const end = Math.max(c.start + 1 / fps, snapToFrame(time, fps));
        return { ...c, duration: end - c.start };
      }),
    { transient },
  );
}

/** Slip: shift source content without moving the clip on the timeline. */
export function slipClip(clipId: string, deltaSeconds: number, transient = false): void {
  edit(
    'Slip clip',
    (s) => mapClip(s, clipId, (c) => ({ ...c, inPoint: Math.max(0, c.inPoint + deltaSeconds) })),
    { transient },
  );
}

export function splitAt(time: number): void {
  edit('Split clip', (s) => {
    const fps = s.meta.fps;
    const t = snapToFrame(time, fps);
    return {
      ...s,
      tracks: s.tracks.map((track) => {
        const out: Clip[] = [];
        for (const c of track.clips) {
          if (t > c.start + 1 / fps && t < clipEnd(c) - 1 / fps) {
            out.push({ ...c, duration: t - c.start });
            out.push({
              ...c,
              id: uid('clp'),
              start: t,
              duration: clipEnd(c) - t,
              inPoint: c.inPoint + (t - c.start) * c.speed,
            });
          } else out.push(c);
        }
        return { ...track, clips: sortClips(out) };
      }),
    };
  });
}

export function deleteClips(ids: string[], ripple = false): void {
  edit(ripple ? 'Ripple delete' : 'Delete clip', (s) => {
    const removed = ids.map((id) => findClip(s, id)).filter(Boolean) as Clip[];
    let next: ProjectState = {
      ...s,
      tracks: s.tracks.map((t) => ({ ...t, clips: t.clips.filter((c) => !ids.includes(c.id)) })),
      selection: { ...s.selection, clipIds: [] },
    };
    if (ripple) {
      for (const gone of removed) {
        next = mapTrack(next, gone.trackId, (t) => ({
          ...t,
          clips: t.clips.map((c) => (c.start > gone.start ? { ...c, start: c.start - gone.duration } : c)),
        }));
      }
    }
    return next;
  });
}

export function setClipProp<K extends keyof Clip>(clipId: string, key: K, value: Clip[K], transient = false): void {
  edit(`Set ${String(key)}`, (s) => mapClip(s, clipId, (c) => ({ ...c, [key]: value })), { transient });
}

export function selectClips(ids: string[], additive = false): void {
  const s = projectStore.get();
  const clipIds = additive ? Array.from(new Set([...s.selection.clipIds, ...ids])) : ids;
  projectStore.set({ ...s, selection: { ...s.selection, clipIds } });
}

/* ------------------------------------------------------------- transport --- */

let rafId = 0;
let lastStamp = 0;

function tick(stamp: number): void {
  const dt = (stamp - lastStamp) / 1000;
  lastStamp = stamp;
  const t = transportStore.get();
  if (t.playing) {
    const duration = projectStore.get().meta.duration;
    let time = t.time + dt * t.rate;
    if (time >= duration) time = t.loop ? 0 : duration;
    const playing = t.loop ? true : time < duration;
    transportStore.set({ ...t, time, playing });
  }
  rafId = requestAnimationFrame(tick);
}

export function startTransportClock(): () => void {
  lastStamp = performance.now();
  rafId = requestAnimationFrame(tick);
  return () => cancelAnimationFrame(rafId);
}

export const play = () => transportStore.set({ ...transportStore.get(), playing: true });
export const pause = () => transportStore.set({ ...transportStore.get(), playing: false });
export const togglePlay = () =>
  transportStore.set({ ...transportStore.get(), playing: !transportStore.get().playing });

export function seek(time: number): void {
  const duration = projectStore.get().meta.duration;
  transportStore.set({ ...transportStore.get(), time: clamp(time, 0, duration) });
}

export function stepFrames(frames: number): void {
  const fps = projectStore.get().meta.fps;
  seek(transportStore.get().time + frames / fps);
}

export const setRate = (rate: number) => transportStore.set({ ...transportStore.get(), rate });
export const toggleLoop = () =>
  transportStore.set({ ...transportStore.get(), loop: !transportStore.get().loop });
