/**
 * core/project.ts
 * Owns the project document: creation, mutation, history, and persistence.
 *
 * Every workspace mutates the project through `edit()` so undo/redo, the dirty
 * flag and autosave work identically no matter which panel made the change.
 */

import { createStore, useStoreState } from './store';
import type { ProjectState, Track, WorkspaceId } from './types';
import { uid } from './utils';

const FORMAT_VERSION = 1;
const AUTOSAVE_KEY = 'eternalnode.autosave.v1';

function makeTrack(kind: Track['kind'], name: string, height = 62): Track {
  return { id: uid('trk'), kind, name, height, muted: false, locked: false, hidden: false, clips: [] };
}

export function createProject(name = 'Untitled Project'): ProjectState {
  const now = Date.now();
  return {
    meta: {
      id: uid('prj'),
      name,
      fps: 30,
      width: 1920,
      height: 1080,
      duration: 60,
      createdAt: now,
      modifiedAt: now,
      formatVersion: FORMAT_VERSION,
    },
    media: [],
    tracks: [
      makeTrack('text', 'Titles', 48),
      makeTrack('object3d', '3D Layer', 48),
      makeTrack('video', 'Video 2'),
      makeTrack('video', 'Video 1'),
      makeTrack('audio', 'Audio 1', 54),
    ],
    markers: [],
    graph: { nodes: [], edges: [] },
    scene: { objects: [] },
    selection: { clipIds: [], nodeIds: [], objectIds: [] },
    workspace: 'edit',
    ui: {
      pixelsPerSecond: 90,
      snapping: true,
      exportOpen: false,
      commandOpen: false,
      graphEditorOpen: false,
      statusMessage: 'Ready',
    },
  };
}

export const projectStore = createStore<ProjectState>(createProject());
export const useProject = () => useStoreState(projectStore);

/* ---------------------------------------------------------------- history --- */

interface HistoryEntry {
  label: string;
  state: ProjectState;
}

const past: HistoryEntry[] = [];
const future: HistoryEntry[] = [];
const HISTORY_LIMIT = 100;
let dirty = false;

/** Strip volatile UI state so undo doesn't fight the user's panel layout. */
const persistable = (s: ProjectState): ProjectState => s;

/**
 * The one mutation entry point.
 * @param label   Shown in the status bar and (later) the history panel.
 * @param fn      Pure producer: receives a shallow-cloned draft, returns state.
 * @param options `transient: true` skips the undo stack (drag previews).
 */
export function edit(
  label: string,
  fn: (state: ProjectState) => ProjectState,
  options: { transient?: boolean } = {},
): void {
  const current = projectStore.get();
  if (!options.transient) {
    past.push({ label, state: persistable(current) });
    if (past.length > HISTORY_LIMIT) past.shift();
    future.length = 0;
  }
  const next = fn(current);
  next.meta = { ...next.meta, modifiedAt: Date.now() };
  if (!options.transient) next.ui = { ...next.ui, statusMessage: label };
  dirty = true;
  projectStore.set(next);
}

/**
 * Drag interactions call begin/commit so a whole gesture collapses into one
 * undo step while still updating the UI on every pointer move.
 */
let pending: ProjectState | null = null;

export function beginTransaction(): void {
  pending = projectStore.get();
}

export function commitTransaction(label: string): void {
  if (!pending) return;
  past.push({ label, state: pending });
  if (past.length > HISTORY_LIMIT) past.shift();
  future.length = 0;
  pending = null;
  setStatus(label);
}

export function cancelTransaction(): void {
  if (pending) projectStore.set(pending);
  pending = null;
}

export function undo(): void {
  const entry = past.pop();
  if (!entry) return;
  future.push({ label: entry.label, state: projectStore.get() });
  projectStore.set({ ...entry.state, ui: { ...entry.state.ui, statusMessage: `Undo — ${entry.label}` } });
}

export function redo(): void {
  const entry = future.pop();
  if (!entry) return;
  past.push({ label: entry.label, state: projectStore.get() });
  projectStore.set({ ...entry.state, ui: { ...entry.state.ui, statusMessage: `Redo — ${entry.label}` } });
}

export const historyDepth = () => ({ undo: past.length, redo: future.length });

export function setWorkspace(workspace: WorkspaceId): void {
  projectStore.set({ ...projectStore.get(), workspace });
}

export function setUI(patch: Partial<ProjectState['ui']>): void {
  const s = projectStore.get();
  projectStore.set({ ...s, ui: { ...s.ui, ...patch } });
}

export function setStatus(message: string): void {
  setUI({ statusMessage: message });
}

/* ------------------------------------------------------------ persistence --- */

/**
 * Serialised form of Project.eternal. In the Tauri build this becomes a folder
 * (project.json / timeline.json / nodes.json / scene.eternal3d / media/…);
 * in the browser prototype it is one JSON blob and media is relinked by name.
 */
export function serialize(state: ProjectState): string {
  const doc = {
    format: 'eternalnode.project',
    formatVersion: FORMAT_VERSION,
    project: state.meta,
    timeline: { tracks: state.tracks, markers: state.markers },
    nodes: state.graph,
    scene: state.scene,
    // Object URLs cannot survive a reload: keep names so we can relink.
    media: state.media.map((m) => ({ ...m, url: '', missing: true })),
  };
  return JSON.stringify(doc, null, 2);
}

export function deserialize(json: string): ProjectState {
  const doc = JSON.parse(json);
  if (doc.format !== 'eternalnode.project') throw new Error('Not an EternalNode project file.');
  const base = createProject(doc.project?.name ?? 'Recovered Project');
  return {
    ...base,
    meta: { ...base.meta, ...doc.project },
    media: doc.media ?? [],
    tracks: doc.timeline?.tracks ?? base.tracks,
    markers: doc.timeline?.markers ?? [],
    graph: doc.nodes ?? base.graph,
    scene: doc.scene ?? base.scene,
    ui: { ...base.ui, statusMessage: 'Project loaded — relink media to restore previews' },
  };
}

export function saveToFile(): void {
  const state = projectStore.get();
  const blob = new Blob([serialize(state)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${state.meta.name.replace(/\s+/g, '_')}.eternal.json`;
  a.click();
  URL.revokeObjectURL(a.href);
  dirty = false;
  setStatus('Project saved');
}

export async function loadFromFile(file: File): Promise<void> {
  const text = await file.text();
  projectStore.set(deserialize(text));
  past.length = 0;
  future.length = 0;
}

/** Autosave + crash recovery. Runs on an interval and only when dirty. */
export function startAutosave(intervalMs = 15000): () => void {
  const timer = window.setInterval(() => {
    if (!dirty) return;
    try {
      localStorage.setItem(AUTOSAVE_KEY, serialize(projectStore.get()));
      dirty = false;
    } catch {
      /* quota exceeded — ignore, the next tick retries */
    }
  }, intervalMs);
  return () => window.clearInterval(timer);
}

export function hasRecovery(): boolean {
  return !!localStorage.getItem(AUTOSAVE_KEY);
}

export function recover(): boolean {
  const json = localStorage.getItem(AUTOSAVE_KEY);
  if (!json) return false;
  projectStore.set(deserialize(json));
  return true;
}
