// Placeholder avatars (capsule + head) with a name label and a speech bubble. VRM avatars replace the mesh later.
import { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { Html } from '@react-three/drei';
import * as THREE from 'three';
import { poses, useStore } from '../store.ts';

const BUBBLE_MS = 8000;

export function colorFor(name: string, s = 55, l = 55): string {
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) % 360;
  return `hsl(${h} ${s}% ${l}%)`;
}

export function AvatarMesh({ name, color, isCharacter }: { name: string; color: string; isCharacter?: boolean }) {
  const bubble = useStore((s) => s.bubbles[name]);
  const show = bubble && Date.now() - bubble.at < BUBBLE_MS;
  return (
    <group>
      <mesh position={[0, 0.9, 0]} castShadow>
        <capsuleGeometry args={[0.28, 1.0, 4, 12]} />
        <meshStandardMaterial color={color} roughness={0.8} />
      </mesh>
      <mesh position={[0, 1.65, 0]} castShadow>
        <sphereGeometry args={[0.22, 16, 16]} />
        <meshStandardMaterial color={isCharacter ? '#e8d0b0' : '#d8c0a0'} roughness={0.9} />
      </mesh>
      {isCharacter && (
        <mesh position={[0, 1.95, 0]}>
          <cylinderGeometry args={[0.2, 0.22, 0.3, 16]} />
          <meshStandardMaterial color="#2a1a0a" />
        </mesh>
      )}
      <Html position={[0, 2.25, 0]} center zIndexRange={[10, 0]} style={{ pointerEvents: 'none' }}>
        <div className="label" style={{ transform: 'none' }}>{name}</div>
      </Html>
      {show && (
        <Html position={[0, 2.6, 0]} center zIndexRange={[20, 0]} style={{ pointerEvents: 'none' }}>
          <div className="bubble" style={{ transform: 'none' }}>{bubble.text}</div>
        </Html>
      )}
    </group>
  );
}

/** Another player; follows the server pose with a short lerp. */
export function RemotePlayer({ sessionId, name }: { sessionId: string; name: string }) {
  const group = useRef<THREE.Group>(null);
  const initial = poses.get(sessionId);
  useFrame((_, dt) => {
    const g = group.current;
    const target = poses.get(sessionId);
    if (!g || !target) return;
    const k = 1 - Math.exp(-dt * 12);
    g.position.x += (target.x - g.position.x) * k;
    g.position.y += (target.y - g.position.y) * k;
    g.position.z += (target.z - g.position.z) * k;
    let dy = target.ry - g.rotation.y;
    dy = Math.atan2(Math.sin(dy), Math.cos(dy));
    g.rotation.y += dy * k;
  });
  return (
    <group ref={group} position={[initial?.x ?? 0, initial?.y ?? 0, initial?.z ?? 0]} rotation-y={initial?.ry ?? 0}>
      <AvatarMesh name={name} color={colorFor(name)} />
    </group>
  );
}
