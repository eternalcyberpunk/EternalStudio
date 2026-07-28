/**
 * scripts/smoke.ts
 * Headless check of the engines that carry the app's correctness: timeline
 * operations, graph evaluation and keyframe sampling.
 *
 *   npm run smoke
 */

import { createProject, projectStore, undo } from '../src/core/project';
import { transportStore } from '../src/core/store';
import type { MediaAsset } from '../src/core/types';
import { interpret } from '../src/ai/elaine';
import { sample } from '../src/animation/keyframes';
import { evaluate, canConnect } from '../src/nodes/evaluator';
import {
  addClipFromAsset,
  addTrack,
  allClips,
  deleteClips,
  moveClip,
  seek,
  splitAt,
  trimClip,
} from '../src/timeline/engine';

let failures = 0;
function check(label: string, condition: boolean): void {
  if (!condition) failures++;
  console.log(`${condition ? 'pass' : 'FAIL'}  ${label}`);
}

projectStore.set(createProject('Smoke Test'));

const asset: MediaAsset = {
  id: 'med_test',
  name: 'plate.mp4',
  kind: 'video',
  url: '',
  duration: 8,
  width: 1920,
  height: 1080,
};
projectStore.set({ ...projectStore.get(), media: [asset] });

/* timeline ------------------------------------------------------------- */

const videoTrack = projectStore.get().tracks.find((t) => t.kind === 'video')!;
const clipId = addClipFromAsset(asset, videoTrack.id, 2);
check('clip lands on the track', allClips(projectStore.get()).length === 1);
check('clip keeps source duration', allClips(projectStore.get())[0].duration === 8);

moveClip(clipId, 5);
check('move updates start', allClips(projectStore.get())[0].start === 5);

trimClip(clipId, 'end', 9);
check('trim end shortens duration', Math.abs(allClips(projectStore.get())[0].duration - 4) < 1e-6);

seek(7);
splitAt(7);
check('split makes two clips', allClips(projectStore.get()).length === 2);

undo();
check('undo restores one clip', allClips(projectStore.get()).length === 1);

addTrack('audio');
check('audio track appends at the bottom', projectStore.get().tracks.at(-1)!.kind === 'audio');

/* node graph ------------------------------------------------------------ */

interpret('make this look like a damaged cyberpunk security recording').apply();
const graph = projectStore.get().graph;
check('planner built a chain', graph.nodes.length === 7);
check('planner wired every link', graph.edges.length === 6);

const passes = evaluate(projectStore.get(), 0);
check('evaluator emits passes in order', passes[0].pass === 'grade' && passes.at(-1)!.pass === 'timestamp');
check('source and output contribute no pass', passes.length === 5);

const output = graph.nodes.find((n) => n.type === 'output')!;
const source = graph.nodes.find((n) => n.type === 'source')!;
check(
  'cycles are rejected',
  !canConnect(graph.nodes, graph.edges, { node: output.id, port: 'out' }, { node: source.id, port: 'in' }),
);

/* animation ------------------------------------------------------------- */

interpret('create a smooth cinematic camera move').apply();
const transform = projectStore.get().graph.nodes.find((n) => n.type === 'transform')!;
const keys = transform.animations.scale;
check('camera move is keyframed', keys.length === 2);
check('curve holds before the first key', sample(keys, -1) === 1);
check('curve holds after the last key', Math.abs(sample(keys, 99) - 1.12) < 1e-6);
check('curve interpolates in between', sample(keys, keys[0].t + 2) > 1 && sample(keys, keys[0].t + 2) < 1.12);

transportStore.set({ ...transportStore.get(), time: 0 });
const animated = evaluate(projectStore.get(), keys[0].t + 2).find((p) => p.pass === 'transform');
check('evaluator resolves animated params', !!animated && Number(animated.params.scale) > 1);

/* cleanup --------------------------------------------------------------- */

deleteClips(allClips(projectStore.get()).map((c) => c.id));
check('delete clears the timeline', allClips(projectStore.get()).length === 0);

console.log(failures ? `\n${failures} check(s) failed` : '\nAll checks passed');
process.exit(failures ? 1 : 0);
