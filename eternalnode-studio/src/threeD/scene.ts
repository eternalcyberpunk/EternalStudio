/**
 * threeD/scene.ts
 * The 3D scene document and the geometry factory.
 *
 * Scene objects live in the same project document as clips and nodes, which is
 * what lets a model be created here and referenced from a timeline track
 * without an export step.
 *
 * Functional: primitive creation, transform mutation, material values, delete,
 * duplicate, selection shared with the Inspector.
 * Planned: edit mode (vertex/edge/face), modifiers, boolean ops, UV editing,
 * sculpting, armatures — these need a half-edge mesh layer, which is the next
 * milestone for this module.
 */

import { edit, projectStore } from '../core/project';
import type { PrimitiveKind, SceneObject } from '../core/types';
import { uid } from '../core/utils';

export function addPrimitive(kind: PrimitiveKind): string {
  const id = uid('obj');
  edit('Add 3D object', (s) => {
    const count = s.scene.objects.filter((o) => o.kind === kind).length + 1;
    const obj: SceneObject = {
      id,
      kind,
      name: `${kind[0].toUpperCase()}${kind.slice(1)} ${count}`,
      position: [0, kind === 'plane' ? 0 : 0.8, 0],
      rotation: [kind === 'plane' ? -Math.PI / 2 : 0, 0, 0],
      scale: [1, 1, 1],
      material: { color: '#8fd8ff', metallic: 0.2, roughness: 0.35, emissive: 0 },
      visible: true,
    };
    return {
      ...s,
      scene: { objects: [...s.scene.objects, obj] },
      selection: { ...s.selection, objectIds: [id] },
    };
  });
  return id;
}

export function updateObject(id: string, patch: Partial<SceneObject>, transient = false): void {
  edit(
    'Transform object',
    (s) => ({
      ...s,
      scene: { objects: s.scene.objects.map((o) => (o.id === id ? { ...o, ...patch } : o)) },
    }),
    { transient },
  );
}

export function updateMaterial(id: string, patch: Partial<SceneObject['material']>): void {
  edit('Edit material', (s) => ({
    ...s,
    scene: {
      objects: s.scene.objects.map((o) => (o.id === id ? { ...o, material: { ...o.material, ...patch } } : o)),
    },
  }));
}

export function deleteObjects(ids: string[]): void {
  edit('Delete 3D object', (s) => ({
    ...s,
    scene: { objects: s.scene.objects.filter((o) => !ids.includes(o.id)) },
    selection: { ...s.selection, objectIds: [] },
  }));
}

export function duplicateObject(id: string): void {
  edit('Duplicate object', (s) => {
    const src = s.scene.objects.find((o) => o.id === id);
    if (!src) return s;
    const copy: SceneObject = {
      ...src,
      id: uid('obj'),
      name: `${src.name} copy`,
      position: [src.position[0] + 1.4, src.position[1], src.position[2]],
    };
    return { ...s, scene: { objects: [...s.scene.objects, copy] }, selection: { ...s.selection, objectIds: [copy.id] } };
  });
}

export function selectObjects(ids: string[]): void {
  const s = projectStore.get();
  projectStore.set({ ...s, selection: { ...s.selection, objectIds: ids } });
}
