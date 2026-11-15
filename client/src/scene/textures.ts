// Procedural room materials, drawn on a canvas from the room's palette. A world file names one with
// "pattern:<name>" in `wallpaper` or `floor` (docs/WORLD-FILE.md); null gives plaster walls and stone slabs.
// Every pattern tiles, is drawn from a seeded random so all visitors see the same wall, and says how many
// metres one tile covers so the renderer can repeat it at the right scale on any wall piece.
import * as THREE from 'three';

export const WALL_PATTERNS = ['plaster', 'damask', 'stripes', 'panelling', 'brick', 'velvet', 'foliage'] as const;
export const FLOOR_PATTERNS = ['slabs', 'parquet', 'checker', 'planks', 'cobbles', 'carpet', 'grass'] as const;
export type WallPattern = (typeof WALL_PATTERNS)[number];
export type FloorPattern = (typeof FLOOR_PATTERNS)[number];

export interface PatternTexture {
  texture: THREE.CanvasTexture;
  /** metres covered by one tile */
  tile: number;
  /** depth of the relief for materials with grooves and joints (the picture doubles as its own height map), 0 for flat ones */
  relief: number;
}

const S = 512;
const cache = new Map<string, PatternTexture>();

/** "pattern:damask" gives "damask"; an image path or null gives null. */
export function patternName(value: string | null | undefined): string | null {
  return value && value.startsWith('pattern:') ? value.slice(8) : null;
}

function rng(seed: string): () => number {
  let h = 1779033703;
  for (let i = 0; i < seed.length; i++) { h = Math.imul(h ^ seed.charCodeAt(i), 3432918353); h = (h << 13) | (h >>> 19); }
  let a = h >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** The colour lighter (amount > 0) or darker, as a CSS string. */
function tone(hex: string, amount: number): string {
  const c = new THREE.Color(hex);
  const hsl = { h: 0, s: 0, l: 0 };
  c.getHSL(hsl);
  c.setHSL(hsl.h, hsl.s, Math.min(0.97, Math.max(0.03, hsl.l + amount)));
  return `#${c.getHexString()}`;
}
function mix(a: string, b: string, t: number): string {
  return `#${new THREE.Color(a).lerp(new THREE.Color(b), t).getHexString()}`;
}
function lightness(hex: string): number {
  const hsl = { h: 0, s: 0, l: 0 };
  new THREE.Color(hex).getHSL(hsl);
  return hsl.l;
}

type Ctx = CanvasRenderingContext2D;

/** Runs a drawing at the tile and at its eight neighbours' offsets, so shapes that cross an edge come back in. */
function wrapped(ctx: Ctx, x: number, y: number, r: number, draw: (x: number, y: number) => void): void {
  for (const dx of [-S, 0, S]) for (const dy of [-S, 0, S]) {
    if (x + dx + r < 0 || x + dx - r > S || y + dy + r < 0 || y + dy - r > S) continue;
    draw(x + dx, y + dy);
  }
}

function grain(ctx: Ctx, rand: () => number, n: number, alpha: number): void {
  ctx.globalAlpha = alpha;
  for (let i = 0; i < n; i++) {
    ctx.fillStyle = rand() > 0.5 ? '#000' : '#fff';
    ctx.fillRect(rand() * S, rand() * S, 1 + rand() * 1.5, 1 + rand() * 1.5);
  }
  ctx.globalAlpha = 1;
}

/** Soft uneven patches, lighter and darker, for plaster, stone and cloth. */
function blotches(ctx: Ctx, rand: () => number, n: number, alpha: number, radius: number): void {
  for (let i = 0; i < n; i++) {
    const x = rand() * S, y = rand() * S, r = radius * (0.5 + rand());
    const dark = rand() > 0.5;
    wrapped(ctx, x, y, r, (px, py) => {
      const g = ctx.createRadialGradient(px, py, 0, px, py, r);
      g.addColorStop(0, dark ? `rgba(0,0,0,${alpha})` : `rgba(255,255,255,${alpha})`);
      g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g;
      ctx.fillRect(px - r, py - r, r * 2, r * 2);
    });
  }
}

/** Wood grain along x inside a rectangle (rotate the context for boards that run the other way). */
function woodBoard(ctx: Ctx, rand: () => number, x: number, y: number, w: number, h: number, colour: string): void {
  ctx.save();
  ctx.beginPath(); ctx.rect(x, y, w, h); ctx.clip();
  ctx.fillStyle = tone(colour, (rand() - 0.5) * 0.08);
  ctx.fillRect(x, y, w, h);
  const lines = Math.max(3, Math.round(h / 5));
  for (let i = 0; i < lines; i++) {
    const ly = y + rand() * h;
    ctx.strokeStyle = rand() > 0.35 ? 'rgba(0,0,0,0.10)' : 'rgba(255,255,255,0.07)';
    ctx.lineWidth = 0.6 + rand() * 1.2;
    ctx.beginPath();
    ctx.moveTo(x - 4, ly);
    const wob = (rand() - 0.5) * 6;
    ctx.bezierCurveTo(x + w * 0.3, ly + wob, x + w * 0.7, ly - wob, x + w + 4, ly + (rand() - 0.5) * 3);
    ctx.stroke();
  }
  if (rand() > 0.75) { // a knot
    const kx = x + w * (0.2 + rand() * 0.6), ky = y + h * (0.3 + rand() * 0.4), kr = Math.min(h * 0.22, 7);
    for (let r = kr; r > 1; r -= 1.6) { ctx.strokeStyle = 'rgba(0,0,0,0.14)'; ctx.lineWidth = 0.8; ctx.beginPath(); ctx.ellipse(kx, ky, r * 1.5, r, 0, 0, Math.PI * 2); ctx.stroke(); }
  }
  // the groove: a dark line below and to the right, a light one above
  ctx.fillStyle = 'rgba(0,0,0,0.38)'; ctx.fillRect(x, y + h - 1.5, w, 1.5); ctx.fillRect(x + w - 1.5, y, 1.5, h);
  ctx.fillStyle = 'rgba(255,255,255,0.10)'; ctx.fillRect(x, y, w, 1); ctx.fillRect(x, y, 1, h);
  ctx.restore();
}

/** One damask ornament: a pointed medallion with leaves, mirrored left to right. */
function ornament(ctx: Ctx, x: number, y: number, r: number, fill: string, line: string): void {
  ctx.save();
  ctx.translate(x, y);
  const leaf = (ax: number, ay: number, bx: number, by: number, bulge: number) => {
    const mx = (ax + bx) / 2, my = (ay + by) / 2, nx = -(by - ay), ny = bx - ax;
    ctx.beginPath();
    ctx.moveTo(ax, ay);
    ctx.quadraticCurveTo(mx + nx * bulge, my + ny * bulge, bx, by);
    ctx.quadraticCurveTo(mx - nx * bulge * 0.35, my - ny * bulge * 0.35, ax, ay);
    ctx.fill(); ctx.stroke();
  };
  ctx.fillStyle = fill; ctx.strokeStyle = line; ctx.lineWidth = 1.4; ctx.lineJoin = 'round';
  for (const sx of [1, -1]) {
    ctx.save(); ctx.scale(sx, 1);
    leaf(0, r * 0.95, r * 0.55, r * 0.15, 0.45);      // lower sweep
    leaf(0, -r * 0.95, r * 0.5, -r * 0.2, -0.45);     // upper sweep
    leaf(r * 0.12, 0, r * 0.82, -r * 0.42, -0.4);     // side leaf up
    leaf(r * 0.12, r * 0.1, r * 0.78, r * 0.55, 0.38); // side leaf down
    ctx.beginPath(); ctx.arc(r * 0.62, r * 0.04, r * 0.07, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.restore();
  }
  // the heart of it: a lozenge with a bud above and below
  ctx.beginPath(); ctx.moveTo(0, -r * 0.42); ctx.quadraticCurveTo(r * 0.2, 0, 0, r * 0.42); ctx.quadraticCurveTo(-r * 0.2, 0, 0, -r * 0.42); ctx.fill(); ctx.stroke();
  for (const sy of [-1, 1]) { ctx.beginPath(); ctx.arc(0, sy * r * 1.08, r * 0.08, 0, Math.PI * 2); ctx.fill(); ctx.stroke(); }
  ctx.restore();
}

function leafShape(ctx: Ctx, x: number, y: number, len: number, angle: number, colour: string): void {
  ctx.save();
  ctx.translate(x, y); ctx.rotate(angle);
  ctx.fillStyle = colour;
  ctx.beginPath(); ctx.moveTo(0, 0); ctx.quadraticCurveTo(len * 0.5, -len * 0.32, len, 0); ctx.quadraticCurveTo(len * 0.5, len * 0.32, 0, 0); ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,0.22)'; ctx.lineWidth = 0.8;
  ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(len, 0); ctx.stroke();
  ctx.restore();
}

interface Drawn { tile: number }
type Painter = (ctx: Ctx, rand: () => number, base: string, trim: string) => Drawn;

const WALLS: Record<WallPattern, Painter> = {
  plaster(ctx, rand, base) {
    ctx.fillStyle = base; ctx.fillRect(0, 0, S, S);
    blotches(ctx, rand, 46, 0.045, 90);
    blotches(ctx, rand, 60, 0.03, 28);
    // trowel marks
    ctx.lineCap = 'round';
    for (let i = 0; i < 90; i++) {
      const x = rand() * S, y = rand() * S, a = rand() * Math.PI, l = 12 + rand() * 40;
      ctx.strokeStyle = rand() > 0.5 ? 'rgba(255,255,255,0.045)' : 'rgba(0,0,0,0.04)';
      ctx.lineWidth = 2 + rand() * 5;
      wrapped(ctx, x, y, l, (px, py) => { ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(px + Math.cos(a) * l, py + Math.sin(a) * l); ctx.stroke(); });
    }
    grain(ctx, rand, 5000, 0.035);
    return { tile: 2.4 };
  },
  damask(ctx, rand, base, trim) {
    ctx.fillStyle = base; ctx.fillRect(0, 0, S, S);
    // the weave of the paper
    for (let x = 0; x < S; x += 3) { ctx.fillStyle = x % 6 ? 'rgba(0,0,0,0.035)' : 'rgba(255,255,255,0.03)'; ctx.fillRect(x, 0, 1, S); }
    const light = lightness(base) > 0.5;
    const fill = tone(base, light ? -0.07 : 0.07);
    const line = mix(base, trim, 0.55);
    const r = S * 0.2;
    // a half-drop repeat: one ornament at the centre, one split over the four corners
    ornament(ctx, S / 2, S / 2, r, fill, line);
    for (const [cx, cy] of [[0, 0], [S, 0], [0, S], [S, S]] as [number, number][]) ornament(ctx, cx, cy, r, fill, line);
    // small sprigs between them
    ctx.fillStyle = line;
    for (const [cx, cy] of [[S / 2, 0], [S / 2, S], [0, S / 2], [S, S / 2]] as [number, number][]) {
      for (const [dx, dy] of [[0, -9], [0, 9], [-9, 0], [9, 0], [0, 0]] as [number, number][]) { ctx.beginPath(); ctx.arc(cx + dx, cy + dy, dx || dy ? 2.6 : 3.6, 0, Math.PI * 2); ctx.fill(); }
    }
    blotches(ctx, rand, 18, 0.03, 120);
    grain(ctx, rand, 3500, 0.03);
    return { tile: 1.3 };
  },
  stripes(ctx, rand, base, trim) {
    ctx.fillStyle = base; ctx.fillRect(0, 0, S, S);
    const light = lightness(base) > 0.5;
    const band = S / 4;
    for (let i = 0; i < 4; i++) {
      const x = i * band;
      if (i % 2) { ctx.fillStyle = tone(base, light ? -0.06 : 0.06); ctx.fillRect(x, 0, band, S); }
      ctx.fillStyle = mix(base, trim, 0.7);
      ctx.fillRect(x - 1.5, 0, 3, S);
      ctx.fillStyle = mix(base, trim, 0.35);
      ctx.fillRect(x + 9, 0, 1.5, S); ctx.fillRect(x + band - 10.5, 0, 1.5, S);
    }
    for (let x = 0; x < S; x += 2) { ctx.fillStyle = 'rgba(0,0,0,0.025)'; ctx.fillRect(x, 0, 1, S); }
    blotches(ctx, rand, 16, 0.03, 120);
    grain(ctx, rand, 3000, 0.03);
    return { tile: 1.2 };
  },
  panelling(ctx, rand, base) {
    // upright boards, six to the tile, each with its own grain
    ctx.fillStyle = base; ctx.fillRect(0, 0, S, S);
    const n = 6, bw = S / n;
    for (let i = 0; i < n; i++) {
      ctx.save();
      ctx.translate(i * bw + bw, 0); ctx.rotate(Math.PI / 2); // the board's x runs down the wall
      woodBoard(ctx, rand, 0, 0, S, bw, base);
      ctx.restore();
    }
    blotches(ctx, rand, 14, 0.04, 130);
    return { tile: 1.5 };
  },
  brick(ctx, rand, base, trim) {
    const mortar = mix(tone(base, lightness(base) > 0.45 ? -0.22 : 0.2), trim, 0.15);
    ctx.fillStyle = mortar; ctx.fillRect(0, 0, S, S);
    const rows = 8, cols = 4, bh = S / rows, bw = S / cols, gap = 5;
    for (let r = 0; r < rows; r++) {
      const off = r % 2 ? bw / 2 : 0;
      for (let c = -1; c < cols; c++) {
        const x = c * bw + off + gap / 2, y = r * bh + gap / 2, w = bw - gap, h = bh - gap;
        const colour = tone(base, (rand() - 0.5) * 0.12);
        for (const px of [x, x + S]) {
          if (px > S || px + w < 0) continue;
          ctx.fillStyle = colour; ctx.fillRect(px, y, w, h);
          ctx.fillStyle = 'rgba(255,255,255,0.10)'; ctx.fillRect(px, y, w, 2);
          ctx.fillStyle = 'rgba(0,0,0,0.20)'; ctx.fillRect(px, y + h - 2.5, w, 2.5); ctx.fillRect(px + w - 2, y, 2, h);
        }
      }
    }
    blotches(ctx, rand, 40, 0.05, 40);
    grain(ctx, rand, 9000, 0.06);
    return { tile: 1.0 };
  },
  velvet(ctx, rand, base, trim) {
    ctx.fillStyle = base; ctx.fillRect(0, 0, S, S);
    // the nap catches the light in soft upright folds
    const folds = 4, fw = S / folds;
    for (let i = 0; i < folds; i++) {
      const g = ctx.createLinearGradient(i * fw, 0, (i + 1) * fw, 0);
      g.addColorStop(0, 'rgba(0,0,0,0.16)'); g.addColorStop(0.5, 'rgba(255,255,255,0.07)'); g.addColorStop(1, 'rgba(0,0,0,0.16)');
      ctx.fillStyle = g; ctx.fillRect(i * fw, 0, fw, S);
    }
    // a small gilt figure on a half-drop grid
    const gilt = mix(base, trim, 0.75);
    const step = S / 4;
    for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) {
      const x = c * step + (r % 2 ? step / 2 : 0) + step / 4, y = r * step + step / 2;
      wrapped(ctx, x, y, 12, (px, py) => {
        ctx.fillStyle = gilt; ctx.globalAlpha = 0.75;
        ctx.beginPath(); ctx.moveTo(px, py - 9); ctx.quadraticCurveTo(px + 5, py, px, py + 9); ctx.quadraticCurveTo(px - 5, py, px, py - 9); ctx.fill();
        for (const sx of [-1, 1]) { ctx.beginPath(); ctx.ellipse(px + sx * 6.5, py + 1, 2.2, 5, sx * 0.5, 0, Math.PI * 2); ctx.fill(); }
        ctx.fillRect(px - 6, py + 4.5, 12, 1.6);
        ctx.globalAlpha = 1;
      });
    }
    grain(ctx, rand, 12000, 0.05);
    return { tile: 1.6 };
  },
  foliage(ctx, rand, base, trim) {
    ctx.fillStyle = tone(base, -0.12); ctx.fillRect(0, 0, S, S);
    blotches(ctx, rand, 30, 0.08, 70);
    // three depths of leaves, the nearest lightest
    for (let layer = 0; layer < 3; layer++) {
      const count = 260 - layer * 50;
      for (let i = 0; i < count; i++) {
        const x = rand() * S, y = rand() * S, len = 16 + rand() * 22 + layer * 5, a = rand() * Math.PI * 2;
        const hue = new THREE.Color(tone(base, -0.08 + layer * 0.07 + (rand() - 0.5) * 0.08));
        hue.offsetHSL((rand() - 0.5) * 0.05, 0, 0);
        const colour = `#${hue.getHexString()}`;
        wrapped(ctx, x, y, len, (px, py) => leafShape(ctx, px, py, len, a, colour));
      }
    }
    // a few flowers or berries in the trim colour
    for (let i = 0; i < 14; i++) {
      const x = rand() * S, y = rand() * S;
      wrapped(ctx, x, y, 6, (px, py) => {
        ctx.fillStyle = trim; ctx.globalAlpha = 0.85;
        for (let p = 0; p < 5; p++) { const a = (p / 5) * Math.PI * 2; ctx.beginPath(); ctx.arc(px + Math.cos(a) * 3.2, py + Math.sin(a) * 3.2, 2.4, 0, Math.PI * 2); ctx.fill(); }
        ctx.fillStyle = '#f4e9b0'; ctx.beginPath(); ctx.arc(px, py, 1.6, 0, Math.PI * 2); ctx.fill();
        ctx.globalAlpha = 1;
      });
    }
    return { tile: 2.0 };
  },
};

const FLOORS: Record<FloorPattern, Painter> = {
  slabs(ctx, rand, base) {
    ctx.fillStyle = tone(base, -0.1); ctx.fillRect(0, 0, S, S);
    const n = 2, sw = S / n, gap = 4;
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) {
      const x = c * sw + gap / 2, y = r * sw + gap / 2, w = sw - gap;
      ctx.fillStyle = tone(base, (rand() - 0.5) * 0.06); ctx.fillRect(x, y, w, w);
      ctx.fillStyle = 'rgba(255,255,255,0.07)'; ctx.fillRect(x, y, w, 2); ctx.fillRect(x, y, 2, w);
      ctx.fillStyle = 'rgba(0,0,0,0.16)'; ctx.fillRect(x, y + w - 2, w, 2); ctx.fillRect(x + w - 2, y, 2, w);
    }
    blotches(ctx, rand, 40, 0.05, 60);
    grain(ctx, rand, 9000, 0.05);
    return { tile: 2.0 };
  },
  parquet(ctx, rand, base) {
    // squares of five strips, each square turned against its neighbours
    ctx.fillStyle = base; ctx.fillRect(0, 0, S, S);
    const n = 4, sq = S / n, strips = 5, sw = sq / strips;
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) {
      ctx.save();
      ctx.translate(c * sq, r * sq);
      if ((r + c) % 2) { ctx.translate(sq, 0); ctx.rotate(Math.PI / 2); }
      for (let i = 0; i < strips; i++) woodBoard(ctx, rand, 0, i * sw, sq, sw, base);
      ctx.restore();
    }
    // a wax shine
    const g = ctx.createLinearGradient(0, 0, S, S);
    g.addColorStop(0, 'rgba(255,255,255,0.05)'); g.addColorStop(0.5, 'rgba(255,255,255,0)'); g.addColorStop(1, 'rgba(255,255,255,0.05)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, S, S);
    return { tile: 1.6 };
  },
  checker(ctx, rand, base) {
    // marble squares: the floor colour and its pale partner, veined
    const dark = lightness(base) < 0.5 ? base : tone(base, -0.45);
    const pale = lightness(base) < 0.5 ? mix(tone(base, 0.62), '#efe7d6', 0.7) : base;
    const n = 2, sq = S / n;
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) {
      const isDark = (r + c) % 2 === 1;
      ctx.save();
      ctx.beginPath(); ctx.rect(c * sq, r * sq, sq, sq); ctx.clip();
      ctx.fillStyle = isDark ? dark : pale; ctx.fillRect(c * sq, r * sq, sq, sq);
      for (let v = 0; v < 7; v++) {
        let x = c * sq + rand() * sq, y = r * sq + rand() * sq;
        ctx.strokeStyle = isDark ? `rgba(255,255,255,${0.05 + rand() * 0.1})` : `rgba(60,50,40,${0.05 + rand() * 0.1})`;
        ctx.lineWidth = 0.5 + rand() * 1.4;
        ctx.beginPath(); ctx.moveTo(x, y);
        let a = rand() * Math.PI * 2;
        for (let s = 0; s < 14; s++) { a += (rand() - 0.5) * 0.9; x += Math.cos(a) * 16; y += Math.sin(a) * 16; ctx.lineTo(x, y); }
        ctx.stroke();
      }
      ctx.restore();
      ctx.fillStyle = 'rgba(0,0,0,0.30)'; ctx.fillRect(c * sq, r * sq, sq, 1.5); ctx.fillRect(c * sq, r * sq, 1.5, sq);
    }
    blotches(ctx, rand, 26, 0.035, 80);
    grain(ctx, rand, 3000, 0.025);
    return { tile: 1.6 };
  },
  planks(ctx, rand, base) {
    ctx.fillStyle = base; ctx.fillRect(0, 0, S, S);
    const rows = 6, bh = S / rows;
    for (let r = 0; r < rows; r++) {
      const joint = Math.round(rand() * S);
      // two boards to the row, meeting at a joint that differs row by row; the second wraps round the edge
      woodBoard(ctx, rand, 0, r * bh, joint, bh, base);
      woodBoard(ctx, rand, joint, r * bh, S - joint, bh, base);
      ctx.fillStyle = 'rgba(0,0,0,0.38)'; ctx.fillRect(0, r * bh, 1.5, bh);
    }
    blotches(ctx, rand, 14, 0.04, 120);
    return { tile: 1.8 };
  },
  cobbles(ctx, rand, base) {
    ctx.fillStyle = tone(base, -0.2); ctx.fillRect(0, 0, S, S);
    const n = 7, cell = S / n;
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) {
      const x = (c + 0.5 + (r % 2 ? 0.5 : 0)) * cell + (rand() - 0.5) * 8, y = (r + 0.5) * cell + (rand() - 0.5) * 8;
      const rx = cell * (0.4 + rand() * 0.07), ry = cell * (0.38 + rand() * 0.08), rot = (rand() - 0.5) * 0.6;
      const colour = tone(base, (rand() - 0.5) * 0.14);
      wrapped(ctx, x, y, cell, (px, py) => {
        const g = ctx.createRadialGradient(px - rx * 0.3, py - ry * 0.3, 2, px, py, rx * 1.1);
        g.addColorStop(0, tone(colour, 0.08)); g.addColorStop(1, tone(colour, -0.1));
        ctx.fillStyle = g;
        ctx.beginPath(); ctx.ellipse(px, py, rx, ry, rot, 0, Math.PI * 2); ctx.fill();
      });
    }
    grain(ctx, rand, 9000, 0.06);
    return { tile: 1.6 };
  },
  carpet(ctx, rand, base, trim) {
    ctx.fillStyle = base; ctx.fillRect(0, 0, S, S);
    // the pile, then a small figure and a trellis in the trim colour
    grain(ctx, rand, 26000, 0.07);
    const figure = mix(base, trim, 0.6);
    const step = S / 4;
    ctx.strokeStyle = mix(base, trim, 0.3); ctx.lineWidth = 2;
    for (let i = -S; i <= S * 2; i += step) {
      ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i + S, S); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(i, S); ctx.lineTo(i + S, 0); ctx.stroke();
    }
    for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) {
      const x = c * step + step / 2, y = r * step + step / 2;
      ctx.fillStyle = figure;
      for (let p = 0; p < 4; p++) { const a = (p / 4) * Math.PI * 2; ctx.beginPath(); ctx.ellipse(x + Math.cos(a) * 9, y + Math.sin(a) * 9, 7, 3.4, a, 0, Math.PI * 2); ctx.fill(); }
      ctx.fillStyle = tone(figure, 0.12); ctx.beginPath(); ctx.arc(x, y, 3.5, 0, Math.PI * 2); ctx.fill();
    }
    grain(ctx, rand, 12000, 0.05);
    return { tile: 1.4 };
  },
  grass(ctx, rand, base) {
    ctx.fillStyle = tone(base, -0.06); ctx.fillRect(0, 0, S, S);
    blotches(ctx, rand, 40, 0.07, 70);
    ctx.lineCap = 'round';
    for (let i = 0; i < 5200; i++) {
      const x = rand() * S, y = rand() * S, l = 5 + rand() * 9, a = -Math.PI / 2 + (rand() - 0.5) * 1.3;
      const c = new THREE.Color(tone(base, (rand() - 0.4) * 0.2));
      c.offsetHSL((rand() - 0.5) * 0.04, 0, 0);
      ctx.strokeStyle = `#${c.getHexString()}`; ctx.lineWidth = 1 + rand();
      wrapped(ctx, x, y, l, (px, py) => { ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(px + Math.cos(a) * l, py + Math.sin(a) * l); ctx.stroke(); });
    }
    return { tile: 2.0 };
  },
};

/** Materials whose dark lines are hollows: mortar, the gaps between stones (wood grain makes a noisy height map, so boards stay flat). */
const RELIEF: Record<string, number> = { brick: 3, cobbles: 4, slabs: 2 };

function paint(kind: 'wall' | 'floor', name: string, base: string, trim: string): PatternTexture {
  const key = `${kind}|${name}|${base}|${trim}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const ctx = c.getContext('2d')!;
  const painter = kind === 'wall' ? WALLS[name as WallPattern] ?? WALLS.plaster : FLOORS[name as FloorPattern] ?? FLOORS.slabs;
  const { tile } = painter(ctx, rng(key), base, trim);
  const texture = new THREE.CanvasTexture(c);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  const out = { texture, tile, relief: RELIEF[name] ?? 0 };
  cache.set(key, out);
  return out;
}

export function wallPattern(name: string | null, base: string, trim: string): PatternTexture {
  return paint('wall', name ?? 'plaster', base, trim);
}

export function floorPattern(name: string | null, base: string, trim: string): PatternTexture {
  return paint('floor', name ?? 'slabs', base, trim);
}

/** The same picture with its own repeat, for one wall piece or one floor. */
export function repeated(source: THREE.Texture, repeatX: number, repeatY: number, offsetX = 0, offsetY = 0): THREE.Texture {
  const t = source.clone();
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeatX, repeatY);
  t.offset.set(offsetX, offsetY);
  t.colorSpace = THREE.SRGBColorSpace;
  t.needsUpdate = true;
  return t;
}
