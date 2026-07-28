/** core/utils.ts — tiny shared helpers with no dependencies. */

let counter = 0;
export const uid = (prefix = 'id'): string =>
  `${prefix}_${(++counter).toString(36)}${Math.random().toString(36).slice(2, 7)}`;

export const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));

export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/** Seconds -> HH:MM:SS:FF using the project frame rate. */
export function timecode(seconds: number, fps = 30): string {
  const s = Math.max(0, seconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = Math.floor(s % 60);
  const f = Math.floor((s % 1) * fps);
  const p = (n: number) => n.toString().padStart(2, '0');
  return `${p(h)}:${p(m)}:${p(sec)}:${p(f)}`;
}

export const snapToFrame = (t: number, fps: number) => Math.round(t * fps) / fps;

export function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB'];
  let v = bytes / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(1)} ${units[i]}`;
}

/** Frame-accurate throttle for pointer-driven work. */
export function rafThrottle<T extends (...args: never[]) => void>(fn: T): T {
  let queued = false;
  let lastArgs: unknown[] = [];
  return ((...args: unknown[]) => {
    lastArgs = args;
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => {
      queued = false;
      (fn as unknown as (...a: unknown[]) => void)(...lastArgs);
    });
  }) as unknown as T;
}
