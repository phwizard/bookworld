// The default room template: floor, four walls, a doorway in every wall that has an exit, wallpaper per room.
import { useMemo } from 'react';
import { CuboidCollider, RigidBody } from '@react-three/rapier';
import { Text } from '@react-three/drei';
import * as THREE from 'three';
import {
  DIRECTIONS, DEFAULT_EXIT_WIDTH, DOOR_HEIGHT, WALL_THICKNESS, doorPose, roomById, roomSize,
  type Direction, type World, type WorldRoom,
} from '@bookworld/shared';
import { floorTexture, wallpaperTexture } from './textures.ts';

const DEFAULT_PALETTE = { wall: '#6b5a3e', floor: '#3a2f22', ceiling: '#2a2218', trim: '#c9a961' };

export function BoxRoom({ world, room }: { world: World; room: WorldRoom }) {
  const [w, h, d] = roomSize(room);
  const palette = { ...DEFAULT_PALETTE, ...(room.scene?.palette ?? {}) };
  const exitWidth = room.scene?.exitWidth ?? DEFAULT_EXIT_WIDTH;
  const wallTex = useMemo(() => wallpaperTexture(palette.wall, palette.trim, [Math.max(1, w / 3), Math.max(1, h / 3)]), [palette.wall, palette.trim, w, h]);
  const floorTex = useMemo(() => floorTexture(palette.floor, [w / 2, d / 2]), [palette.floor, w, d]);

  return (
    <group>
      {/* floor + ceiling */}
      <RigidBody type="fixed" colliders={false}>
        <mesh rotation-x={-Math.PI / 2} receiveShadow>
          <planeGeometry args={[w, d]} />
          <meshStandardMaterial map={floorTex} roughness={0.95} />
        </mesh>
        <CuboidCollider args={[w / 2 + 3, 0.1, d / 2 + 3]} position={[0, -0.1, 0]} />
      </RigidBody>
      <mesh position={[0, h, 0]} rotation-x={Math.PI / 2}>
        <planeGeometry args={[w, d]} />
        <meshStandardMaterial color={palette.ceiling} roughness={1} />
      </mesh>

      {DIRECTIONS.map((dir) => (
        <Wall key={dir} dir={dir} w={w} h={h} d={d} exitWidth={exitWidth} target={room.exits[dir] ? roomById(world, room.exits[dir]!) ?? null : null} wallTex={wallTex} trim={palette.trim} />
      ))}
    </group>
  );
}

interface WallProps { dir: Direction; w: number; h: number; d: number; exitWidth: number; target: WorldRoom | null; wallTex: THREE.Texture; trim: string }

/** One wall, split around the doorway when there is an exit. Built in a local frame then rotated into place. */
function Wall({ dir, w, h, d, exitWidth, target, wallTex, trim }: WallProps) {
  const length = dir === 'n' || dir === 's' ? w : d;
  const pose = doorPose({ id: '', name: '', description: '', exits: { n: null, e: null, s: null, w: null }, scene: { template: 'box', size: [w, h, d] } }, dir);
  // Local frame: the wall runs along local x, its inner face looks along local +z. Rotate so +z points into the room.
  const rotY = { n: 0, s: Math.PI, e: -Math.PI / 2, w: Math.PI / 2 }[dir];
  const t = WALL_THICKNESS;
  const segments: { x: number; width: number; height: number; y: number }[] = [];
  if (target) {
    const side = (length - exitWidth) / 2;
    segments.push({ x: -(exitWidth / 2 + side / 2), width: side, height: h, y: h / 2 });
    segments.push({ x: exitWidth / 2 + side / 2, width: side, height: h, y: h / 2 });
    segments.push({ x: 0, width: exitWidth, height: h - DOOR_HEIGHT, y: DOOR_HEIGHT + (h - DOOR_HEIGHT) / 2 }); // lintel
  } else {
    segments.push({ x: 0, width: length, height: h, y: h / 2 });
  }
  return (
    <group position={[pose.x, 0, pose.z]} rotation-y={rotY}>
      <RigidBody type="fixed" colliders={false}>
        {segments.map((s, i) => (
          <group key={i}>
            <mesh position={[s.x, s.y, -t / 2]} castShadow receiveShadow>
              <boxGeometry args={[s.width, s.height, t]} />
              <meshStandardMaterial map={wallTex} roughness={0.9} />
            </mesh>
            <CuboidCollider args={[s.width / 2, s.height / 2, t / 2]} position={[s.x, s.y, -t / 2]} />
          </group>
        ))}
      </RigidBody>
      {target && (
        <group>
          {/* door frame */}
          {[-1, 1].map((side) => (
            <mesh key={side} position={[side * (exitWidth / 2 + 0.06), DOOR_HEIGHT / 2, -t / 2]}>
              <boxGeometry args={[0.12, DOOR_HEIGHT, t + 0.05]} />
              <meshStandardMaterial color={trim} />
            </mesh>
          ))}
          <mesh position={[0, DOOR_HEIGHT + 0.06, -t / 2]}>
            <boxGeometry args={[exitWidth + 0.24, 0.12, t + 0.05]} />
            <meshStandardMaterial color={trim} />
          </mesh>
          {/* darkness beyond the door and a doorstep so nobody falls */}
          <mesh position={[0, DOOR_HEIGHT / 2, -t - 1.5]}>
            <boxGeometry args={[exitWidth + 0.4, DOOR_HEIGHT + 0.4, 3]} />
            <meshStandardMaterial color="#050403" />
          </mesh>
          <Text position={[0, DOOR_HEIGHT + 0.45, 0.02]} fontSize={0.22} color={trim} anchorX="center" anchorY="bottom" maxWidth={exitWidth + 2}>
            {target.name}
          </Text>
        </group>
      )}
    </group>
  );
}
