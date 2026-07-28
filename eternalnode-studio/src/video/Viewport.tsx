/**
 * video/Viewport.tsx
 * The program monitor. Every frame it flattens the timeline's visible layers
 * into an offscreen 2D canvas, hands that to the GPU compositor along with the
 * node chain, and blits the result.
 *
 * It reads the stores directly inside a rAF loop rather than through React
 * state — the UI must not re-render 60 times a second for playback to be smooth.
 *
 * Functional: multi-layer flatten (video/image/text), opacity, cover fit, audio
 * playback, node chain applied live, safe-area guides, quality scaling.
 * Planned: 3D layer render-in, per-clip transform handles, scopes, HDR preview.
 */

import { useEffect, useRef, useState } from 'react';
import { projectStore, useProject } from '../core/project';
import { transportStore, useTransport } from '../core/store';
import { timecode } from '../core/utils';
import { elementFor, imageFor, pauseAll, syncElement } from '../media/mediaEngine';
import { evaluate } from '../nodes/evaluator';
import { clipEnd } from '../timeline/engine';
import { pause, play, seek, stepFrames, toggleLoop } from '../timeline/engine';
import { Compositor } from './compositor';

const PREVIEW_HEIGHTS = { Full: 1080, Half: 720, Quarter: 540 } as const;
type Quality = keyof typeof PREVIEW_HEIGHTS;

function drawCover(
  ctx: CanvasRenderingContext2D,
  src: CanvasImageSource,
  sw: number,
  sh: number,
  dw: number,
  dh: number,
): void {
  if (!sw || !sh) return;
  const scale = Math.max(dw / sw, dh / sh);
  const w = sw * scale;
  const h = sh * scale;
  ctx.drawImage(src, (dw - w) / 2, (dh - h) / 2, w, h);
}

export function Viewport(): JSX.Element {
  const project = useProject();
  const transport = useTransport();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const layerRef = useRef<HTMLCanvasElement>(document.createElement('canvas'));
  const compositorRef = useRef<Compositor | null>(null);
  const [quality, setQuality] = useState<Quality>('Half');
  const [error, setError] = useState<string | null>(null);
  const [showGuides, setShowGuides] = useState(false);

  useEffect(() => {
    if (!canvasRef.current) return;
    try {
      compositorRef.current = new Compositor(canvasRef.current);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    let raf = 0;
    const loop = () => {
      raf = requestAnimationFrame(loop);
      const comp = compositorRef.current;
      if (!comp) return;

      const state = projectStore.get();
      const t = transportStore.get();
      const aspect = state.meta.width / state.meta.height;
      const h = PREVIEW_HEIGHTS[quality];
      const w = Math.round(h * aspect);

      const layer = layerRef.current;
      if (layer.width !== w || layer.height !== h) {
        layer.width = w;
        layer.height = h;
      }
      comp.resize(w, h);

      const ctx = layer.getContext('2d');
      if (!ctx) return;
      ctx.clearRect(0, 0, w, h);
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, w, h);

      // Bottom-up: the last track in the list is the base layer.
      for (let i = state.tracks.length - 1; i >= 0; i--) {
        const track = state.tracks[i];
        if (track.hidden) continue;
        for (const clip of track.clips) {
          if (t.time < clip.start || t.time >= clipEnd(clip)) continue;
          const local = (t.time - clip.start) * clip.speed + clip.inPoint;
          ctx.save();
          ctx.globalAlpha = clip.opacity;

          if (track.kind === 'text' && clip.text) {
            ctx.font = `600 ${Math.round(h * 0.09)}px "Chakra Petch", sans-serif`;
            ctx.textAlign = 'center';
            ctx.fillStyle = '#f2fbff';
            ctx.shadowColor = 'rgba(34,228,245,0.55)';
            ctx.shadowBlur = h * 0.03;
            ctx.fillText(clip.text, w / 2, h * 0.86);
          } else if (clip.assetId) {
            const asset = state.media.find((m) => m.id === clip.assetId);
            if (asset && !asset.missing) {
              if (asset.kind === 'image') {
                const img = imageFor(asset);
                if (img?.complete) drawCover(ctx, img, img.naturalWidth, img.naturalHeight, w, h);
              } else {
                const el = elementFor(asset);
                if (el) {
                  el.muted = track.kind === 'audio' ? track.muted : true;
                  syncElement(el, local, t.playing, t.rate);
                  if (asset.kind === 'video' && el.readyState >= 2) {
                    drawCover(ctx, el, el.videoWidth, el.videoHeight, w, h);
                  }
                }
              }
            }
          }
          ctx.restore();
        }
      }

      if (showGuides) {
        ctx.strokeStyle = 'rgba(255,255,255,0.22)';
        ctx.lineWidth = 1;
        ctx.strokeRect(w * 0.05, h * 0.05, w * 0.9, h * 0.9);
        ctx.strokeRect(w * 0.1, h * 0.1, w * 0.8, h * 0.8);
      }

      try {
        comp.render(layer, evaluate(state, t.time), t.time, timecode(t.time, state.meta.fps));
      } catch (e) {
        setError((e as Error).message);
      }
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [quality, showGuides]);

  useEffect(() => {
    if (!transport.playing) pauseAll();
  }, [transport.playing]);

  return (
    <div className="viewport">
      <div className="viewport__stage">
        {error ? (
          <div className="viewport__error">
            <strong>Preview stopped</strong>
            <span>{error}</span>
          </div>
        ) : null}
        <canvas ref={canvasRef} className="viewport__canvas" />
      </div>

      <div className="transport">
        <div className="transport__group">
          <button className="icon-btn" title="Back 1 frame (←)" onClick={() => stepFrames(-1)}>
            ⟨
          </button>
          <button
            className="icon-btn icon-btn--primary"
            title="Play / Pause (Space)"
            onClick={() => (transport.playing ? pause() : play())}
          >
            {transport.playing ? '❚❚' : '▶'}
          </button>
          <button className="icon-btn" title="Forward 1 frame (→)" onClick={() => stepFrames(1)}>
            ⟩
          </button>
          <button
            className={`icon-btn ${transport.loop ? 'is-active' : ''}`}
            title="Loop playback"
            onClick={toggleLoop}
          >
            ↻
          </button>
        </div>

        <div className="transport__timecode">
          <span className="tc">{timecode(transport.time, project.meta.fps)}</span>
          <span className="tc tc--muted">/ {timecode(project.meta.duration, project.meta.fps)}</span>
        </div>

        <div className="transport__group">
          <button
            className={`chip ${showGuides ? 'is-active' : ''}`}
            onClick={() => setShowGuides((g) => !g)}
          >
            Guides
          </button>
          <select
            className="select"
            value={quality}
            onChange={(e) => setQuality(e.target.value as Quality)}
            title="Preview resolution"
          >
            {Object.keys(PREVIEW_HEIGHTS).map((q) => (
              <option key={q} value={q}>
                {q}
              </option>
            ))}
          </select>
        </div>
      </div>

      <input
        className="scrub"
        type="range"
        min={0}
        max={project.meta.duration}
        step={1 / project.meta.fps}
        value={transport.time}
        onChange={(e) => seek(Number(e.target.value))}
      />
    </div>
  );
}
