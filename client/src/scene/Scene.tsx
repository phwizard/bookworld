import { Suspense } from 'react';
import { Canvas } from '@react-three/fiber';
import { KeyboardControls } from '@react-three/drei';
import { Physics } from '@react-three/rapier';
import type { Direction, WorldRoom } from '@bookworld/shared';
import { roomSize } from '@bookworld/shared';
import { useStore } from '../store.ts';
import { BoxRoom } from './BoxRoom.tsx';
import { PlayerController, type Controls } from './PlayerController.tsx';
import { AvatarMesh, RemotePlayer, colorFor } from './Avatar.tsx';

const keyboardMap: { name: Controls; keys: string[] }[] = [
  { name: 'forward', keys: ['ArrowUp', 'KeyW'] },
  { name: 'backward', keys: ['ArrowDown', 'KeyS'] },
  { name: 'leftward', keys: ['ArrowLeft', 'KeyA'] },
  { name: 'rightward', keys: ['ArrowRight', 'KeyD'] },
  { name: 'run', keys: ['ShiftLeft', 'ShiftRight'] },
];

export function Scene({ room, enterFrom }: { room: WorldRoom; enterFrom: Direction | null }) {
  const world = useStore((s) => s.session!.world);
  const [w, h, d] = roomSize(room);
  const ceiling = room.scene?.palette?.ceiling ?? '#2a2218';
  return (
    <KeyboardControls map={keyboardMap}>
      <Canvas shadows camera={{ fov: 75, near: 0.05, far: 200, position: [0, 1.6, 0] }} dpr={[1, 1.5]}>
        <color attach="background" args={[ceiling]} />
        <fog attach="fog" args={[ceiling, Math.max(w, d), Math.max(w, d) * 3]} />
        <ambientLight intensity={0.9} />
        <hemisphereLight args={['#fff4e0', '#3a2a1a', 0.8]} />
        <pointLight position={[0, h - 0.4, 0]} intensity={Math.max(w, d) * 5} distance={Math.max(w, d) * 1.5} decay={1.6} castShadow color="#ffe6c0" />
        <Suspense fallback={null}>
          <Physics gravity={[0, -9.81, 0]}>
            <BoxRoom world={world} room={room} />
            <PlayerController room={room} enterFrom={enterFrom} />
          </Physics>
          <Others />
          <Characters />
        </Suspense>
      </Canvas>
    </KeyboardControls>
  );
}

function Others() {
  const players = useStore((s) => s.players);
  const me = useStore((s) => s.mySessionId);
  return (
    <>
      {Object.entries(players)
        .filter(([sid]) => sid !== me)
        .map(([sid, p]) => <RemotePlayer key={sid} sessionId={sid} name={p.name} />)}
    </>
  );
}

function Characters() {
  const characters = useStore((s) => s.characters);
  return (
    <>
      {Object.values(characters).map((c) => (
        <group key={c.id} position={[c.x, c.y, c.z]} rotation-y={c.ry}>
          <AvatarMesh name={c.name} color={colorFor(c.name, 45, 35)} isCharacter />
        </group>
      ))}
    </>
  );
}
