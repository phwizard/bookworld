// Things on a wall: windows, pictures, mirrors (`scene.decor` in the world file). Drawn, not loaded: a window is a
// lit pane of sky behind glazing bars, a picture a small painting made up from its seed, a mirror a pale glass.
// Rendered in the wall's own frame: x runs along the wall, z points into the room.
import { useMemo } from 'react';
import * as THREE from 'three';
import type { Decor } from '@bookworld/shared';

const cache = new Map<string, THREE.CanvasTexture>();

function rng(seed: string): () => number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) { h ^= seed.charCodeAt(i); h = Math.imul(h, 16777619); }
  let a = h >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function canvasTexture(key: string, w: number, h: number, draw: (ctx: CanvasRenderingContext2D, rand: () => number) => void): THREE.CanvasTexture {
  const hit = cache.get(key);
  if (hit) return hit;
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d')!, rng(key));
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  cache.set(key, tex);
  return tex;
}

function sky(ctx: CanvasRenderingContext2D, rand: () => number, w: number, h: number, night: boolean) {
  const g = ctx.createLinearGradient(0, 0, 0, h);
  if (night) { g.addColorStop(0, '#0b1230'); g.addColorStop(1, '#2b3560'); }
  else { g.addColorStop(0, '#6fa8dc'); g.addColorStop(0.7, '#cfe4f5'); g.addColorStop(1, '#f3ead2'); }
  ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
  if (night) {
    for (let i = 0; i < 60; i++) { ctx.fillStyle = `rgba(255,255,240,${0.3 + rand() * 0.7})`; ctx.fillRect(rand() * w, rand() * h * 0.8, 1.5, 1.5); }
    ctx.fillStyle = '#f4f0d8'; ctx.beginPath(); ctx.arc(w * (0.25 + rand() * 0.5), h * 0.25, w * 0.07, 0, Math.PI * 2); ctx.fill();
  } else {
    for (let i = 0; i < 5; i++) {
      const x = rand() * w, y = rand() * h * 0.55, r = 14 + rand() * 20;
      ctx.fillStyle = 'rgba(255,255,255,0.75)';
      for (let k = 0; k < 5; k++) { ctx.beginPath(); ctx.ellipse(x + (k - 2) * r * 0.6, y + (rand() - 0.5) * r * 0.4, r, r * 0.55, 0, 0, Math.PI * 2); ctx.fill(); }
    }
  }
}

function hills(ctx: CanvasRenderingContext2D, rand: () => number, w: number, h: number, colours: string[]) {
  colours.forEach((colour, i) => {
    const base = h * (0.55 + i * 0.13);
    ctx.fillStyle = colour;
    ctx.beginPath(); ctx.moveTo(0, h);
    let y = base + (rand() - 0.5) * 20;
    for (let x = 0; x <= w; x += w / 8) { ctx.lineTo(x, y); y = base + (rand() - 0.5) * h * 0.14; }
    ctx.lineTo(w, h); ctx.closePath(); ctx.fill();
  });
}

function painting(ctx: CanvasRenderingContext2D, rand: () => number, w: number, h: number, subject: string) {
  if (subject === 'portrait') {
    const g = ctx.createRadialGradient(w / 2, h * 0.4, 10, w / 2, h / 2, h * 0.75);
    const hue = Math.floor(rand() * 360);
    g.addColorStop(0, `hsl(${hue},25%,34%)`); g.addColorStop(1, `hsl(${hue},30%,10%)`);
    ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
    // shoulders, neck, head, hair: a sitter, not anybody
    ctx.fillStyle = `hsl(${Math.floor(rand() * 360)},35%,${18 + rand() * 14}%)`;
    ctx.beginPath(); ctx.ellipse(w / 2, h * 1.02, w * 0.46, h * 0.36, 0, 0, Math.PI * 2); ctx.fill();
    const skin = `hsl(${22 + rand() * 12},${35 + rand() * 20}%,${58 + rand() * 18}%)`;
    ctx.fillStyle = skin; ctx.fillRect(w * 0.44, h * 0.5, w * 0.12, h * 0.16);
    ctx.beginPath(); ctx.ellipse(w / 2, h * 0.4, w * 0.17, h * 0.17, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = `hsl(${20 + rand() * 25},${20 + rand() * 40}%,${10 + rand() * 30}%)`;
    ctx.beginPath(); ctx.ellipse(w / 2, h * 0.31, w * 0.19, h * 0.11, 0, Math.PI, 0); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.75)'; ctx.beginPath(); ctx.moveTo(w * 0.44, h * 0.66); ctx.lineTo(w / 2, h * 0.74); ctx.lineTo(w * 0.56, h * 0.66); ctx.closePath(); ctx.fill();
  } else {
    const evening = rand() > 0.6;
    const g = ctx.createLinearGradient(0, 0, 0, h * 0.7);
    if (evening) { g.addColorStop(0, '#39406e'); g.addColorStop(0.6, '#d98b5f'); g.addColorStop(1, '#f2c98a'); }
    else { g.addColorStop(0, '#7fa9cf'); g.addColorStop(1, '#e6e2c8'); }
    ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = evening ? '#f7d9a0' : '#fff6d8';
    ctx.beginPath(); ctx.arc(w * (0.2 + rand() * 0.6), h * (0.3 + rand() * 0.15), w * 0.06, 0, Math.PI * 2); ctx.fill();
    hills(ctx, rand, w, h, evening ? ['#5b5a78', '#3f4a52', '#26332b'] : ['#8fb09a', '#5d8a56', '#3c6a39']);
    // a few trees on the near hill
    for (let i = 0; i < 5; i++) {
      const x = rand() * w, y = h * (0.8 + rand() * 0.12), s = 8 + rand() * 10;
      ctx.fillStyle = '#3a2a1a'; ctx.fillRect(x - 1, y, 2.5, s);
      ctx.fillStyle = evening ? '#1c2a22' : '#2f5a2c'; ctx.beginPath(); ctx.ellipse(x, y, s * 0.6, s * 0.8, 0, 0, Math.PI * 2); ctx.fill();
    }
  }
  // varnish and age
  for (let i = 0; i < 1500; i++) { ctx.fillStyle = rand() > 0.5 ? 'rgba(0,0,0,0.05)' : 'rgba(255,240,200,0.05)'; ctx.fillRect(rand() * w, rand() * h, 2, 2); }
}

const SIZE: Record<Decor['kind'], [number, number, number]> = {
  // width, height, height of the centre above the floor
  window: [1.3, 1.7, 1.75],
  picture: [0.9, 1.15, 1.75],
  mirror: [1.1, 1.4, 1.75],
};

export function WallDecor({ item, seed, trim, wallHeight }: { item: Decor; seed: string; trim: string; wallHeight: number }) {
  const [bw, bh, by] = SIZE[item.kind];
  const scale = item.size ?? 1;
  const w = bw * scale, h = Math.min(bh * scale, wallHeight - 1.3);
  const y = Math.min(by, wallHeight - h / 2 - 0.35);
  const landscape = item.kind === 'picture' && item.subject !== 'portrait' && (item.subject === 'landscape' || rng(seed)() > 0.5);
  // a landscape hangs wide
  const pw = landscape ? h : w, ph = landscape ? w : h;
  const tex = useMemo(() => {
    if (item.kind === 'window') return canvasTexture(`win|${seed}|${item.subject ?? 'day'}`, 256, 320, (ctx, rand) => { sky(ctx, rand, 256, 320, item.subject === 'night'); if (item.subject !== 'night') hills(ctx, rand, 256, 320, ['#9db7a0', '#6f9a64']); });
    if (item.kind === 'mirror') return canvasTexture(`mir|${seed}`, 128, 160, (ctx) => {
      const g = ctx.createLinearGradient(0, 0, 128, 160);
      g.addColorStop(0, '#dfe8ea'); g.addColorStop(0.45, '#a9b9bf'); g.addColorStop(0.55, '#c9d6d9'); g.addColorStop(1, '#8fa1a8');
      ctx.fillStyle = g; ctx.fillRect(0, 0, 128, 160);
      ctx.strokeStyle = 'rgba(255,255,255,0.5)'; ctx.lineWidth = 10; ctx.beginPath(); ctx.moveTo(20, 150); ctx.lineTo(90, 10); ctx.stroke();
    });
    return canvasTexture(`pic|${seed}|${landscape}`, landscape ? 320 : 256, landscape ? 256 : 320, (ctx, rand) => painting(ctx, rand, landscape ? 320 : 256, landscape ? 256 : 320, landscape ? 'landscape' : 'portrait'));
  }, [item.kind, item.subject, seed, landscape]);
  const frame = item.kind === 'window' ? 0.09 : 0.08;
  const gilt = item.kind === 'window' ? trim : '#b8923a';
  const fw = item.kind === 'picture' ? pw : w, fh = item.kind === 'picture' ? ph : h;
  return (
    <group position={[item.x ?? 0, y, 0]}>
      <mesh position={[0, 0, 0.012]}>
        <planeGeometry args={[fw, fh]} />
        {item.kind === 'picture'
          ? <meshStandardMaterial map={tex} roughness={0.6} />
          : <meshStandardMaterial map={tex} emissiveMap={tex} emissive="#ffffff" emissiveIntensity={item.kind === 'window' ? 0.85 : 0.35} roughness={0.2} />}
      </mesh>
      {/* the frame: four bars */}
      {[[0, fh / 2 + frame / 2, fw + frame * 2, frame], [0, -fh / 2 - frame / 2, fw + frame * 2, frame], [-fw / 2 - frame / 2, 0, frame, fh], [fw / 2 + frame / 2, 0, frame, fh]].map(([x, yy, bwid, bhei], i) => (
        <mesh key={i} position={[x!, yy!, 0.03]} castShadow>
          <boxGeometry args={[bwid!, bhei!, 0.06]} />
          <meshStandardMaterial color={gilt} roughness={0.45} metalness={item.kind === 'window' ? 0 : 0.5} />
        </mesh>
      ))}
      {item.kind === 'window' && (
        <>
          {/* glazing bars and a sill */}
          <mesh position={[0, 0, 0.022]}><boxGeometry args={[0.045, fh, 0.02]} /><meshStandardMaterial color={trim} roughness={0.5} /></mesh>
          {[-fh / 6, fh / 6].map((yy) => (
            <mesh key={yy} position={[0, yy, 0.022]}><boxGeometry args={[fw, 0.04, 0.02]} /><meshStandardMaterial color={trim} roughness={0.5} /></mesh>
          ))}
          <mesh position={[0, -fh / 2 - frame - 0.03, 0.08]}><boxGeometry args={[fw + 0.4, 0.06, 0.18]} /><meshStandardMaterial color={trim} roughness={0.5} /></mesh>
        </>
      )}
    </group>
  );
}
