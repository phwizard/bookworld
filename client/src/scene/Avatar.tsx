// Placeholder avatars (capsule + head) with a name label and a speech bubble. VRM avatars replace the mesh later.
import { Suspense, useEffect, useRef, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import { Html } from '@react-three/drei';
import * as THREE from 'three';
import { poses, useStore } from '../store.ts';
import { CharacterModel, avatarFile } from './CharacterModel.tsx';
import type { Anim } from '@bookworld/shared';

const BUBBLE_MS = 8000;

export function colorFor(name: string, s = 55, l = 55): string {
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) % 360;
  return `hsl(${h} ${s}% ${l}%)`;
}

/** The latest bubble for a speaker, or null once it has expired (re-renders itself when it does). */
export function useBubble(name: string) {
  const bubble = useStore((s) => s.bubbles[name]);
  const [, tick] = useState(0);
  useEffect(() => {
    if (!bubble) return;
    const left = BUBBLE_MS - (Date.now() - bubble.at);
    if (left <= 0) return;
    const t = setTimeout(() => tick((n) => n + 1), left + 50);
    return () => clearTimeout(t);
  }, [bubble]);
  return bubble && Date.now() - bubble.at < BUBBLE_MS ? bubble : null;
}

/** Name label and speech bubble above a head at `height` metres. */
export function AvatarLabels({ name, height = 1.9 }: { name: string; height?: number }) {
  const bubble = useBubble(name);
  return (
    <group>
      <Html position={[0, height + 0.3, 0]} center zIndexRange={[10, 0]} style={{ pointerEvents: 'none' }}>
        <div className="label" style={{ transform: 'none' }}>{name}</div>
      </Html>
      {bubble && (
        <Html position={[0, height + 0.65, 0]} center zIndexRange={[20, 0]} style={{ pointerEvents: 'none' }}>
          <div className="bubble" style={{ transform: 'none' }}>{bubble.text}</div>
        </Html>
      )}
    </group>
  );
}

/** Placeholder body (used when a model is still loading or no model applies). */
export function AvatarMesh({ name, color, isCharacter }: { name: string; color: string; isCharacter?: boolean }) {
  const bubble = useBubble(name);
  const show = !!bubble;
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

/** Another player; follows the server pose with a short lerp and plays the animation the server reports. */
export function RemotePlayer({ sessionId, name }: { sessionId: string; name: string }) {
  const group = useRef<THREE.Group>(null);
  const initial = poses.get(sessionId);
  const [anim, setAnim] = useState<Anim>('idle');
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
    const a = (target.anim === 'walk' || target.anim === 'run' ? target.anim : 'idle') as Anim;
    if (a !== anim) setAnim(a);
  });
  return (
    <group ref={group} position={[initial?.x ?? 0, initial?.y ?? 0, initial?.z ?? 0]} rotation-y={initial?.ry ?? 0}>
      <Suspense fallback={<AvatarMesh name={name} color={colorFor(name)} />}>
        <CharacterModel file={avatarFile(null, name)} anim={anim} />
        <AvatarLabels name={name} />
      </Suspense>
    </group>
  );
}

/** A book character; the server moves it (wander, turning to face a speaker, walking out of the room). */
export function CharacterAvatar({ id, name, avatar }: { id: string; name: string; avatar?: string | null }) {
  const key = `c:${id}`;
  const group = useRef<THREE.Group>(null);
  const initial = poses.get(key);
  const [anim, setAnim] = useState<Anim>('idle');
  useFrame((_, dt) => {
    const g = group.current;
    const target = poses.get(key);
    if (!g || !target) return;
    const k = 1 - Math.exp(-dt * 10);
    g.position.x += (target.x - g.position.x) * k;
    g.position.y += (target.y - g.position.y) * k;
    g.position.z += (target.z - g.position.z) * k;
    let dy = target.ry - g.rotation.y;
    dy = Math.atan2(Math.sin(dy), Math.cos(dy));
    g.rotation.y += dy * k;
    const a = (target.anim === 'walk' || target.anim === 'run' ? target.anim : 'idle') as Anim;
    if (a !== anim) setAnim(a);
  });
  return (
    <group ref={group} position={[initial?.x ?? 0, initial?.y ?? 0, initial?.z ?? 0]} rotation-y={initial?.ry ?? 0}>
      <Suspense fallback={<AvatarMesh name={name} color={colorFor(name, 45, 35)} isCharacter />}>
        <CharacterModel file={avatarFile(avatar, id)} anim={anim} />
        <AvatarLabels name={name} />
      </Suspense>
    </group>
  );
}
