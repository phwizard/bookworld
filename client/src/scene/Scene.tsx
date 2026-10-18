import { Suspense, useMemo } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { setListenerPose } from '../audio/engine.ts';
import { Environment, KeyboardControls, PointerLockControls } from '@react-three/drei';
import { assetUrl } from '../assets.ts';
import { Physics } from '@react-three/rapier';
import type { Direction, WorldRoom } from '@bookworld/shared';
import { roomSize } from '@bookworld/shared';
import { useStore } from '../store.ts';
import { BoxRoom } from './BoxRoom.tsx';
import { PlayerController, type Controls } from './PlayerController.tsx';
import { CharacterAvatar, RemotePlayer } from './Avatar.tsx';
import { Props } from './Props.tsx';

const keyboardMap: { name: Controls; keys: string[] }[] = [
  { name: 'forward', keys: ['ArrowUp', 'KeyW'] },
  { name: 'backward', keys: ['ArrowDown', 'KeyS'] },
  { name: 'leftward', keys: ['ArrowLeft', 'KeyA'] },
  { name: 'rightward', keys: ['ArrowRight', 'KeyD'] },
  { name: 'run', keys: ['ShiftLeft', 'ShiftRight'] },
];

/**
 * One canvas for the whole visit. Only the room contents are keyed by room id, so walking through a door
 * keeps the WebGL context, the physics world, the canvas size and the pointer lock.
 */
export function Scene({ room, enterFrom }: { room: WorldRoom; enterFrom: Direction | null }) {
  const world = useStore((s) => s.session!.world);
  const [w, h, d] = roomSize(room);
  const ceiling = room.scene?.palette?.ceiling ?? '#2a2218';
  const panorama = room.scene?.template === 'panorama' ? assetUrl(room.scene.panorama) : null;
  return (
    <KeyboardControls map={keyboardMap}>
      <Canvas shadows camera={{ fov: 75, near: 0.05, far: 200, position: [0, 1.6, 0] }} dpr={[1, 1.5]}>
        {panorama ? (
          <Suspense fallback={<color attach="background" args={[ceiling]} />}>
            <Environment key={panorama} files={panorama} background environmentIntensity={0.6} />
          </Suspense>
        ) : (
          <>
            <color attach="background" args={[ceiling]} />
            <fog attach="fog" args={[ceiling, Math.max(w, d), Math.max(w, d) * 3]} />
          </>
        )}
        <ambientLight intensity={0.9} />
        <hemisphereLight args={['#fff4e0', '#3a2a1a', 0.8]} />
        <pointLight position={[0, h - 0.4, 0]} intensity={Math.max(w, d) * 5} distance={Math.max(w, d) * 1.5} decay={1.6} castShadow color="#ffe6c0" />
        <PointerLockControls
          makeDefault
          onLock={() => useStore.getState().setPointerLocked(true)}
          onUnlock={() => useStore.getState().setPointerLocked(false)}
        />
        <ListenerSync />
        <Suspense fallback={null}>
          <Physics gravity={[0, -9.81, 0]}>
            <group key={room.id}>
              <BoxRoom world={world} room={room} />
              <Props room={room} />
              <PlayerController room={room} enterFrom={enterFrom} />
            </group>
          </Physics>
          <Others />
          <Characters />
        </Suspense>
      </Canvas>
    </KeyboardControls>
  );
}

/** Keeps the audio listener on the camera so positional sounds come from the right side. */
function ListenerSync() {
  const forward = useMemo(() => new THREE.Vector3(), []);
  useFrame(({ camera }) => {
    camera.getWorldDirection(forward);
    setListenerPose(camera.position, forward, camera.up);
  });
  return null;
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
  const world = useStore((s) => s.session!.world);
  return (
    <>
      {Object.values(characters).map((c) => (
        <CharacterAvatar key={c.id} id={c.id} name={c.name} avatar={world.characters.find((wc) => wc.id === c.id)?.avatar} />
      ))}
    </>
  );
}
