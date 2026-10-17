// Animated characters from the CC0 KayKit Adventurers pack (idle, walk, run clips embedded in each glb).
// `avatar` in the world file: "kaykit:<File>" picks a model; players get one by name hash.
import { useEffect, useMemo } from 'react';
import { useAnimations, useGLTF } from '@react-three/drei';
import { clone as cloneSkeleton } from 'three/examples/jsm/utils/SkeletonUtils.js';
import * as THREE from 'three';
import type { Anim } from '@bookworld/shared';

const KIT = '/assets/characters/kaykit-adventurers';
const PLAYER_FILES = ['Rogue', 'Knight', 'Barbarian', 'Rogue_Hooded'];
const CLIP: Record<Anim, string> = { idle: 'Idle', walk: 'Walking_A', run: 'Running_A' };
/** The adventurers come armed; nobody brings a crossbow to a tea party. The mug may stay. */
const HIDDEN_PARTS = /knife|crossbow|throwable|sword|shield|axe|spellbook|wand|staff/i;
/** KayKit characters are modelled at about 1.75 m; the skinned-mesh bounds in the file are misleading. */
const SCALE = 1.0;

export function playerModelFile(name: string): string {
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return PLAYER_FILES[h % PLAYER_FILES.length]!;
}

export function avatarFile(avatar: string | null | undefined, fallbackName: string): string {
  if (avatar?.startsWith('kaykit:')) return avatar.slice('kaykit:'.length);
  return playerModelFile(fallbackName);
}

export function preloadCharacters() {
  for (const f of [...PLAYER_FILES, 'Mage']) useGLTF.preload(`${KIT}/${f}.glb`);
}

export function CharacterModel({ file, anim }: { file: string; anim: Anim }) {
  const { scene, animations } = useGLTF(`${KIT}/${file}.glb`);
  const object = useMemo(() => {
    const o = cloneSkeleton(scene) as THREE.Group;
    o.traverse((n) => {
      const m = n as THREE.Mesh;
      if (HIDDEN_PARTS.test(n.name)) n.visible = false;
      if (m.isMesh) { m.castShadow = true; m.receiveShadow = false; m.frustumCulled = false; }
    });
    return o;
  }, [scene]);
  // The mixer is rooted on the clone itself, so a re-clone (hot reload, model swap) re-binds the clips.
  const { actions } = useAnimations(animations, object);

  useEffect(() => {
    const action = actions[CLIP[anim]] ?? actions[CLIP.idle];
    if (!action) return;
    action.reset().fadeIn(0.2).play();
    return () => { action.fadeOut(0.2); };
  }, [actions, anim]);

  // The models face +z; our yaw convention faces -z at 0, hence the half turn.
  return (
    <group scale={SCALE} rotation-y={Math.PI}>
      <primitive object={object} />
    </group>
  );
}
