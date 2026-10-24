// Instruments lying in the room (simple shapes, no model files) with a label, and the pick-up prompt when the
// player is within reach. A carried instrument is drawn by the player's avatar instead (see InstrumentInHand).
import { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { Html } from '@react-three/drei';
import * as THREE from 'three';
import type { Instrument, ItemView } from '@bookworld/shared';
import { useStore } from '../store.ts';
import { myPose } from './PlayerController.tsx';

/** metres within which E picks an item up (the server checks the same) */
const REACH = 2.0;

export function Items() {
  const items = useStore((s) => s.items);
  const onFloor = Object.values(items).filter((it) => !it.heldBy);
  return (
    <group>
      <NearestWatcher items={onFloor} />
      {onFloor.map((it) => <FloorItem key={it.id} item={it} />)}
    </group>
  );
}

/** Finds the one item in reach each frame and puts its id in the store (only when it changes). */
function NearestWatcher({ items }: { items: ItemView[] }) {
  useFrame(() => {
    let best: string | null = null;
    let bestD = REACH;
    for (const it of items) {
      const d = Math.hypot(it.x - myPose.x, it.z - myPose.z);
      if (d < bestD) { bestD = d; best = it.id; }
    }
    useStore.getState().setNearItem(best);
  });
  return null;
}

function FloorItem({ item }: { item: ItemView }) {
  const near = useStore((s) => s.nearItem === item.id);
  const group = useRef<THREE.Group>(null);
  useFrame(({ clock }) => {
    // a slow bob and turn so the eye finds it
    const g = group.current;
    if (!g) return;
    g.position.y = item.y + 0.12 + Math.sin(clock.elapsedTime * 1.6) * 0.04;
    g.rotation.y = clock.elapsedTime * 0.35;
  });
  return (
    <group position={[item.x, item.y, item.z]}>
      <group ref={group}>
        <InstrumentMesh instrument={item.instrument} />
      </group>
      <Html position={[0, 1.25, 0]} center zIndexRange={[10, 0]} style={{ pointerEvents: 'none' }}>
        <div className={near ? 'item-label near' : 'item-label'} style={{ transform: 'none' }}>
          {item.name}{near ? ' (E to pick up)' : ''}
        </div>
      </Html>
    </group>
  );
}

const WOOD = '#8a5a2b';
const DARK = '#2a1a0a';
const METAL = '#c9c0a8';

/** Stylised instruments from primitives, about the right size, resting on the floor at the group's origin. */
export function InstrumentMesh({ instrument, scale = 1 }: { instrument: Instrument; scale?: number }) {
  switch (instrument) {
    case 'guitar':
      return (
        <group scale={scale} rotation={[0, 0, 0.35]}>
          <mesh position={[0, 0.3, 0]} castShadow>
            <cylinderGeometry args={[0.22, 0.26, 0.09, 24]} />
            <meshStandardMaterial color={WOOD} roughness={0.6} />
          </mesh>
          <mesh position={[0, 0.3, 0.046]} rotation={[Math.PI / 2, 0, 0]}>
            <circleGeometry args={[0.06, 16]} />
            <meshStandardMaterial color={DARK} />
          </mesh>
          <mesh position={[0, 0.78, 0]} castShadow>
            <boxGeometry args={[0.07, 0.75, 0.04]} />
            <meshStandardMaterial color={DARK} roughness={0.5} />
          </mesh>
        </group>
      );
    case 'bass':
      return (
        <group scale={scale} rotation={[0, 0, 0.35]}>
          <mesh position={[0, 0.28, 0]} castShadow>
            <boxGeometry args={[0.36, 0.44, 0.08]} />
            <meshStandardMaterial color="#5a2a1a" roughness={0.5} />
          </mesh>
          <mesh position={[0, 0.9, 0]} castShadow>
            <boxGeometry args={[0.06, 0.95, 0.04]} />
            <meshStandardMaterial color={DARK} roughness={0.5} />
          </mesh>
        </group>
      );
    case 'drums':
      return (
        <group scale={scale}>
          <mesh position={[0, 0.3, 0]} castShadow>
            <cylinderGeometry args={[0.3, 0.3, 0.45, 24]} />
            <meshStandardMaterial color="#9a2a2a" roughness={0.5} />
          </mesh>
          <mesh position={[0, 0.53, 0]}>
            <cylinderGeometry args={[0.31, 0.31, 0.02, 24]} />
            <meshStandardMaterial color="#f0e8d8" roughness={0.9} />
          </mesh>
          <mesh position={[0.38, 0.72, 0]} rotation={[0.15, 0, 0]}>
            <cylinderGeometry args={[0.2, 0.2, 0.015, 24]} />
            <meshStandardMaterial color={METAL} metalness={0.6} roughness={0.3} />
          </mesh>
          <mesh position={[0.38, 0.36, 0]}>
            <cylinderGeometry args={[0.015, 0.015, 0.72, 8]} />
            <meshStandardMaterial color={METAL} metalness={0.6} roughness={0.3} />
          </mesh>
        </group>
      );
    case 'piano':
      return (
        <group scale={scale}>
          <mesh position={[0, 0.5, 0]} castShadow>
            <boxGeometry args={[0.9, 0.12, 0.3]} />
            <meshStandardMaterial color={DARK} roughness={0.4} />
          </mesh>
          <mesh position={[0, 0.57, 0.02]}>
            <boxGeometry args={[0.84, 0.03, 0.22]} />
            <meshStandardMaterial color="#f4efe2" roughness={0.6} />
          </mesh>
          {[-0.3, -0.18, 0.02, 0.14, 0.26].map((x) => (
            <mesh key={x} position={[x, 0.6, -0.04]}>
              <boxGeometry args={[0.05, 0.03, 0.12]} />
              <meshStandardMaterial color="#111" />
            </mesh>
          ))}
          {[-0.4, 0.4].map((x) => (
            <mesh key={x} position={[x, 0.22, 0]}>
              <boxGeometry args={[0.05, 0.44, 0.26]} />
              <meshStandardMaterial color={DARK} roughness={0.4} />
            </mesh>
          ))}
        </group>
      );
  }
}

/** The instrument a player carries, hung at their side. */
export function InstrumentInHand({ instrument }: { instrument: Instrument }) {
  return (
    <group position={[0.38, 0.55, 0.12]} rotation={[0, -0.6, 0]}>
      <InstrumentMesh instrument={instrument} scale={0.6} />
    </group>
  );
}
