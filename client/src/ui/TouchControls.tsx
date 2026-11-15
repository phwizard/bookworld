// Phones and tablets: a thumb stick bottom left to walk (push it far to run), a finger dragged anywhere else on the
// view to look, and buttons for what the keyboard does (talk, the board). Sits over the canvas and under the HUD.
import { useRef, useState } from 'react';
import { touchInput } from '../touch.ts';
import { useStore } from '../store.ts';
import { focusComposer } from './ChatPanel.tsx';

const STICK = 56; // px the knob travels

export function TouchControls() {
  const chatOpen = useStore((s) => s.chatOpen);
  const setChatOpen = useStore((s) => s.setChatOpen);
  const [knob, setKnob] = useState<[number, number]>([0, 0]);
  const stick = useRef<{ id: number; x: number; y: number } | null>(null);
  const look = useRef<{ id: number; x: number; y: number } | null>(null);

  const stickDown = (e: React.PointerEvent) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    stick.current = { id: e.pointerId, x: e.clientX, y: e.clientY };
  };
  const stickMove = (e: React.PointerEvent) => {
    const s = stick.current;
    if (!s || s.id !== e.pointerId) return;
    let dx = e.clientX - s.x, dy = e.clientY - s.y;
    const len = Math.hypot(dx, dy);
    if (len > STICK) { dx = (dx / len) * STICK; dy = (dy / len) * STICK; }
    setKnob([dx, dy]);
    touchInput.x = dx / STICK;
    touchInput.y = -dy / STICK;
  };
  const stickUp = (e: React.PointerEvent) => {
    if (stick.current?.id !== e.pointerId) return;
    stick.current = null;
    setKnob([0, 0]);
    touchInput.x = 0; touchInput.y = 0;
  };

  const lookDown = (e: React.PointerEvent) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    look.current = { id: e.pointerId, x: e.clientX, y: e.clientY };
  };
  const lookMove = (e: React.PointerEvent) => {
    const l = look.current;
    if (!l || l.id !== e.pointerId) return;
    touchInput.dx += e.clientX - l.x;
    touchInput.dy += e.clientY - l.y;
    l.x = e.clientX; l.y = e.clientY;
  };
  const lookUp = (e: React.PointerEvent) => { if (look.current?.id === e.pointerId) look.current = null; };

  return (
    <div className="touch">
      <div className="touch-look" onPointerDown={lookDown} onPointerMove={lookMove} onPointerUp={lookUp} onPointerCancel={lookUp} />
      <div className="touch-stick" onPointerDown={stickDown} onPointerMove={stickMove} onPointerUp={stickUp} onPointerCancel={stickUp}>
        <div className="knob" style={{ transform: `translate(${knob[0]}px, ${knob[1]}px)` }} />
      </div>
      {!chatOpen && (
        <button className="touch-talk" onClick={() => { setChatOpen(true); focusComposer(); }}>Talk</button>
      )}
    </div>
  );
}
