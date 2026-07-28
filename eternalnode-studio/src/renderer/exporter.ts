/**
 * renderer/exporter.ts
 * The export architecture: presets, job description, progress and the encoders
 * available in the browser prototype.
 *
 * Functional: WebM (VP9/VP8) real-time capture of the composited GPU canvas,
 * single-frame PNG, PNG sequence to a chosen folder where the File System
 * Access API exists, render range, cancellation, size/time estimates.
 * Planned: MP4/H.264, H.265, AV1, ProRes and EXR — these arrive with the
 * FFmpeg/WebCodecs backend in the Tauri build and slot in behind `runExport`
 * without changing the panel.
 */

import { projectStore } from '../core/project';
import { transportStore } from '../core/store';
import { pause, seek } from '../timeline/engine';

export type ExportFormat = 'webm' | 'png' | 'pngseq' | 'mp4' | 'mov' | 'gif' | 'exr';

export interface ExportPreset {
  id: string;
  label: string;
  width: number;
  height: number;
  fps: number;
  bitrateMbps: number;
  format: ExportFormat;
}

export const PRESETS: ExportPreset[] = [
  { id: 'youtube', label: 'YouTube 1080p', width: 1920, height: 1080, fps: 30, bitrateMbps: 12, format: 'webm' },
  { id: 'youtube4k', label: 'YouTube 4K', width: 3840, height: 2160, fps: 30, bitrateMbps: 45, format: 'webm' },
  { id: 'tiktok', label: 'TikTok / Shorts', width: 1080, height: 1920, fps: 30, bitrateMbps: 10, format: 'webm' },
  { id: 'instagram', label: 'Instagram Square', width: 1080, height: 1080, fps: 30, bitrateMbps: 10, format: 'webm' },
  { id: 'film', label: 'Film 2K 24p', width: 2048, height: 1080, fps: 24, bitrateMbps: 30, format: 'webm' },
  { id: 'frame', label: 'Still frame (PNG)', width: 1920, height: 1080, fps: 30, bitrateMbps: 0, format: 'png' },
  { id: 'sequence', label: 'PNG sequence', width: 1920, height: 1080, fps: 30, bitrateMbps: 0, format: 'pngseq' },
];

export const PLANNED_FORMATS: Array<{ id: ExportFormat; label: string; note: string }> = [
  { id: 'mp4', label: 'MP4 · H.264 / H.265 / AV1', note: 'Ships with the FFmpeg backend' },
  { id: 'mov', label: 'MOV · ProRes', note: 'Ships with the FFmpeg backend' },
  { id: 'gif', label: 'GIF', note: 'Palette quantiser pending' },
  { id: 'exr', label: 'EXR sequence', note: 'Needs the float working space' },
];

export interface ExportJob {
  preset: ExportPreset;
  rangeStart: number;
  rangeEnd: number;
  includeAudio: boolean;
}

export interface ExportProgress {
  phase: 'idle' | 'rendering' | 'encoding' | 'done' | 'error' | 'cancelled';
  progress: number;
  message: string;
  outputUrl?: string;
}

/**
 * The composited canvas is owned by the Viewport component. Rather than thread
 * a ref through the whole tree, the exporter looks it up — the native build
 * replaces this with a direct handle to the render target.
 */
function targetCanvas(): HTMLCanvasElement | null {
  return document.querySelector<HTMLCanvasElement>('canvas.viewport__canvas');
}

export function estimate(job: ExportJob): { seconds: number; bytes: number } {
  const seconds = Math.max(0, job.rangeEnd - job.rangeStart);
  const bytes =
    job.preset.format === 'png'
      ? job.preset.width * job.preset.height * 4
      : (job.preset.bitrateMbps * 1_000_000 * seconds) / 8;
  return { seconds, bytes };
}

let cancelled = false;
export const cancelExport = () => {
  cancelled = true;
};

function download(blob: Blob, filename: string): string {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  return url;
}

export async function runExport(job: ExportJob, onProgress: (p: ExportProgress) => void): Promise<void> {
  cancelled = false;
  const canvas = targetCanvas();
  const name = projectStore.get().meta.name.replace(/\s+/g, '_');

  if (!canvas) {
    onProgress({ phase: 'error', progress: 0, message: 'No render target. Open the Edit workspace first.' });
    return;
  }

  if (job.preset.format === 'png') {
    onProgress({ phase: 'rendering', progress: 0.5, message: 'Rendering frame…' });
    await new Promise((r) => requestAnimationFrame(r));
    canvas.toBlob((blob) => {
      if (!blob) return onProgress({ phase: 'error', progress: 0, message: 'Frame capture failed.' });
      const url = download(blob, `${name}_frame.png`);
      onProgress({ phase: 'done', progress: 1, message: 'Frame exported', outputUrl: url });
    }, 'image/png');
    return;
  }

  if (job.preset.format === 'pngseq') {
    const picker = (window as unknown as { showDirectoryPicker?: () => Promise<FileSystemDirectoryHandle> })
      .showDirectoryPicker;
    if (!picker) {
      onProgress({
        phase: 'error',
        progress: 0,
        message: 'Sequence export needs the File System Access API. Use Chrome or Edge, or export WebM.',
      });
      return;
    }
    const dir = await picker.call(window);
    const fps = job.preset.fps;
    const total = Math.max(1, Math.round((job.rangeEnd - job.rangeStart) * fps));
    pause();
    for (let i = 0; i < total; i++) {
      if (cancelled) {
        onProgress({ phase: 'cancelled', progress: i / total, message: 'Export cancelled' });
        return;
      }
      seek(job.rangeStart + i / fps);
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/png'));
      if (blob) {
        const handle = await dir.getFileHandle(`${name}_${String(i).padStart(5, '0')}.png`, { create: true });
        const writable = await handle.createWritable();
        await writable.write(blob);
        await writable.close();
      }
      onProgress({ phase: 'rendering', progress: i / total, message: `Frame ${i + 1} of ${total}` });
    }
    onProgress({ phase: 'done', progress: 1, message: `${total} frames written` });
    return;
  }

  // WebM: real-time capture of the GPU canvas.
  const mime = MediaRecorder.isTypeSupported('video/webm;codecs=vp9')
    ? 'video/webm;codecs=vp9'
    : 'video/webm';
  const stream = canvas.captureStream(job.preset.fps);
  const recorder = new MediaRecorder(stream, {
    mimeType: mime,
    videoBitsPerSecond: job.preset.bitrateMbps * 1_000_000,
  });
  const chunks: BlobPart[] = [];
  recorder.ondataavailable = (e) => e.data.size && chunks.push(e.data);

  const finished = new Promise<void>((resolve) => {
    recorder.onstop = () => {
      const blob = new Blob(chunks, { type: 'video/webm' });
      const url = download(blob, `${name}.webm`);
      onProgress({ phase: 'done', progress: 1, message: 'Export finished', outputUrl: url });
      resolve();
    };
  });

  seek(job.rangeStart);
  await new Promise((r) => setTimeout(r, 120));
  recorder.start(250);
  transportStore.set({ ...transportStore.get(), playing: true, loop: false });

  const duration = job.rangeEnd - job.rangeStart;
  const started = performance.now();
  await new Promise<void>((resolve) => {
    const watch = () => {
      const elapsed = (performance.now() - started) / 1000;
      const t = transportStore.get().time;
      if (cancelled || t >= job.rangeEnd || elapsed > duration + 1) return resolve();
      onProgress({
        phase: 'rendering',
        progress: Math.min(1, (t - job.rangeStart) / Math.max(0.001, duration)),
        message: `Recording ${t.toFixed(1)}s of ${job.rangeEnd.toFixed(1)}s`,
      });
      requestAnimationFrame(watch);
    };
    watch();
  });

  pause();
  onProgress({ phase: 'encoding', progress: 0.98, message: 'Finalising container…' });
  recorder.stop();
  await finished;
}
