// What the touch controls (a thumb stick and a finger dragged over the view) ask of the player this frame.
// Plain module state, read by the player controller in the render loop; never React state.
export const touchInput = {
  /** the stick: x right, y forward, each -1 to 1 */
  x: 0,
  y: 0,
  /** look, in pixels dragged since the controller last took them */
  dx: 0,
  dy: 0,
};

/** True on phones and tablets (a coarse pointer and no hover). */
export function isTouchDevice(): boolean {
  return typeof window !== 'undefined' && (window.matchMedia?.('(pointer: coarse)').matches ?? false);
}

if (import.meta.env.DEV && typeof window !== 'undefined') (window as unknown as { __touch: unknown }).__touch = touchInput;
