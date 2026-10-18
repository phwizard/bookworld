// Footsteps for the player, other players and characters, driven by the animation state the server
// already carries. The floor decides the sound (wood, stone, grass, carpet).
import type { Surface, WorldRoom } from '@bookworld/shared';
import { playSound } from './engine.ts';

const STEP_INTERVAL = { walk: 0.45, run: 0.32 } as const;
const VARIANTS = 5;

/** Which footstep set a room uses: the explicit `surface`, else guessed from the floor texture, else by template. */
export function surfaceFor(room: WorldRoom | undefined): Surface {
  if (!room) return 'stone';
  if (room.surface) return room.surface;
  const f = (room.floor ?? '').toLowerCase();
  if (/plank|wood|board|parquet/.test(f)) return 'wood';
  if (/grass|leaf|leaves|mud|moss|soil|dirt|sand/.test(f)) return 'grass';
  if (/carpet|rug|fabric/.test(f)) return 'carpet';
  if (/tile|pavement|stone|brick|marble|cobble|concrete/.test(f)) return 'stone';
  return room.scene?.template === 'panorama' ? 'grass' : 'stone';
}

const SAMPLE: Record<Surface, string> = { wood: 'step-wood', stone: 'step-concrete', grass: 'step-grass', carpet: 'step-carpet' };

/** Call `tick` every frame with the current animation and position; it plays a step when one is due. */
export class Stepper {
  private acc = 0;
  private moving = false;

  constructor(private volume: number, private positional: boolean) {}

  tick(dt: number, anim: string, surface: Surface, at: [number, number, number]) {
    const moving = anim === 'walk' || anim === 'run';
    if (!moving) {
      this.moving = false;
      this.acc = 0;
      return;
    }
    const interval = anim === 'run' ? STEP_INTERVAL.run : STEP_INTERVAL.walk;
    if (!this.moving) {
      // first step lands shortly after the body starts moving
      this.moving = true;
      this.acc = interval * 0.7;
    }
    this.acc += dt;
    if (this.acc < interval) return;
    this.acc -= interval;
    const n = Math.floor(Math.random() * VARIANTS);
    playSound(`${SAMPLE[surface]}-${n}`, {
      volume: this.volume * (anim === 'run' ? 1.15 : 1),
      rate: 0.92 + Math.random() * 0.16,
      at: this.positional ? at : undefined,
    });
  }
}
