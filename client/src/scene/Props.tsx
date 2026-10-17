// Props from CC0 glTF kits, chosen by id from assets/props/catalog.json and placed by the world file.
import { Suspense, useMemo } from 'react';
import { useGLTF } from '@react-three/drei';
import { RigidBody } from '@react-three/rapier';
import * as THREE from 'three';
import type { Prop, WorldRoom } from '@bookworld/shared';
import catalogJson from '../../public/assets/props/catalog.json';

interface Catalog {
  kits: Record<string, { path: string; license: string; credit: string; scale: number }>;
  props: Record<string, { kit: string; file: string; tags: string[] }>;
}
const catalog = catalogJson as Catalog;

export function propUrl(id: string): { url: string; scale: number } | null {
  const p = catalog.props[id];
  if (!p) return null;
  const kit = catalog.kits[p.kit];
  if (!kit) return null;
  return { url: `/${kit.path}/${p.file}`, scale: kit.scale };
}

export function preloadProps(room: WorldRoom) {
  for (const p of room.scene?.props ?? []) {
    const r = propUrl(p.id);
    if (r) useGLTF.preload(r.url);
  }
}

export function Props({ room }: { room: WorldRoom }) {
  const props = room.scene?.props ?? [];
  return (
    <group>
      {props.map((p, i) => (
        <Suspense key={`${p.id}-${i}`} fallback={null}>
          <PropInstance prop={p} />
        </Suspense>
      ))}
    </group>
  );
}

function PropInstance({ prop }: { prop: Prop }) {
  const ref = propUrl(prop.id);
  if (!ref) {
    console.warn(`[props] unknown prop id ${prop.id}`);
    return null;
  }
  return <PropModel url={ref.url} scale={ref.scale * (prop.scale ?? 1)} prop={prop} />;
}

function PropModel({ url, scale, prop }: { url: string; scale: number; prop: Prop }) {
  const gltf = useGLTF(url);
  const object = useMemo(() => {
    const o = gltf.scene.clone(true);
    o.traverse((n) => {
      const m = n as THREE.Mesh;
      if (m.isMesh) { m.castShadow = true; m.receiveShadow = true; }
    });
    return o;
  }, [gltf.scene]);
  // Flat things (rugs) and tabletop items do not need to block the player.
  const solid = !prop.flat && !prop.onTop;
  const content = <primitive object={object} />;
  return (
    <group position={prop.pos} rotation-y={prop.rotY ?? 0} scale={scale}>
      {solid ? (
        <RigidBody type="fixed" colliders="cuboid">{content}</RigidBody>
      ) : (
        content
      )}
    </group>
  );
}
