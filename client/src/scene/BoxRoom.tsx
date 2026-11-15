// The default room template: floor, four walls, a doorway in every wall that has an exit, wallpaper per room.
import { Suspense, useMemo } from 'react';
import { CuboidCollider, RigidBody } from '@react-three/rapier';
import { Text, useTexture } from '@react-three/drei';
import * as THREE from 'three';
import {
  DIRECTIONS, DEFAULT_EXIT_WIDTH, DOOR_HEIGHT, WALL_THICKNESS, doorPose, roomById, roomSize,
  type Decor, type Direction, type World, type WorldRoom,
} from '@bookworld/shared';
import { floorPattern, patternName, repeated, wallPattern, type PatternTexture } from './textures.ts';
import { assetUrl } from '../assets.ts';
import { WallDecor } from './Decor.tsx';

const DEFAULT_PALETTE = { wall: '#6b5a3e', floor: '#3a2f22', ceiling: '#2a2218', trim: '#c9a961' };

/** metres one tile of an image texture covers */
const IMAGE_TILE = 3;
/** wall patterns that take a dado rail (papered and plastered rooms; not hedges or bare brick) */
const RAILED = new Set(['plaster', 'damask', 'stripes', 'velvet']);

interface SurfaceSource { url: string | null; pattern: PatternTexture }

/** Image texture from the world file, tiled; suspends while loading. */
function ImageMaterial({ url, repeat, offset, roughness }: { url: string; repeat: [number, number]; offset: [number, number]; roughness: number }) {
  const tex = useTexture(url);
  const prepared = useMemo(() => repeated(tex, repeat[0], repeat[1], offset[0], offset[1]), [tex, repeat[0], repeat[1], offset[0], offset[1]]);
  return <meshStandardMaterial map={prepared} roughness={roughness} />;
}

/**
 * The material of one piece (a wall segment, the floor), `width` by `height` metres, starting `startX`, `startY`
 * metres into the surface so the pattern runs unbroken across the pieces of a wall with a door in it.
 */
function Surface({ source, width, height, startX = 0, startY = 0, roughness }: { source: SurfaceSource; width: number; height: number; startX?: number; startY?: number; roughness: number }) {
  const tile = source.pattern.tile;
  const drawn = useMemo(
    () => repeated(source.pattern.texture, width / tile, height / tile, startX / tile, startY / tile),
    [source.pattern, width, height, startX, startY, tile],
  );
  const plain = source.pattern.relief
    ? <meshStandardMaterial map={drawn} bumpMap={drawn} bumpScale={source.pattern.relief} roughness={roughness} />
    : <meshStandardMaterial map={drawn} roughness={roughness} />;
  if (!source.url) return plain;
  return (
    <Suspense fallback={plain}>
      <ImageMaterial url={source.url} repeat={[width / IMAGE_TILE, height / IMAGE_TILE]} offset={[startX / IMAGE_TILE, startY / IMAGE_TILE]} roughness={roughness} />
    </Suspense>
  );
}

export function BoxRoom({ world, room }: { world: World; room: WorldRoom }) {
  const [w, h, d] = roomSize(room);
  const palette = { ...DEFAULT_PALETTE, ...(room.scene?.palette ?? {}) };
  const exitWidth = room.scene?.exitWidth ?? DEFAULT_EXIT_WIDTH;
  const open = room.scene?.template === 'panorama';
  const wallName = patternName(room.wallpaper);
  const floorName = patternName(room.floor) ?? (open && !room.floor ? 'grass' : null);
  const wall: SurfaceSource = useMemo(
    () => ({ url: wallName ? null : assetUrl(room.wallpaper), pattern: wallPattern(wallName, palette.wall, palette.trim) }),
    [wallName, room.wallpaper, palette.wall, palette.trim],
  );
  const floor: SurfaceSource = useMemo(
    () => ({ url: floorName ? null : assetUrl(room.floor), pattern: floorPattern(floorName, palette.floor, palette.trim) }),
    [floorName, room.floor, palette.floor, palette.trim],
  );
  const railed = !wall.url && RAILED.has(wallName ?? 'plaster');
  // a hedge has no joinery
  const joinery = wallName !== 'foliage' && !/leaves|hedge|foliage/.test(room.wallpaper ?? '');
  const fw = open ? w * 3 : w, fd = open ? d * 3 : d;

  return (
    <group>
      {/* floor (+ ceiling for closed rooms) */}
      <RigidBody type="fixed" colliders={false}>
        <mesh rotation-x={-Math.PI / 2} receiveShadow>
          <planeGeometry args={[fw, fd]} />
          <Surface source={floor} width={fw} height={fd} roughness={floorName === 'checker' || floorName === 'parquet' ? 0.55 : 0.95} />
        </mesh>
        <CuboidCollider args={[w / 2 + 3, 0.1, d / 2 + 3]} position={[0, -0.1, 0]} />
      </RigidBody>
      {!open && (
        <mesh position={[0, h, 0]} rotation-x={Math.PI / 2}>
          <planeGeometry args={[w, d]} />
          <meshStandardMaterial color={palette.ceiling} roughness={1} />
        </mesh>
      )}

      {DIRECTIONS.map((dir) => (
        <Wall key={dir} dir={dir} w={w} h={h} d={d} exitWidth={exitWidth} open={open} target={room.exits[dir] ? roomById(world, room.exits[dir]!) ?? null : null} wall={wall} trim={palette.trim} ceiling={palette.ceiling} railed={railed} joinery={joinery} decor={(room.scene?.decor ?? []).filter((x) => x.wall === dir)} seed={`${world.slug}|${room.id}|${dir}`} />
      ))}
    </group>
  );
}

interface WallProps { dir: Direction; w: number; h: number; d: number; exitWidth: number; target: WorldRoom | null; wall: SurfaceSource; trim: string; ceiling: string; railed: boolean; joinery: boolean; decor: Decor[]; seed: string; open: boolean }

/** One wall, split around the doorway when there is an exit. Built in a local frame then rotated into place. */
function Wall({ dir, w, h, d, exitWidth, target, wall, trim, ceiling, railed, joinery, decor, seed, open }: WallProps) {
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
            {/* open (panorama) rooms keep the invisible boundary but show no walls */}
            {!open && (
              <mesh position={[s.x, s.y, -t / 2]} castShadow receiveShadow>
                <boxGeometry args={[s.width, s.height, t]} />
                <Surface source={wall} width={s.width} height={s.height} startX={s.x - s.width / 2 + length / 2} startY={s.y - s.height / 2} roughness={0.9} />
              </mesh>
            )}
            {/* the joinery: a cornice on every piece, a skirting board (and a dado rail in papered rooms) where the wall reaches the floor */}
            {!open && joinery && (
              <mesh position={[s.x, h - 0.07, 0.035]}>
                <boxGeometry args={[s.width, 0.14, 0.07]} />
                <meshStandardMaterial color={ceiling} roughness={0.8} />
              </mesh>
            )}
            {!open && joinery && s.height === h && (
              <mesh position={[s.x, 0.09, 0.02]}>
                <boxGeometry args={[s.width, 0.18, 0.04]} />
                <meshStandardMaterial color={trim} roughness={0.6} />
              </mesh>
            )}
            {!open && railed && s.height === h && (
              <mesh position={[s.x, 0.98, 0.0175]}>
                <boxGeometry args={[s.width, 0.06, 0.035]} />
                <meshStandardMaterial color={trim} roughness={0.6} />
              </mesh>
            )}
            <CuboidCollider args={[s.width / 2, s.height / 2, t / 2]} position={[s.x, s.y, -t / 2]} />
          </group>
        ))}
      </RigidBody>
      {!open && decor.map((item, i) => <WallDecor key={i} item={item} seed={`${seed}|${i}`} trim={trim} wallHeight={h} />)}
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
          {!open && (
            <mesh position={[0, DOOR_HEIGHT / 2, -t - 1.5]}>
              <boxGeometry args={[exitWidth + 0.4, DOOR_HEIGHT + 0.4, 3]} />
              <meshStandardMaterial color="#050403" />
            </mesh>
          )}
          <Text position={[0, DOOR_HEIGHT + 0.45, 0.02]} fontSize={0.22} color={trim} anchorX="center" anchorY="bottom" maxWidth={exitWidth + 2}>
            {target.name}
          </Text>
        </group>
      )}
    </group>
  );
}
