/**
 * threeD/Viewport3D.tsx
 * Real-time 3D viewport. Reconciles three.js meshes against the project's
 * scene objects, so every change made here or in the Inspector shows up in both
 * places immediately.
 *
 * Functional: orbit / pan / dolly, grid and ground shadow, transform gizmos
 * (move, rotate, scale) writing back into the project, click-to-select,
 * primitive creation, shading modes, perspective/orthographic toggle.
 * Planned: mesh edit mode, HDRI environments, camera list, render preview.
 */

import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js';
import { beginTransaction, commitTransaction, useProject } from '../core/project';
import { projectStore } from '../core/project';
import type { PrimitiveKind } from '../core/types';
import { buildGeometry } from './geometry';
import { addPrimitive, deleteObjects, selectObjects, updateObject } from './scene';

type GizmoMode = 'translate' | 'rotate' | 'scale';
type Shading = 'material' | 'wireframe' | 'solid';

const PRIMITIVES: PrimitiveKind[] = ['cube', 'sphere', 'plane', 'cylinder', 'cone', 'torus', 'text3d'];

export function Viewport3D(): JSX.Element {
  const project = useProject();
  const mountRef = useRef<HTMLDivElement>(null);
  const [mode, setMode] = useState<GizmoMode>('translate');
  const [shading, setShading] = useState<Shading>('material');
  const [ortho, setOrtho] = useState(false);

  const refs = useRef<{
    renderer?: THREE.WebGLRenderer;
    scene?: THREE.Scene;
    camera?: THREE.PerspectiveCamera;
    orbit?: OrbitControls;
    gizmo?: TransformControls;
    meshes: Map<string, THREE.Mesh>;
  }>({ meshes: new Map() });

  /* ------------------------------------------------------------ bootstrap */

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    mount.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    scene.background = new THREE.Color('#0a0b0f');
    scene.fog = new THREE.Fog('#0a0b0f', 14, 42);

    const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 200);
    camera.position.set(5, 3.6, 6);

    const grid = new THREE.GridHelper(40, 40, 0x1d2a33, 0x131820);
    (grid.material as THREE.Material).transparent = true;
    (grid.material as THREE.Material).opacity = 0.75;
    scene.add(grid);

    const key = new THREE.DirectionalLight(0xc9f4ff, 2.1);
    key.position.set(5, 8, 4);
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    scene.add(key);

    const rim = new THREE.DirectionalLight(0xa855f7, 1.4);
    rim.position.set(-6, 3, -5);
    scene.add(rim);
    scene.add(new THREE.AmbientLight(0x2a3542, 1.2));

    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(80, 80),
      new THREE.ShadowMaterial({ opacity: 0.35 }),
    );
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    scene.add(ground);

    const orbit = new OrbitControls(camera, renderer.domElement);
    orbit.enableDamping = true;
    orbit.dampingFactor = 0.08;
    orbit.target.set(0, 0.8, 0);

    const gizmo = new TransformControls(camera, renderer.domElement);
    gizmo.addEventListener('dragging-changed', (e) => {
      orbit.enabled = !e.value;
      if (e.value) beginTransaction();
      else commitTransaction('Transform object');
    });
    gizmo.addEventListener('objectChange', () => {
      const obj = gizmo.object;
      if (!obj?.userData.id) return;
      updateObject(
        obj.userData.id,
        {
          position: obj.position.toArray() as [number, number, number],
          rotation: [obj.rotation.x, obj.rotation.y, obj.rotation.z],
          scale: obj.scale.toArray() as [number, number, number],
        },
        true,
      );
    });
    scene.add(gizmo as unknown as THREE.Object3D);

    refs.current = { renderer, scene, camera, orbit, gizmo, meshes: new Map() };

    const resize = () => {
      const { clientWidth: w, clientHeight: h } = mount;
      renderer.setSize(w, h, false);
      camera.aspect = w / Math.max(1, h);
      camera.updateProjectionMatrix();
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(mount);

    let raf = 0;
    const loop = () => {
      raf = requestAnimationFrame(loop);
      orbit.update();
      renderer.render(scene, camera);
    };
    loop();

    const pick = (e: PointerEvent) => {
      if (gizmo.dragging) return;
      const rect = renderer.domElement.getBoundingClientRect();
      const ndc = new THREE.Vector2(
        ((e.clientX - rect.left) / rect.width) * 2 - 1,
        -((e.clientY - rect.top) / rect.height) * 2 + 1,
      );
      const ray = new THREE.Raycaster();
      ray.setFromCamera(ndc, camera);
      const hits = ray.intersectObjects([...refs.current.meshes.values()], false);
      selectObjects(hits.length ? [hits[0].object.userData.id] : []);
    };
    renderer.domElement.addEventListener('pointerdown', pick);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      renderer.domElement.removeEventListener('pointerdown', pick);
      renderer.dispose();
      mount.removeChild(renderer.domElement);
    };
  }, []);

  /* ------------------------------------------------- reconcile scene state */

  useEffect(() => {
    const { scene, meshes, gizmo } = refs.current;
    if (!scene || !gizmo) return;
    const objects = project.scene.objects;
    const seen = new Set<string>();

    for (const o of objects) {
      seen.add(o.id);
      let mesh = meshes.get(o.id);
      if (!mesh) {
        mesh = new THREE.Mesh(
          buildGeometry(o.kind),
          new THREE.MeshStandardMaterial({ color: o.material.color }),
        );
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        mesh.userData.id = o.id;
        meshes.set(o.id, mesh);
        scene.add(mesh);
      }
      mesh.position.fromArray(o.position);
      mesh.rotation.set(o.rotation[0], o.rotation[1], o.rotation[2]);
      mesh.scale.fromArray(o.scale);
      mesh.visible = o.visible;
      const mat = mesh.material as THREE.MeshStandardMaterial;
      mat.color.set(o.material.color);
      mat.metalness = o.material.metallic;
      mat.roughness = o.material.roughness;
      mat.emissive.set(o.material.color);
      mat.emissiveIntensity = o.material.emissive;
      mat.wireframe = shading === 'wireframe';
      mat.flatShading = shading === 'solid';
      mat.needsUpdate = true;
    }

    for (const [id, mesh] of meshes) {
      if (seen.has(id)) continue;
      scene.remove(mesh);
      mesh.geometry.dispose();
      meshes.delete(id);
    }

    const selected = project.selection.objectIds[0];
    const target = selected ? meshes.get(selected) : undefined;
    if (target) gizmo.attach(target);
    else gizmo.detach();
  }, [project.scene.objects, project.selection.objectIds, shading]);

  useEffect(() => {
    refs.current.gizmo?.setMode(mode);
  }, [mode]);

  useEffect(() => {
    // Orthographic is emulated by narrowing the FOV, which keeps one camera
    // path. A true ortho camera swap lands with the multi-viewport layout.
    const cam = refs.current.camera;
    if (!cam) return;
    cam.fov = ortho ? 12 : 45;
    cam.position.setLength(ortho ? 26 : 9);
    cam.updateProjectionMatrix();
  }, [ortho]);

  const selectedCount = project.selection.objectIds.length;

  return (
    <div className="viewport3d">
      <div className="viewport3d__toolbar">
        <div className="toolgroup">
          {PRIMITIVES.map((p) => (
            <button key={p} className="chip" onClick={() => addPrimitive(p)} title={`Add ${p}`}>
              {p === 'text3d' ? 'Text*' : p}
            </button>
          ))}
        </div>
        <div className="toolgroup">
          {(['translate', 'rotate', 'scale'] as GizmoMode[]).map((m) => (
            <button
              key={m}
              className={`chip ${mode === m ? 'is-active' : ''}`}
              onClick={() => setMode(m)}
              title={`${m} (${m[0].toUpperCase()})`}
            >
              {m}
            </button>
          ))}
          <button
            className="chip"
            disabled={!selectedCount}
            onClick={() => deleteObjects(project.selection.objectIds)}
          >
            Delete
          </button>
        </div>
        <div className="toolgroup">
          {(['material', 'solid', 'wireframe'] as Shading[]).map((s) => (
            <button key={s} className={`chip ${shading === s ? 'is-active' : ''}`} onClick={() => setShading(s)}>
              {s}
            </button>
          ))}
          <button className={`chip ${ortho ? 'is-active' : ''}`} onClick={() => setOrtho((o) => !o)}>
            Ortho
          </button>
        </div>
      </div>

      <div ref={mountRef} className="viewport3d__canvas" />

      <footer className="viewport3d__status">
        <span>{project.scene.objects.length} objects</span>
        <span>{selectedCount ? `${selectedCount} selected` : 'Nothing selected'}</span>
        <span className="muted">Edit mode, modifiers and UV tools are planned — see README.</span>
      </footer>
    </div>
  );
}

/** Exposed so other modules can drop a model onto the timeline later. */
export function sceneObjectIds(): string[] {
  return projectStore.get().scene.objects.map((o) => o.id);
}
