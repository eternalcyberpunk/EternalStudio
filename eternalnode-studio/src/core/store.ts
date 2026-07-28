/**
 * core/store.ts
 * A ~60 line immutable external store bound to React through
 * useSyncExternalStore. No dependency, no context plumbing, and the same
 * store instance is readable from non-React code (the render loop, the
 * exporter, the node evaluator) which is exactly what a real-time app needs.
 */

import { useSyncExternalStore } from 'react';

type Listener = () => void;

export interface Store<T> {
  get(): T;
  set(updater: T | ((state: T) => T)): void;
  subscribe(listener: Listener): () => void;
}

export function createStore<T>(initial: T): Store<T> {
  let state = initial;
  const listeners = new Set<Listener>();
  return {
    get: () => state,
    set(updater) {
      const next =
        typeof updater === 'function' ? (updater as (s: T) => T)(state) : updater;
      if (next === state) return;
      state = next;
      listeners.forEach((l) => l());
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

/** Subscribe a component to the whole store. Snapshots are identity-stable. */
export function useStoreState<T>(store: Store<T>): T {
  return useSyncExternalStore(store.subscribe, store.get, store.get);
}

/**
 * High-frequency values (playhead, transport state) deliberately do NOT live in
 * the project store — re-rendering the whole app at 60fps is how creative apps
 * get slow. They live here instead and only the viewport, ruler and timecode
 * readout subscribe.
 */
export const transportStore = createStore({
  time: 0,
  playing: false,
  rate: 1,
  loop: false,
});

export const useTransport = () => useStoreState(transportStore);
