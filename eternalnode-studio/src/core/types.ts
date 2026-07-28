/**
 * core/types.ts
 * The single source of truth for the project document model.
 * Every subsystem (timeline, nodes, 3D, animation, export) reads and writes
 * these shapes, which is what keeps one project connected across workspaces.
 */

export type WorkspaceId = 'edit' | 'node' | 'model' | 'animate' | 'material' | 'ai';

/* ---------------------------------------------------------------- media --- */

export type MediaKind = 'video' | 'audio' | 'image';

export interface MediaAsset {
  id: string;
  name: string;
  kind: MediaKind;
  /** Object URL for local files. Rewritten on project reload via relink. */
  url: string;
  duration: number; // seconds
  width: number;
  height: number;
  thumbnail?: string; // data URL
  /** Set when a project is loaded but the underlying file is gone. */
  missing?: boolean;
}

/* ------------------------------------------------------------- timeline --- */

export type TrackKind = 'video' | 'audio' | 'image' | 'text' | 'object3d' | 'adjustment';

export interface Clip {
  id: string;
  trackId: string;
  name: string;
  assetId?: string;
  /** Timeline position, seconds. */
  start: number;
  /** Duration on the timeline after speed, seconds. */
  duration: number;
  /** Offset into the source media, seconds. */
  inPoint: number;
  speed: number;
  opacity: number;
  /** Node graph nodes owned by this clip (its effect chain). */
  effectNodeIds: string[];
  /** Text payload for text clips. */
  text?: string;
  color?: string;
}

export interface Track {
  id: string;
  kind: TrackKind;
  name: string;
  height: number;
  muted: boolean;
  locked: boolean;
  hidden: boolean;
  clips: Clip[];
}

export interface Marker {
  id: string;
  time: number;
  label: string;
  color: string;
}

/* ---------------------------------------------------------------- nodes --- */

export type PortType = 'video' | 'audio' | 'geometry' | 'anim' | 'ai' | 'value';

export interface GraphNode {
  id: string;
  type: string; // key into the node registry
  title: string;
  x: number;
  y: number;
  collapsed?: boolean;
  bypass?: boolean;
  params: Record<string, number | string | boolean>;
  /** param name -> keyframes. Presence means the param is animated. */
  animations: Record<string, Keyframe[]>;
  /** Optional grouping / comment colour label. */
  label?: string;
}

export interface GraphEdge {
  id: string;
  from: { node: string; port: string };
  to: { node: string; port: string };
}

/* ------------------------------------------------------------ animation --- */

export type EaseKind = 'linear' | 'hold' | 'easeIn' | 'easeOut' | 'easeInOut' | 'spring';

export interface Keyframe {
  t: number; // seconds
  v: number;
  ease: EaseKind;
}

/* ------------------------------------------------------------------- 3D --- */

export type PrimitiveKind =
  | 'cube'
  | 'sphere'
  | 'plane'
  | 'cylinder'
  | 'cone'
  | 'torus'
  | 'text3d';

export interface SceneObject {
  id: string;
  kind: PrimitiveKind;
  name: string;
  position: [number, number, number];
  rotation: [number, number, number];
  scale: [number, number, number];
  material: {
    color: string;
    metallic: number;
    roughness: number;
    emissive: number;
  };
  visible: boolean;
}

/* -------------------------------------------------------------- project --- */

export interface ProjectMeta {
  id: string;
  name: string;
  fps: number;
  width: number;
  height: number;
  duration: number; // sequence length, seconds
  createdAt: number;
  modifiedAt: number;
  /** Bumped on every breaking change to the .eternal format. */
  formatVersion: number;
}

export interface Selection {
  clipIds: string[];
  nodeIds: string[];
  objectIds: string[];
}

export interface ProjectState {
  meta: ProjectMeta;
  media: MediaAsset[];
  tracks: Track[];
  markers: Marker[];
  graph: { nodes: GraphNode[]; edges: GraphEdge[] };
  scene: { objects: SceneObject[] };
  selection: Selection;
  workspace: WorkspaceId;
  /** Non-persisted UI flags live here so panels stay dumb. */
  ui: {
    pixelsPerSecond: number;
    snapping: boolean;
    exportOpen: boolean;
    commandOpen: boolean;
    graphEditorOpen: boolean;
    statusMessage: string;
  };
}
