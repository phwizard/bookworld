// The in-world menu (M, Esc to close): where you are, who is here, the sound toggles, the controls, and the way out.
import { useStore } from '../store.ts';
import { leaveWorld } from '../net/colyseus.ts';
import { roomById } from '@bookworld/shared';

export function Menu() {
  const open = useStore((s) => s.menuOpen);
  const setOpen = useStore((s) => s.setMenuOpen);
  const session = useStore((s) => s.session);
  const location = useStore((s) => s.location);
  const players = useStore((s) => s.players);
  const me = useStore((s) => s.mySessionId);
  const characters = useStore((s) => s.characters);
  const musicOn = useStore((s) => s.musicOn);
  const setMusicOn = useStore((s) => s.setMusicOn);
  const sfxOn = useStore((s) => s.sfxOn);
  const setSfxOn = useStore((s) => s.setSfxOn);
  const voiceOn = useStore((s) => s.voiceOn);
  const setVoiceOn = useStore((s) => s.setVoiceOn);
  if (!open || !session) return null;
  const room = roomById(session.world, location);
  const here = Object.entries(players).filter(([sid, p]) => sid !== me && !p.away).map(([, p]) => p.name);
  const chars = Object.values(characters).map((c) => c.name);
  return (
    <div className="menu" onClick={(e) => { if (e.target === e.currentTarget) setOpen(false); }}>
      <div className="panel">
        <h2>{session.world.title}</h2>
        <p className="where">{room?.name ?? location}. {here.length ? `Here: ${here.join(', ')}.` : 'Nobody else here.'}{chars.length ? ` Characters: ${chars.join(', ')}.` : ''}</p>
        <div className="buttons">
          <button autoFocus onClick={() => setOpen(false)}>Back to the world</button>
          <button onClick={() => void leaveWorld()}>Leave to the list of worlds</button>
        </div>
        <div className="toggles">
          <label><input type="checkbox" checked={musicOn} onChange={(e) => setMusicOn(e.target.checked)} /> Music (N)</label>
          <label><input type="checkbox" checked={sfxOn} onChange={(e) => setSfxOn(e.target.checked)} /> Sound effects (F)</label>
          <label><input type="checkbox" checked={voiceOn} onChange={(e) => setVoiceOn(e.target.checked)} /> Characters speak aloud (V)</label>
        </div>
        <table className="keys">
          <tbody>
            <tr><td>WASD</td><td>walk</td></tr>
            <tr><td>Mouse</td><td>look (click the world to take the mouse, Esc gives it back)</td></tr>
            <tr><td>Shift</td><td>run</td></tr>
            <tr><td>Space</td><td>jump</td></tr>
            <tr><td>T or Enter</td><td>talk; Esc leaves the message box, Esc again closes the chat</td></tr>
            <tr><td>M</td><td>this menu</td></tr>
          </tbody>
        </table>
        <p className="muted">Walk through a doorway to go to the next room. Name a character in the chat to get their attention.</p>
      </div>
    </div>
  );
}
