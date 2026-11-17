import { useState } from 'react';
import { GamePicker } from '../components/GamePicker';
import { IconBack } from '../components/Icons';
import { DEFAULT_SETTINGS, RoomMode, RoomSettings } from '../../shared/protocol';
import { VARIANTS } from '../../shared/variants';
import { request, socket } from '../lib/socket';
import { useStore } from '../lib/store';
import { setRoomToken, toServerProfile } from '../lib/profile';
import { chips, cls } from '../lib/format';
import { navigate } from '../App';

const MODES: { id: RoomMode; icon: string; title: string; sub: string }[] = [
  { id: 'custom', icon: '🔀', title: 'Custom (switch games)', sub: 'Host can switch the game any time — Hold\'em → Omaha → Teen Patti…' },
  { id: 'fixed', icon: '🔒', title: 'Fixed game', sub: 'One game for the whole session' },
  { id: 'dealers', icon: '🎲', title: "Dealer's choice", sub: 'Whoever has the dealer button picks the next game' },
];
const STACKS = [1000, 5000, 10000, 25000, 100000];

export function CreateRoom() {
  const profile = useStore((s) => s.profile);
  const toast = useStore((s) => s.toast);
  const [s, setS] = useState<RoomSettings>({ ...DEFAULT_SETTINGS, name: profile ? `${profile.name}'s table` : DEFAULT_SETTINGS.name });
  const [busy, setBusy] = useState(false);
  const tp = VARIANTS[s.game.variant].family === 'teenpatti';
  const set = (p: Partial<RoomSettings>) => setS((x) => ({ ...x, ...p }));

  const create = async () => {
    if (!profile) return navigate('/');
    setBusy(true);
    if (!socket.connected) socket.connect();
    const r = await request<{ code: string; token: string; playerId: string }>('room:create', { profile: await toServerProfile(profile), settings: s });
    setBusy(false);
    if (!r.ok || !r.data) return toast(r.error ?? 'Could not create room', 'error');
    setRoomToken(r.data.code, { token: r.data.token, playerId: r.data.playerId, name: s.name });
    navigate(`/r/${r.data.code}`);
  };

  const num = (v: string) => Number(v.replace(/\D/g, '')) || 0;

  return (
    <div className="screen">
      <div className="page-head">
        <button className="icon-btn" onClick={() => navigate('/')} aria-label="Back">
          <IconBack />
        </button>
        <h1>Create a room</h1>
      </div>
      <div className="create">
        <div className="card-panel section">
          <div className="field">
            <label>Room name</label>
            <input className="input" value={s.name} maxLength={40} onChange={(e) => set({ name: e.target.value })} />
          </div>
        </div>
        <div className="card-panel section">
          <h3>Room type</h3>
          <div className="mode-grid">
            {MODES.map((m) => (
              <button key={m.id} className={cls('mode-card', s.mode === m.id && 'on')} onClick={() => set({ mode: m.id })}>
                <span className="mc-icon">{m.icon}</span>
                <span>
                  <b>{m.title}</b>
                  <span>{m.sub}</span>
                </span>
              </button>
            ))}
          </div>
        </div>
        <div className="card-panel section">
          <h3>{s.mode === 'fixed' ? 'Game' : 'Starting game'}</h3>
          <GamePicker value={s.game} onChange={(game) => set({ game })} />
        </div>
        <div className="card-panel section">
          <h3>Stakes</h3>
          {tp ? (
            <div className="grid3">
              <div className="field">
                <label>Boot</label>
                <input className="input num" inputMode="numeric" value={s.boot} onChange={(e) => set({ boot: num(e.target.value) })} />
              </div>
              <div className="field">
                <label>Chaal limit ×</label>
                <input className="input num" inputMode="numeric" value={s.maxStakeMult} onChange={(e) => set({ maxStakeMult: num(e.target.value) })} />
              </div>
              <div className="field">
                <label>Pot limit ×</label>
                <input className="input num" inputMode="numeric" value={s.potLimitMult} onChange={(e) => set({ potLimitMult: num(e.target.value) })} />
              </div>
            </div>
          ) : (
            <div className="grid3">
              <div className="field">
                <label>Small blind</label>
                <input className="input num" inputMode="numeric" value={s.sb} onChange={(e) => set({ sb: num(e.target.value) })} />
              </div>
              <div className="field">
                <label>Big blind</label>
                <input className="input num" inputMode="numeric" value={s.bb} onChange={(e) => set({ bb: num(e.target.value) })} />
              </div>
              <div className="field">
                <label>Ante</label>
                <input className="input num" inputMode="numeric" value={s.ante} onChange={(e) => set({ ante: num(e.target.value) })} />
              </div>
            </div>
          )}
          <div className="label">Chips per bank</div>
          <div className="recent">
            {STACKS.map((v) => (
              <button key={v} className={cls('chip-btn', s.startingStack === v && 'on')} onClick={() => set({ startingStack: v })}>
                {chips(v)}
              </button>
            ))}
          </div>
          <input className="input num" inputMode="numeric" value={s.startingStack} onChange={(e) => set({ startingStack: num(e.target.value) })} />
        </div>
        <div className="card-panel section">
          <h3>Table</h3>
          <div className="field">
            <label>Seats</label>
            <div className="stepper">
              <button onClick={() => set({ maxSeats: Math.max(2, s.maxSeats - 1) })}>−</button>
              <div className="val">{s.maxSeats} players</div>
              <button onClick={() => set({ maxSeats: Math.min(10, s.maxSeats + 1) })}>+</button>
            </div>
          </div>
          <div className="field">
            <label>Turn timer</label>
            <div className="seg">
              {[15, 20, 30, 45, 60].map((t) => (
                <button key={t} className={cls(s.actionTime === t && 'on')} onClick={() => set({ actionTime: t })}>
                  {t}s
                </button>
              ))}
            </div>
          </div>
          <div className="setting-row">
            <div className="sr-text">
              <b>Allow new banks</b>
              <span>When you bust, take bank #2, #3… (all counted in the ledger)</span>
            </div>
            <button className={cls('toggle', s.rebuy && 'on')} onClick={() => set({ rebuy: !s.rebuy })} />
          </div>
        </div>
      </div>
      <div className="sticky-cta">
        <button className="btn btn-gold btn-block" disabled={busy} onClick={create}>
          {busy ? 'Creating…' : 'Create room & get code'}
        </button>
      </div>
    </div>
  );
}
