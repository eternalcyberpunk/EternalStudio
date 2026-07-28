/**
 * media/mediaEngine.ts
 * Imports files, probes duration/dimensions, generates poster thumbnails and
 * owns a pool of decoder elements the compositor draws from.
 *
 * Functional: local file import (video/audio/image), probing, thumbnails,
 * seek-and-hold decoding, per-asset element reuse.
 * Planned: FFmpeg/WebCodecs proxy generation, hardware decode hints,
 * background conform, multicam sync.
 */

import type { MediaAsset, MediaKind } from '../core/types';
import { uid } from '../core/utils';

const elements = new Map<string, HTMLVideoElement>();

function kindOf(file: File): MediaKind {
  if (file.type.startsWith('video')) return 'video';
  if (file.type.startsWith('audio')) return 'audio';
  return 'image';
}

function probeVideo(url: string): Promise<{ duration: number; width: number; height: number; thumbnail: string }> {
  return new Promise((resolve, reject) => {
    const v = document.createElement('video');
    v.preload = 'metadata';
    v.muted = true;
    v.crossOrigin = 'anonymous';
    v.src = url;
    v.onloadeddata = () => {
      v.currentTime = Math.min(0.2, v.duration / 2 || 0);
      v.onseeked = () => {
        const c = document.createElement('canvas');
        c.width = 160;
        c.height = Math.max(1, Math.round((160 * v.videoHeight) / (v.videoWidth || 1)));
        c.getContext('2d')?.drawImage(v, 0, 0, c.width, c.height);
        resolve({
          duration: isFinite(v.duration) ? v.duration : 10,
          width: v.videoWidth,
          height: v.videoHeight,
          thumbnail: c.toDataURL('image/jpeg', 0.6),
        });
      };
    };
    v.onerror = () => reject(new Error('Could not decode this video.'));
  });
}

function probeImage(url: string): Promise<{ width: number; height: number; thumbnail: string }> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const c = document.createElement('canvas');
      c.width = 160;
      c.height = Math.max(1, Math.round((160 * img.height) / img.width));
      c.getContext('2d')?.drawImage(img, 0, 0, c.width, c.height);
      resolve({ width: img.width, height: img.height, thumbnail: c.toDataURL('image/jpeg', 0.6) });
    };
    img.onerror = () => reject(new Error('Could not decode this image.'));
    img.src = url;
  });
}

function probeAudio(url: string): Promise<{ duration: number }> {
  return new Promise((resolve, reject) => {
    const a = document.createElement('audio');
    a.preload = 'metadata';
    a.src = url;
    a.onloadedmetadata = () => resolve({ duration: isFinite(a.duration) ? a.duration : 10 });
    a.onerror = () => reject(new Error('Could not decode this audio.'));
  });
}

export async function importFile(file: File): Promise<MediaAsset> {
  const url = URL.createObjectURL(file);
  const kind = kindOf(file);
  const base = { id: uid('med'), name: file.name, kind, url } as MediaAsset;

  if (kind === 'video') {
    const info = await probeVideo(url);
    return { ...base, ...info };
  }
  if (kind === 'image') {
    const info = await probeImage(url);
    return { ...base, ...info, duration: 5 };
  }
  const info = await probeAudio(url);
  return { ...base, ...info, width: 0, height: 0 };
}

/* --------------------------------------------------------- decode elements --- */

/** One reusable media element per asset, shared by the viewport and exporter. */
export function elementFor(asset: MediaAsset): HTMLVideoElement | null {
  if (asset.kind === 'image' || !asset.url) return null;
  let el = elements.get(asset.id);
  if (!el) {
    el = document.createElement('video');
    el.src = asset.url;
    el.muted = asset.kind === 'video';
    el.playsInline = true;
    el.preload = 'auto';
    elements.set(asset.id, el);
  }
  return el;
}

const images = new Map<string, HTMLImageElement>();

export function imageFor(asset: MediaAsset): HTMLImageElement | null {
  if (asset.kind !== 'image' || !asset.url) return null;
  let img = images.get(asset.id);
  if (!img) {
    img = new Image();
    img.src = asset.url;
    images.set(asset.id, img);
  }
  return img;
}

/**
 * Keeps a decoder element aligned with the sequence time.
 * While scrubbing we seek; while playing we let the element run and only
 * correct when drift passes a threshold, which avoids seek thrash.
 */
export function syncElement(
  el: HTMLVideoElement,
  sourceTime: number,
  playing: boolean,
  rate = 1,
): void {
  const drift = Math.abs(el.currentTime - sourceTime);
  if (playing) {
    if (el.playbackRate !== rate) el.playbackRate = rate;
    if (drift > 0.25) el.currentTime = sourceTime;
    if (el.paused) void el.play().catch(() => undefined);
  } else {
    if (!el.paused) el.pause();
    if (drift > 1 / 60) el.currentTime = sourceTime;
  }
}

export function pauseAll(): void {
  elements.forEach((el) => el.pause());
}

export function releaseAsset(assetId: string): void {
  elements.get(assetId)?.removeAttribute('src');
  elements.delete(assetId);
  images.delete(assetId);
}
