/**
 * ui/App.tsx
 * The application shell. It owns the layout for each workspace, the global
 * keyboard map, and the app lifecycle (transport clock, autosave, recovery).
 *
 * Every workspace renders panels against the same project document — switching
 * modes is a layout change, never a data conversion.
 */

import { Suspense, lazy, useEffect, useState } from 'react';
import { CommandBar } from '../ai/CommandBar';
import { GraphEditor } from '../animation/GraphEditor';
import {
  hasRecovery,
  recover,
  redo,
  saveToFile,
  setUI,
  setWorkspace,
  startAutosave,
  undo,
  useProject,
} from '../core/project';
import { NodeEditor } from '../nodes/NodeEditor';
import { ExportPanel } from '../renderer/ExportPanel';
import { TimelineView } from '../timeline/TimelineView';
import { deleteClips, splitAt, startTransportClock, stepFrames, togglePlay } from '../timeline/engine';
import { transportStore } from '../core/store';
import { Viewport } from '../video/Viewport';
import { StatusBar, TitleBar } from './Chrome';
import { Inspector } from './Inspector';
import { ProjectPanel } from './ProjectPanel';
import { Splitter } from './Splitter';

const Viewport3D = lazy(() =>
  import('../threeD/Viewport3D').then((m) => ({ default: m.Viewport3D })),
);

const LAYOUT_KEY = 'eternalnode.layout.v1';

interface Layout {
  left: number;
  right: number;
  bottom: number;
}

const DEFAULT_LAYOUT: Layout = { left: 272, right: 300, bottom: 300 };

export function App(): JSX.Element {
  const project = useProject();
  const [layout, setLayout] = useState<Layout>(() => {
    try {
      return { ...DEFAULT_LAYOUT, ...JSON.parse(localStorage.getItem(LAYOUT_KEY) ?? '{}') };
    } catch {
      return DEFAULT_LAYOUT;
    }
  });
  const [recoverable, setRecoverable] = useState(false);

  useEffect(() => {
    localStorage.setItem(LAYOUT_KEY, JSON.stringify(layout));
  }, [layout]);

  useEffect(() => {
    const stopClock = startTransportClock();
    const stopAutosave = startAutosave();
    setRecoverable(hasRecovery());
    return () => {
      stopClock();
      stopAutosave();
    };
  }, []);

  /* ------------------------------------------------------------- shortcuts */

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const typing = /input|textarea|select/i.test(target.tagName);
      const mod = e.metaKey || e.ctrlKey;

      if (mod && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setUI({ commandOpen: true });
        return;
      }
      if (mod && e.key.toLowerCase() === 's') {
        e.preventDefault();
        saveToFile();
        return;
      }
      if (mod && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        e.shiftKey ? redo() : undo();
        return;
      }
      if (typing) return;

      switch (e.key) {
        case ' ':
          e.preventDefault();
          togglePlay();
          break;
        case 'ArrowLeft':
          stepFrames(e.shiftKey ? -10 : -1);
          break;
        case 'ArrowRight':
          stepFrames(e.shiftKey ? 10 : 1);
          break;
        case 's':
        case 'S':
          splitAt(transportStore.get().time);
          break;
        case 'Backspace':
        case 'Delete':
          deleteClips(project.selection.clipIds, e.shiftKey);
          break;
        case '1':
          setWorkspace('edit');
          break;
        case '2':
          setWorkspace('node');
          break;
        case '3':
          setWorkspace('model');
          break;
        case '4':
          setWorkspace('animate');
          break;
        default:
          break;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [project.selection.clipIds]);

  /* ---------------------------------------------------------------- center */

  const center = () => {
    switch (project.workspace) {
      case 'node':
        return (
          <>
            <div className="stack__top">
              <Viewport />
            </div>
            <Splitter
              orientation="horizontal"
              value={layout.bottom}
              min={200}
              max={720}
              invert
              onChange={(bottom) => setLayout((l) => ({ ...l, bottom }))}
            />
            <div className="stack__bottom" style={{ height: layout.bottom + 120 }}>
              <NodeEditor />
            </div>
          </>
        );

      case 'model':
        return (
          <div className="stack__top">
            <Suspense fallback={<div className="planned"><h2>Loading 3D engine…</h2></div>}>
              <Viewport3D />
            </Suspense>
          </div>
        );

      case 'animate':
        return (
          <>
            <div className="stack__top">
              <Viewport />
            </div>
            <Splitter
              orientation="horizontal"
              value={layout.bottom}
              min={220}
              max={760}
              invert
              onChange={(bottom) => setLayout((l) => ({ ...l, bottom }))}
            />
            <div className="stack__bottom" style={{ height: layout.bottom + 140 }}>
              <GraphEditor />
              <TimelineView />
            </div>
          </>
        );

      case 'material':
        return (
          <div className="stack__top">
            <div className="planned">
              <h2>Material workspace</h2>
              <p>
                Shader graphs share the node registry in <code>src/nodes/registry.ts</code>, so the
                material editor is the same canvas with a different node set. Base color, metallic,
                roughness and emission are editable today in the Inspector when a 3D object is
                selected.
              </p>
              <p className="hint">Planned: procedural texture nodes, color ramps, normal and height inputs.</p>
            </div>
          </div>
        );

      case 'ai':
        return (
          <>
            <div className="stack__top">
              <Viewport />
            </div>
            <Splitter
              orientation="horizontal"
              value={layout.bottom}
              min={200}
              max={720}
              invert
              onChange={(bottom) => setLayout((l) => ({ ...l, bottom }))}
            />
            <div className="stack__bottom" style={{ height: layout.bottom + 120 }}>
              <NodeEditor />
            </div>
          </>
        );

      case 'edit':
      default:
        return (
          <>
            <div className="stack__top">
              <Viewport />
            </div>
            <Splitter
              orientation="horizontal"
              value={layout.bottom}
              min={180}
              max={720}
              invert
              onChange={(bottom) => setLayout((l) => ({ ...l, bottom }))}
            />
            <div className="stack__bottom" style={{ height: layout.bottom }}>
              {project.ui.graphEditorOpen ? <GraphEditor /> : null}
              <TimelineView />
            </div>
          </>
        );
    }
  };

  return (
    <div className="app">
      <TitleBar />

      {recoverable ? (
        <div className="recovery">
          <span>An autosaved session was found.</span>
          <button
            className="btn btn--ghost"
            onClick={() => {
              recover();
              setRecoverable(false);
            }}
          >
            Restore it
          </button>
          <button className="btn btn--ghost" onClick={() => setRecoverable(false)}>
            Dismiss
          </button>
        </div>
      ) : null}

      <main className="stage">
        <div className="stage__left" style={{ width: layout.left }}>
          <ProjectPanel />
        </div>
        <Splitter
          orientation="vertical"
          value={layout.left}
          min={220}
          max={420}
          onChange={(left) => setLayout((l) => ({ ...l, left }))}
        />

        <div className="stage__center">{center()}</div>

        <Splitter
          orientation="vertical"
          value={layout.right}
          min={240}
          max={460}
          invert
          onChange={(right) => setLayout((l) => ({ ...l, right }))}
        />
        <div className="stage__right" style={{ width: layout.right }}>
          <Inspector />
        </div>
      </main>

      <StatusBar />
      <CommandBar />
      <ExportPanel />
    </div>
  );
}
