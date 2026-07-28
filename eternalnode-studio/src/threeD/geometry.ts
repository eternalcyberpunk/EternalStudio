/**
 * threeD/geometry.ts
 * Geometry factory. Kept apart from scene.ts so the three.js runtime only
 * loads when the 3D workspace is opened.
 */

import * as THREE from 'three';
import type { PrimitiveKind } from '../core/types';

export function buildGeometry(kind: PrimitiveKind): THREE.BufferGeometry {
  switch (kind) {
    case 'sphere':
      return new THREE.SphereGeometry(0.7, 48, 32);
    case 'plane':
      return new THREE.PlaneGeometry(2, 2, 4, 4);
    case 'cylinder':
      return new THREE.CylinderGeometry(0.6, 0.6, 1.6, 48);
    case 'cone':
      return new THREE.ConeGeometry(0.7, 1.6, 48);
    case 'torus':
      return new THREE.TorusGeometry(0.6, 0.22, 24, 96);
    case 'text3d':
      // Extruded type needs a font loader; a slab stands in and is labelled
      // as planned in the UI so nothing pretends to work.
      return new THREE.BoxGeometry(1.8, 0.5, 0.2);
    case 'cube':
    default:
      return new THREE.BoxGeometry(1.2, 1.2, 1.2);
  }
}
