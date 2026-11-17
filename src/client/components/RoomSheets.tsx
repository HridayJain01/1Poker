import { useEffect, useState } from 'react';
import type { RoomSettings, RoomView } from '../../shared/protocol';
import { GameConfig, gameLabel, VARIANTS } from '../../shared/variants';
import { Sheet } from './Sheet';
import { GamePicker } from './GamePicker';
import { ProfileEditor } from './ProfileEditor';
import { Card } from './Card';
import { useStore } from '../lib/store';
import { request } from '../lib/socket';
import { chips, cls, signed } from '../lib/format';
import { toServerProfile, TableTheme } from '../lib/profile';

const run = async (event: Parameters<typeof request>[0], payload?: unknown) => {
  const r = await request(event, payload);
  if (!r.ok) useStore.getState().toast(r.error ?? 'Failed', 'error');
  return r.ok;
};

function Toggle({ on, onClick }: { on: boolean; onClick: () => void }) {
  return <button className={cls('toggle', on && 'on')} onClick={onClick} aria-pressed={on} />;
}

export function RoomSheets({ view, onLeave }: { view: RoomView; onLeave: () => void }) {
  const sheet = useStore((s) => s.sheet);
  const openSheet = useStore((s) => s.openSheet);
  const close = () => openSheet(null);
  const isHost = view.hostId === view.you;
  const me = view.players.find((p) => p.id === view.you);

  return (
    <>
      <Sheet open={sheet === 'menu'} onClose={close} title="Menu">
        <div className="sheet-body">
          {[
            ['📨', 'Invite friends', `Room code ${view.code}`, 'invite'],
            ['📒', 'Ledger & banks', 'Who is up, who is down', 'ledger'],
            ['🕘', 'Hand history', `${view.history.length} recent hands`, 'history'],
            ...(isHost ? [['👑', 'Host controls', 'Game, blinds, players', 'host']] : []),
            ['⚙️', 'Settings', 'Sound, cards, table color', 'settings'],
            ['🙂', 'Edit profile', 'Name, selfie or avatar', 'profile'],
          ].map(([icon, title, sub, target]) => (
            <button key={target} className="list-item" onClick={() => openSheet(target as never)}>
              <span className="li-icon">{icon}</span>
              <span>
                {title}
                <span className="li-sub">{sub}</span>
              </span>
            </button>
          ))}
          {me?.seat !== null && me?.seat !== undefined && (
            <button className="list-item" onClick={() => run('player:sitout', { value: !me.sittingOut }).then(close)}>
              <span className="li-icon">{me.sittingOut ? '▶️' : '⏸️'}</span>
              <span>{me.sittingOut ? "I'm back" : 'Sit out next hands'}</span>
            </button>
          )}
          {me?.seat !== null && me?.seat !== undefined && (
            <button className="list-item" onClick={() => run('seat:leave').then(close)}>
              <span className="li-icon">🪑</span>
              <span>
                Stand up
                <span className="li-sub">Keep your chips, watch the game</span>
              </span>
            </button>
          )}
          <button className="list-item" onClick={onLeave}>
            <span className="li-icon">🚪</span>
            <span style={{ color: 'var(--red)' }}>Leave room</span>
          </button>
        </div>
      </Sheet>

      <InviteSheet view={view} open={sheet === 'invite'} onClose={close} />
      <LedgerSheet view={view} open={sheet === 'ledger'} onClose={close} />
      {isHost && <HostSheet view={view} open={sheet === 'host'} onClose={close} />}
      <SettingsSheet open={sheet === 'settings'} onClose={close} />
      <Sheet open={sheet === 'profile'} onClose={close} title="Your profile">
        <div className="sheet-body">
          <ProfileEditor
            initial={useStore.getState().profile}
            onSave={async (p) => {
              useStore.getState().setProfile(p);
              await run('player:profile', await toServerProfile(p));
              close();
            }}
          />
        </div>
      </Sheet>
      <Sheet open={sheet === 'history'} onClose={close} title="Hand history">
        <div className="sheet-body">
          {view.history.length === 0 && <p className="muted">No hands played yet.</p>}
          {view.history.map((h) => (
            <div key={h.handNumber} className="hist-item">
              <div className="hi-top">
                <span>
                  #{h.handNumber} · {gameLabel(h.game)}
                </span>
                <span className="num">Pot {chips(h.potTotal)}</span>
              </div>
              {h.winners.map((w) => (
                <div key={w.id} className="hi-win">
                  🏆 {w.name} +{chips(w.amount)} {w.hand ? <span className="muted">· {w.hand}</span> : h.byFold ? <span className="muted">· no showdown</span> : null}
                </div>
              ))}
              {h.boards.map((b, i) => (
                <div key={i} className="mini-board">
                  {b.map((c) => (
                    <Card key={c} card={c} w={26} />
                  ))}
                </div>
              ))}
            </div>
          ))}
        </div>
      </Sheet>
    </>
  );
}

function InviteSheet({ view, open, onClose }: { view: RoomView; open: boolean; onClose: () => void }) {
  const toast = useStore((s) => s.toast);
  const url = `${location.origin}/r/${view.code}`;
  const share = async () => {
    const text = `Join my poker table "${view.settings.name}" on 1Poker — code ${view.code}`;
    if (navigator.share) {
      try {
        await navigator.share({ title: '1Poker', text, url });
        return;
      } catch {
        /* cancelled */
      }
    }
    await navigator.clipboard?.writeText(`${text}\n${url}`).catch(() => undefined);
    toast('Invite link copied', 'success');
  };
  return (
    <Sheet open={open} onClose={onClose} title="Invite friends">
      <div className="sheet-body center">
        <div className="label">Room code</div>
        <div className="lobby-card" style={{ margin: '8px auto 14px', display: 'inline-block' }}>
          <div className="lc-code">{view.code}</div>
        </div>
        <p className="muted" style={{ fontSize: 13, wordBreak: 'break-all' }}>
          {url}
        </p>
        <button className="btn btn-gold btn-block" onClick={share}>
          Share invite link
        </button>
        <button
          className="btn btn-glass btn-block"
          style={{ marginTop: 10 }}
          onClick={() => navigator.clipboard?.writeText(view.code).then(() => toast('Code copied', 'success'))}
        >
          Copy code
        </button>
      </div>
    </Sheet>
  );
}

/** Minimal set of transfers so everyone ends up square. */
function settle(rows: { name: string; net: number }[]) {
  const debt = rows.filter((r) => r.net < 0).map((r) => ({ ...r, left: -r.net }));
  const cred = rows.filter((r) => r.net > 0).map((r) => ({ ...r, left: r.net }));
  const out: { from: string; to: string; amount: number }[] = [];
  let i = 0;
  let j = 0;
  while (i < debt.length && j < cred.length) {
    const a = Math.min(debt[i].left, cred[j].left);
    if (a > 0) out.push({ from: debt[i].name, to: cred[j].name, amount: a });
    debt[i].left -= a;
    cred[j].left -= a;
    if (debt[i].left === 0) i++;
    if (cred[j].left === 0) j++;
  }
  return out;
}

function LedgerSheet({ view, open, onClose }: { view: RoomView; open: boolean; onClose: () => void }) {
  const transfers = settle(view.ledger);
  return (
    <Sheet open={open} onClose={onClose} title="Ledger">
      <div className="sheet-body">
        <p className="muted" style={{ fontSize: 13, marginTop: 0 }}>
          Every bank is {chips(view.settings.startingStack)} chips. Stacks update after each hand.
        </p>
        <table className="ledger-table">
          <thead>
            <tr>
              <th>Player</th>
              <th>Banks</th>
              <th>In</th>
              <th>Stack</th>
              <th>Net</th>
            </tr>
          </thead>
          <tbody>
            {view.ledger.map((r) => (
              <tr key={r.id}>
                <td>
                  {r.name}
                  {r.left ? <span className="muted"> (left)</span> : ''}
                </td>
                <td>#{r.banks}</td>
                <td>{chips(r.boughtIn)}</td>
                <td>{chips(r.stack)}</td>
                <td className={r.net > 0 ? 'pos' : r.net < 0 ? 'neg' : ''}>{signed(r.net)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {transfers.length > 0 && (
          <>
            <div className="section-label">Settle up</div>
            <div className="settle">
              {transfers.map((t, i) => (
                <div key={i} className="settle-row">
                  <b>{t.from}</b> → <b>{t.to}</b>
                  <span className="spacer" />
                  <span className="gold num">{chips(t.amount)}</span>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </Sheet>
  );
}

function NumField({ label, value, onChange }: { label: string; value: number; onChange: (n: number) => void }) {
  return (
    <div className="field">
      <label>{label}</label>
      <input className="input num" inputMode="numeric" value={value} onChange={(e) => onChange(Number(e.target.value.replace(/\D/g, '')) || 0)} />
    </div>
  );
}

function HostSheet({ view, open, onClose }: { view: RoomView; open: boolean; onClose: () => void }) {
  const [s, setS] = useState<RoomSettings>(view.settings);
  const [game, setGame] = useState<GameConfig>(view.pendingGame ?? view.settings.game);
  useEffect(() => {
    if (open) {
      setS(view.settings);
      setGame(view.pendingGame ?? view.settings.game);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  const seated = view.players.filter((p) => p.seat !== null).length;
  const canSwitch = view.settings.mode === 'custom' || view.handNumber === 0;
  const tp = VARIANTS[game.variant].family === 'teenpatti';
  const toast = useStore((st) => st.toast);

  const save = async () => {
    if (canSwitch && JSON.stringify(game) !== JSON.stringify(view.pendingGame ?? view.settings.game)) {
      if (!(await run('host:game', { game }))) return;
    }
    const { game: _g, ...rest } = s;
    void _g;
    if (await run('host:settings', rest)) {
      toast('Saved', 'success');
      onClose();
    }
  };

  return (
    <Sheet open={open} onClose={onClose} title="Host controls" tall>
      <div className="sheet-body" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div className="row">
          {!view.started || view.paused ? (
            <button className="btn btn-gold" style={{ flex: 1 }} onClick={() => run('host:start').then(onClose)}>
              {view.started ? 'Resume game' : 'Start game'}
            </button>
          ) : (
            <button className="btn btn-glass" style={{ flex: 1 }} onClick={() => run('host:pause')}>
              Pause after this hand
            </button>
          )}
        </div>

        <div className="field">
          <label>Room mode</label>
          <div className="seg">
            {(['fixed', 'custom', 'dealers'] as const).map((m) => (
              <button key={m} className={cls(s.mode === m && 'on')} onClick={() => setS({ ...s, mode: m })}>
                {m === 'fixed' ? 'Fixed' : m === 'custom' ? 'Custom' : "Dealer's pick"}
              </button>
            ))}
          </div>
        </div>

        <div className="field">
          <label>Game {view.pendingGame ? `(next hand: ${gameLabel(view.pendingGame)})` : ''}</label>
          {canSwitch ? (
            <GamePicker value={game} onChange={setGame} players={seated} />
          ) : (
            <p className="blurb">{view.settings.mode === 'fixed' ? 'This room is locked to one game. Switch the mode to Custom to change it.' : 'In dealer\'s pick, the dealer chooses each hand.'}</p>
          )}
        </div>

        {tp ? (
          <div className="grid3">
            <NumField label="Boot" value={s.boot} onChange={(boot) => setS({ ...s, boot })} />
            <NumField label="Chaal limit ×" value={s.maxStakeMult} onChange={(maxStakeMult) => setS({ ...s, maxStakeMult })} />
            <NumField label="Pot limit ×" value={s.potLimitMult} onChange={(potLimitMult) => setS({ ...s, potLimitMult })} />
          </div>
        ) : (
          <div className="grid3">
            <NumField label="Small blind" value={s.sb} onChange={(sb) => setS({ ...s, sb })} />
            <NumField label="Big blind" value={s.bb} onChange={(bb) => setS({ ...s, bb })} />
            <NumField label="Ante" value={s.ante} onChange={(ante) => setS({ ...s, ante })} />
          </div>
        )}
        <div className="grid2">
          <NumField label="Chips per bank" value={s.startingStack} onChange={(startingStack) => setS({ ...s, startingStack })} />
          <NumField label="Max banks (0 = ∞)" value={s.maxBanks} onChange={(maxBanks) => setS({ ...s, maxBanks })} />
        </div>
        <div className="field">
          <label>Turn timer</label>
          <div className="seg">
            {[15, 20, 30, 45, 60].map((t) => (
              <button key={t} className={cls(s.actionTime === t && 'on')} onClick={() => setS({ ...s, actionTime: t })}>
                {t}s
              </button>
            ))}
          </div>
        </div>
        <div className="setting-row">
          <div className="sr-text">
            <b>Allow new banks</b>
            <span>Busted players can take another bank</span>
          </div>
          <Toggle on={s.rebuy} onClick={() => setS({ ...s, rebuy: !s.rebuy })} />
        </div>
        <button className="btn btn-gold btn-block" onClick={save}>
          Save changes
        </button>

        <div className="section-label">Players</div>
        {view.players
          .filter((p) => p.id !== view.you)
          .map((p) => (
            <div key={p.id} className="setting-row">
              <div className="sr-text">
                <b>{p.name}</b>
                <span>{p.seat !== null ? `Seat ${p.seat + 1} · ${chips(p.stack)}` : 'Watching'}</span>
              </div>
              <button className="btn btn-glass btn-sm" onClick={() => run('host:transfer', { playerId: p.id })}>
                Make host
              </button>
              <button className="btn btn-danger btn-sm" onClick={() => confirm(`Remove ${p.name}?`) && run('host:kick', { playerId: p.id })}>
                Remove
              </button>
            </div>
          ))}
      </div>
    </Sheet>
  );
}

function SettingsSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const settings = useStore((s) => s.settings);
  const update = useStore((s) => s.updateSettings);
  const rows: [keyof typeof settings, string, string][] = [
    ['sound', 'Sound effects', 'Cards, chips and alerts'],
    ['voiceAutoplay', 'Auto-play voice & sound stickers', 'Hear them the moment they arrive'],
    ['speech', 'Speak phrases aloud', '"All in!", "Ship it!"…'],
    ['fourColor', 'Four-color deck', 'Blue diamonds, green clubs'],
    ['haptics', 'Vibrate on your turn', 'Android phones'],
  ];
  return (
    <Sheet open={open} onClose={onClose} title="Settings">
      <div className="sheet-body" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {rows.map(([k, title, sub]) => (
          <div key={k} className="setting-row">
            <div className="sr-text">
              <b>{title}</b>
              <span>{sub}</span>
            </div>
            <Toggle on={!!settings[k]} onClick={() => update({ [k]: !settings[k] })} />
          </div>
        ))}
        <div className="field">
          <label>Table color</label>
          <div className="seg">
            {(['emerald', 'royal', 'crimson', 'midnight'] as TableTheme[]).map((t) => (
              <button key={t} className={cls(settings.theme === t && 'on')} onClick={() => update({ theme: t })}>
                {t[0].toUpperCase() + t.slice(1)}
              </button>
            ))}
          </div>
        </div>
      </div>
    </Sheet>
  );
}
