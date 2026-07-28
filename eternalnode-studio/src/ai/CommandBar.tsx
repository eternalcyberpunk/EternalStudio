/**
 * ai/CommandBar.tsx
 * The E.L.A.I.N.E. command surface (⌘K / Ctrl+K).
 *
 * It shows the plan before it runs. The user sees exactly which nodes, clips or
 * objects are about to be created, applies them, and then edits them like any
 * other part of the project.
 */

import { useEffect, useMemo, useState } from 'react';
import { setUI, useProject } from '../core/project';
import { SUGGESTIONS, interpret } from './elaine';

export function CommandBar(): JSX.Element | null {
  const project = useProject();
  const [text, setText] = useState('');
  const open = project.ui.commandOpen;

  useEffect(() => {
    if (!open) setText('');
  }, [open]);

  const plan = useMemo(() => (text.trim() ? interpret(text) : null), [text]);

  if (!open) return null;

  const run = () => {
    if (!plan) return;
    plan.apply();
    setUI({ commandOpen: false, statusMessage: `E.L.A.I.N.E. — ${plan.title}` });
  };

  return (
    <div className="modal" onPointerDown={() => setUI({ commandOpen: false })}>
      <div className="command" onPointerDown={(e) => e.stopPropagation()}>
        <header className="command__head">
          <span className="command__mark">E.L.A.I.N.E.</span>
          <span className="command__sub">Elegant Lazarus Artificial Intelligence Neural Entity</span>
        </header>

        <input
          autoFocus
          className="command__input"
          placeholder="Describe what you want to create…"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') run();
            if (e.key === 'Escape') setUI({ commandOpen: false });
          }}
        />

        {plan ? (
          <div className="command__plan">
            <div className="command__planhead">
              <strong>{plan.title}</strong>
              <span>{plan.steps.length} steps — every one stays editable</span>
            </div>
            <ol className="command__steps">
              {plan.steps.map((s, i) => (
                <li key={i}>{s}</li>
              ))}
            </ol>
            <button className="btn btn--primary" onClick={run}>
              Build it
            </button>
          </div>
        ) : (
          <div className="command__suggestions">
            {SUGGESTIONS.map((s) => (
              <button key={s} className="suggestion" onClick={() => setText(s)}>
                {s}
              </button>
            ))}
          </div>
        )}

        <footer className="command__foot">
          Running the on-device rule planner. Generative nodes (text-to-image, upscale, rotoscope,
          voice) are declared in the node registry and marked Planned until their runtimes ship.
        </footer>
      </div>
    </div>
  );
}
