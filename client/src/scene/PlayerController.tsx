// First-person local player: ecctrl capsule for movement and collision, pointer-lock mouse look,
// WASD + Shift from drei KeyboardControls, position stream to the server, door detection.
import { useEffect, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { PointerLockControls, useKeyboardControls } from '@react-three/drei';
import { Ecctrl, type EcctrlHandle } from 'ecctrl';
import * as THREE from 'three';
import { DIRECTIONS, DEFAULT_EXIT_WIDTH, entryPose, roomSize, roomSpawn, type Anim, type Direction, type WorldRoom } from '@bookworld/shared';
import { requestMove, sendPos } from '../net/colyseus.ts';
import { useStore } from '../store.ts';

export type Controls = 'forward' | 'backward' | 'leftward' | 'rightward' | 'run';

const CAPSULE_HALF = 0.5;
const CAPSULE_RADIUS = 0.3;
const FLOAT = 0.2;
const EYE_ABOVE_CENTER = 0.6;
const DOOR_MARGIN = 0.25;

export function PlayerController({ room, enterFrom }: { room: WorldRoom; enterFrom: Direction | null }) {
  const ecctrl = useRef<EcctrlHandle>(null);
  const camera = useThree((s) => s.camera);
  const [, getKeys] = useKeyboardControls<Controls>();
  const joinedAt = useRef(performance.now());
  const euler = useRef(new THREE.Euler(0, 0, 0, 'YXZ'));
  const start = enterFrom ? entryPose(room, enterFrom) : { ...xyz(roomSpawn(room)), rotY: 0 };
  const [w, , d] = roomSize(room);
  const exitWidth = room.scene?.exitWidth ?? DEFAULT_EXIT_WIDTH;

  useEffect(() => {
    camera.rotation.set(0, start.rotY, 0, 'YXZ');
    joinedAt.current = performance.now();
  }, [camera, start.rotY]);

  useFrame(() => {
    const h = ecctrl.current;
    if (!h) return;
    const chatOpen = useStore.getState().chatOpen;
    const keys = chatOpen ? null : getKeys();
    h.setMovement({
      forward: !!keys?.forward,
      backward: !!keys?.backward,
      leftward: !!keys?.leftward,
      rightward: !!keys?.rightward,
      run: !!keys?.run,
      jump: false,
    });

    const p = h.currPos;
    camera.position.set(p.x, p.y + EYE_ABOVE_CENTER, p.z);
    if (import.meta.env.DEV) (window as unknown as { __bw: unknown }).__bw = { x: p.x, y: p.y, z: p.z, keys, moving: h.isMoving, speed: h.moveSpeed, ground: h.isOnGround };
    euler.current.setFromQuaternion(camera.quaternion, 'YXZ');
    const moving = h.isMoving && h.moveSpeed > 0.3;
    const anim: Anim = !moving ? 'idle' : keys?.run ? 'run' : 'walk';
    sendPos({ x: p.x, y: p.y - (CAPSULE_HALF + CAPSULE_RADIUS + FLOAT), z: p.z, ry: euler.current.y, anim });

    // Door detection: standing inside a doorway on a wall that has an exit.
    if (performance.now() - joinedAt.current < 1500) return;
    let dir: Direction | null = null;
    if (p.z < -d / 2 + DOOR_MARGIN && Math.abs(p.x) < exitWidth / 2) dir = 'n';
    else if (p.z > d / 2 - DOOR_MARGIN && Math.abs(p.x) < exitWidth / 2) dir = 's';
    else if (p.x > w / 2 - DOOR_MARGIN && Math.abs(p.z) < exitWidth / 2) dir = 'e';
    else if (p.x < -w / 2 + DOOR_MARGIN && Math.abs(p.z) < exitWidth / 2) dir = 'w';
    if (dir && DIRECTIONS.includes(dir) && room.exits[dir]) requestMove(dir);
  });

  const bodyY = CAPSULE_HALF + CAPSULE_RADIUS + FLOAT + 0.05;
  return (
    <>
      <PointerLockControls
        makeDefault
        selector="#lock"
        onLock={() => useStore.getState().setPointerLocked(true)}
        onUnlock={() => useStore.getState().setPointerLocked(false)}
      />
      <Ecctrl
        ref={ecctrl}
        position={[start.x, bodyY, start.z]}
        capsuleHalfHeight={CAPSULE_HALF}
        capsuleRadius={CAPSULE_RADIUS}
        floatHeight={FLOAT}
        maxWalkVel={3}
        maxRunVel={6}
        enableToggleRun={false}
        groundDetection="rayCast"
        followPlatform={false}
        applyCounterMass={false}
        applyCounterMoveImp={false}
        applyCounterJumpImp={false}
        autoBalance={false}
        enabledRotations={[false, false, false]}
      >
        {/* no visible body in first person */}
        <group />
      </Ecctrl>
    </>
  );
}

function xyz(v: [number, number, number]) {
  return { x: v[0], y: v[1], z: v[2] };
}
