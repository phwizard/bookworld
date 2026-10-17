import * as THREE from 'three';

const cache = new Map<string, THREE.CanvasTexture>();

/** Cheap procedural wallpaper: base colour, faint damask-like diamonds in the trim colour, light grain. */
export function wallpaperTexture(base: string, trim: string, repeat: [number, number]): THREE.CanvasTexture {
  const key = `${base}|${trim}|${repeat.join('x')}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const size = 256;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, size, size);
  ctx.globalAlpha = 0.18;
  ctx.strokeStyle = trim;
  ctx.lineWidth = 2;
  for (let i = -size; i < size * 2; i += 64) {
    ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i + size, size); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(i, size); ctx.lineTo(i + size, 0); ctx.stroke();
  }
  ctx.globalAlpha = 0.08;
  for (let i = 0; i < 1400; i++) {
    ctx.fillStyle = Math.random() > 0.5 ? '#000' : '#fff';
    ctx.fillRect(Math.random() * size, Math.random() * size, 2, 2);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(repeat[0], repeat[1]);
  tex.colorSpace = THREE.SRGBColorSpace;
  cache.set(key, tex);
  return tex;
}

export function floorTexture(base: string, repeat: [number, number]): THREE.CanvasTexture {
  const key = `floor|${base}|${repeat.join('x')}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const size = 256;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, size, size);
  ctx.globalAlpha = 0.12;
  ctx.strokeStyle = '#000';
  ctx.lineWidth = 3;
  for (let i = 0; i <= size; i += 64) {
    ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i, size); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, i); ctx.lineTo(size, i); ctx.stroke();
  }
  ctx.globalAlpha = 0.06;
  for (let i = 0; i < 2000; i++) {
    ctx.fillStyle = Math.random() > 0.5 ? '#000' : '#fff';
    ctx.fillRect(Math.random() * size, Math.random() * size, 2, 2);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(repeat[0], repeat[1]);
  tex.colorSpace = THREE.SRGBColorSpace;
  cache.set(key, tex);
  return tex;
}
