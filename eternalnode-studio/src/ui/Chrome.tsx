/**
 * ui/Chrome.tsx
 * Title bar, workspace switcher and status bar.
 * The workspace switcher is the app's main navigation: each mode re-uses the
 * same project document, so switching never converts or exports anything.
 */

import { useRef } from 'react';
import {
  historyDepth,
  loadFromFile,
  redo,
  saveToFile,
  setUI,
  setWorkspace,
  undo,
  useProject,
} from '../core/project';
import { useTransport } from '../core/store';
import type { WorkspaceId } from '../core/types';
import { timecode } from '../core/utils';

const WORKSPACES: Array<{ id: WorkspaceId; label: string; ready: boolean }> = [
  { id: 'edit', label: 'Edit', ready: true },
  { id: 'node', label: 'Nodes', ready: true },
  { id: 'model', label: 'Model', ready: true },
  { id: 'animate', label: 'Animate', ready: true },
  { id: 'material', label: 'Material', ready: false },
  { id: 'ai', label: 'E.L.A.I.N.E.', ready: true },
];

export function TitleBar(): JSX.Element {
  const project = useProject();
  const fileRef = useRef<HTMLInputElement>(null);
  const depth = historyDepth();

  return (
    <header className="titlebar">
      <div className="titlebar__brand">
        <span className="mark" aria-hidden />
        <div className="brandtext">
          <strong>EternalNode Studio</strong>
          <span>Edit Reality. Build Worlds.</span>
        </div>
      </div>

      <nav className="workspaces">
        {WORKSPACES.map((w) => (
          <button
            key={w.id}
            className={`workspace ${project.workspace === w.id ? 'is-active' : ''} ${w.ready ? '' : 'is-planned'}`}
            onClick={() => setWorkspace(w.id)}
            title={w.ready ? `${w.label} workspace` : `${w.label} workspace — planned`}
          >
            {w.label}
            {!w.ready ? <span className="tag tag--planned">soon</span> : null}
          </button>
        ))}
      </nav>

      <div className="titlebar__actions">
        <button className="btn btn--ghost" onClick={() => setUI({ commandOpen: true })} title="⌘K">
          Ask E.L.A.I.N.E.
        </button>
        <button className="btn btn--ghost" onClick={undo} disabled={!depth.undo} title="⌘Z">
          Undo
        </button>
        <button className="btn btn--ghost" onClick={redo} disabled={!depth.redo} title="⇧⌘Z">
          Redo
        </button>
        <button className="btn btn--ghost" onClick={() => fileRef.current?.click()}>
          Open
        </button>
        <input
          ref={fileRef}
          type="file"
          accept=".json"
          hidden
          onChange={(e) => e.target.files?.[0] && void loadFromFile(e.target.files[0])}
        />
        <button className="btn btn--ghost" onClick={saveToFile} title="⌘S">
          Save
        </button>
        <button className="btn btn--primary" onClick={() => setUI({ exportOpen: true })}>
          Export
        </button>
      </div>
    </header>
  );
}

export function StatusBar(): JSX.Element {
  const project = useProject();
  const transport = useTransport();
  const clips = project.tracks.reduce((n, t) => n + t.clips.length, 0);

  return (
    <footer className="statusbar">
      <span className="statusbar__msg">{project.ui.statusMessage}</span>
      <span className="statusbar__stats">
        <span>{clips} clips</span>
        <span>{project.graph.nodes.length} nodes</span>
        <span>{project.scene.objects.length} objects</span>
        <span>
          {project.meta.width}×{project.meta.height} · {project.meta.fps} fps
        </span>
        <span className="tc">{timecode(transport.time, project.meta.fps)}</span>
      </span>
    </footer>
  );
}
