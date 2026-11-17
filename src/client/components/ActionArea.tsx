import { AnimatePresence, motion } from 'framer-motion';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Card as CardT } from '../../shared/cards';
import { bestHigh, describePartial } from '../../shared/eval';
import type { FlopAction, FlopHandView, FlopLegal, TPAction, TPHandView } from '../../shared/engine';
import { potFractionRaiseTo } from '../../shared/engine/flopHand';
import type { RoomView } from '../../shared/protocol';
import { VARIANTS } from '../../shared/variants';
import { derive } from '../lib/derive';
import { chips, chipsShort, cls, seconds } from '../lib/format';
import { useNow } from '../lib/hooks';
import { request } from '../lib/socket';
import { useStore } from '../lib/store';
import { sfx, vibrate } from '../lib/sound';

type Pre = 'checkfold' | 'check' | 'callany' | null;

function useAct(handId: number) {
  const [busy, setBusy] = useState(false);
  const toast = useStore((s) => s.toast);
  const act = useCallback(
    async (action: FlopAction | TPAction) => {
      if (busy) return;
      setBusy(true);
      const r = await request('game:act', { handId, action });
      setBusy(false);
      if (!r.ok) toast(r.error ?? 'Action failed', 'error');
    },
    [busy, handId, toast],
  );
  return { act, busy };
}

export function ActionArea({ view, selected, clearSelected }: { view: RoomView; selected: Set<CardT>; clearSelected: () => void }) {
  const d = derive(view);
  const { hand, me } = d;
  const toast = useStore((s) => s.toast);
  const now = useNow(!!view.deadline || !!view.nextHandAt, 250);

  // "your turn" chime + vibration
  const turnKey = d.myTurn ? `${hand?.handId}-${view.deadline}` : '';
  useEffect(() => {
    if (turnKey) {
      sfx.turn();
      vibrate([30, 60, 30]);
    }
  }, [turnKey]);

  // ticking in the last 5 seconds of your turn
  const remaining = view.deadline ? view.deadline - now : 0;
  const tickSec = d.myTurn && remaining > 0 && remaining < 5500 ? seconds(remaining) : 0;
  useEffect(() => {
    if (tickSec > 0) sfx.tick();
  }, [tickSec]);

  if (!me) return <div className="action-area" />;

  const run = async (event: Parameters<typeof request>[0], payload?: unknown) => {
    const r = await request(event, payload);
    if (!r.ok) toast(r.error ?? 'Something went wrong', 'error');
    return r.ok;
  };

  // ---------------------------------------------------------------- not seated
  if (me.seat === null) {
    const free = Array.from({ length: view.settings.maxSeats }, (_, i) => i).filter((s) => !view.players.some((p) => p.seat === s));
    const full = view.players.filter((p) => p.seat !== null).length >= view.capacity;
    return (
      <div className="action-area">
        <div className="status-line">{full ? 'Table is full — you are watching' : 'Tap a glowing seat to sit down'}</div>
        <div className="act-row one">
          <button className="btn btn-gold" disabled={full || !free.length} onClick={() => run('seat:take', { seat: free[0] })}>
            Sit anywhere · {chips(view.settings.startingStack)} chips
          </button>
        </div>
      </div>
    );
  }

  const heroHp = d.heroHp;
  const dealtLive = d.running && heroHp && !heroHp.folded;
  const minChips = VARIANTS[view.settings.game.variant].family === 'teenpatti' ? view.settings.boot : view.settings.bb;

  // ---------------------------------------------------------------- busted / sitting out / lobby
  if (!dealtLive) {
    const busted = me.stack < minChips && !(d.running && heroHp);
    const status = (() => {
      if (view.handOver && view.nextHandAt) return `Next hand in ${seconds(view.nextHandAt - now)}s`;
      if (d.running && heroHp?.folded) return 'You folded — waiting for the hand to finish';
      if (d.running) return 'You will be dealt in next hand';
      return '';
    })();

    let main: React.ReactNode = null;
    if (busted) {
      const canRebuy = view.settings.rebuy && (view.settings.maxBanks === 0 || me.banks < view.settings.maxBanks);
      main = (
        <>
          <div className="status-line">
            {me.rebuyPending ? 'New bank will be added after this hand' : `You're out of chips · ${me.banks} bank${me.banks === 1 ? '' : 's'} used`}
          </div>
          <div className="act-row two">
            <button className="btn btn-glass" onClick={() => run('seat:leave')}>
              Stand up
            </button>
            <button className="btn btn-gold" disabled={!canRebuy || me.rebuyPending} onClick={() => run('player:rebuy')}>
              {canRebuy ? `Take bank #${me.banks + 1}` : 'Bank limit reached'}
            </button>
          </div>
        </>
      );
    } else if (me.sittingOut) {
      main = (
        <>
          <div className="status-line">You are sitting out</div>
          <div className="act-row two">
            <button className="btn btn-glass" onClick={() => run('seat:leave')}>
              Stand up
            </button>
            <button className="btn btn-gold" onClick={() => run('player:sitout', { value: false })}>
              I'm back
            </button>
          </div>
        </>
      );
    } else if (!view.started) {
      const ready = view.players.filter((p) => p.seat !== null && p.stack > 0).length;
      main = d.isHost ? (
        <>
          <div className="status-line">{ready < 2 ? 'Invite at least one friend to start' : `${ready} players ready`}</div>
          <div className="act-row two">
            <button className="btn btn-glass" onClick={() => useStore.getState().openSheet('invite')}>
              Invite
            </button>
            <button className="btn btn-gold" disabled={ready < 2} onClick={() => run('host:start')}>
              Start game
            </button>
          </div>
        </>
      ) : (
        <div className="status-line" style={{ minHeight: 60 }}>
          Waiting for the host to start the game…
        </div>
      );
    } else if (view.paused && !d.running) {
      main = d.isHost ? (
        <>
          <div className="status-line">Game paused</div>
          <div className="act-row one">
            <button className="btn btn-gold" onClick={() => run('host:start')}>
              Resume game
            </button>
          </div>
        </>
      ) : (
        <div className="status-line" style={{ minHeight: 60 }}>
          The host paused the game
        </div>
      );
    } else {
      const canShow = view.handOver && heroHp && !heroHp.shown && (heroHp.hole?.length ?? 0) > 0;
      main = (
        <>
          <div className="status-line">{status || view.notice || 'Waiting for the next hand'}</div>
          <div className="act-row two">
            <button className="btn btn-glass" onClick={() => run('player:sitout', { value: true })}>
              Sit out
            </button>
            {canShow ? (
              <button className="btn btn-glass" onClick={() => run('game:show', { handId: hand!.handId })}>
                Show my cards
              </button>
            ) : (
              <button className="btn btn-glass" onClick={() => useStore.getState().openSheet('chat')}>
                Chat & stickers
              </button>
            )}
          </div>
        </>
      );
    }
    return (
      <div className="action-area">
        {view.chooser && view.chooser.playerId === me.id && <div className="status-line gold">Your deal — pick the game!</div>}
        {main}
      </div>
    );
  }

  if (hand!.family === 'flop') return <FlopActions view={view} hand={hand as FlopHandView} now={now} selected={selected} clearSelected={clearSelected} />;
  return <TPActions view={view} hand={hand as TPHandView} now={now} />;
}

// ==================================================================== community-card games

function strengthFor(hand: FlopHandView, hole: CardT[] | null): string {
  if (!hole || hole.length === 0) return '';
  const info = VARIANTS[hand.game.variant];
  const board = hand.boards[0] ?? [];
  if (board.length >= 3) {
    const keepingAll = info.rule === 'holdem' && hole.length > 2;
    const v = bestHigh(hole, board, info.rule, info.mode);
    if (!v) return '';
    return keepingAll ? v.name : v.name;
  }
  if (info.rule === 'omaha' || hole.length > 2) return '';
  return describePartial(hole);
}

function TimerBar({ deadline, total, now }: { deadline: number | null; total: number; now: number }) {
  if (!deadline) return <div className="timer-bar" style={{ visibility: 'hidden' }} />;
  const frac = Math.max(0, Math.min(1, (deadline - now) / total));
  return (
    <div className="timer-bar">
      <div style={{ transform: `scaleX(${frac})`, transition: 'transform 0.25s linear', background: frac < 0.25 ? 'linear-gradient(90deg,#e11d48,#fb923c)' : undefined }} />
    </div>
  );
}

function FlopActions({ view, hand, now, selected, clearSelected }: { view: RoomView; hand: FlopHandView; now: number; selected: Set<CardT>; clearSelected: () => void }) {
  const d = derive(view);
  const me = d.me!;
  const hp = hand.players.find((p) => p.id === me.id)!;
  const legal = hand.legal;
  const { act, busy } = useAct(hand.handId);
  const [pre, setPre] = useState<Pre>(null);
  const [raising, setRaising] = useState(false);
  const [confirmFold, setConfirmFold] = useState(false);
  const toast = useStore((s) => s.toast);
  const streetKey = `${hand.handId}-${hand.street}`;

  useEffect(() => {
    setPre(null);
    setRaising(false);
  }, [streetKey]);

  // facing a new bet cancels a plain "check" pre-action
  const toCallNow = Math.max(0, hand.currentBet - hp.streetBet);
  useEffect(() => {
    if (pre === 'check' && toCallNow > 0) setPre(null);
  }, [toCallNow, pre]);

  // fire pre-actions when the turn arrives
  useEffect(() => {
    if (!legal || !pre) return;
    const p = pre;
    setPre(null);
    if (p === 'checkfold') void act(legal.canCheck ? { type: 'check' } : { type: 'fold' });
    else if (p === 'check' && legal.canCheck) void act({ type: 'check' });
    else if (p === 'callany') void act(legal.canCheck ? { type: 'check' } : { type: 'call' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [legal]);

  useEffect(() => {
    if (!confirmFold) return;
    const t = setTimeout(() => setConfirmFold(false), 2500);
    return () => clearTimeout(t);
  }, [confirmFold]);

  // keyboard shortcuts (desktop)
  useEffect(() => {
    if (!legal) return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.tagName === 'INPUT' || (e.target as HTMLElement)?.tagName === 'TEXTAREA') return;
      if (raising) return;
      if (e.key === 'f') void act({ type: 'fold' });
      else if (e.key === 'c' || e.key === 'k') void act(legal.canCheck ? { type: 'check' } : { type: 'call' });
      else if (e.key === 'r' && legal.canRaise) setRaising(true);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [legal, raising, act]);

  const strength = strengthFor(hand, hp.hole);
  const actingName = d.actingId ? view.players.find((p) => p.id === d.actingId)?.name : null;
  const totalMs = hand.awaiting.type === 'discard' ? Math.max(10, Math.min(view.settings.actionTime, 30)) * 1000 : view.settings.actionTime * 1000;

  // ---------------------------------------------------------------- discard step
  if (hand.awaiting.type === 'discard') {
    const need = hand.discardCount;
    const done = need === 0;
    const submit = async () => {
      const r = await request('game:discard', { handId: hand.handId, cards: [...selected] });
      if (!r.ok) toast(r.error ?? 'Could not discard', 'error');
      else clearSelected();
    };
    return (
      <div className="action-area">
        <TimerBar deadline={view.deadline} total={totalMs} now={now} />
        {done ? (
          <div className="status-line" style={{ minHeight: 60 }}>
            Waiting for others to discard…
          </div>
        ) : (
          <>
            <div className="discard-hint">
              Tap {need} card{need > 1 ? 's' : ''} to throw away · {strength}
            </div>
            <div className="act-row one">
              <button className="btn btn-gold" disabled={selected.size !== need} onClick={submit}>
                {selected.size === need ? `Discard ${need} & keep the rest` : `Select ${need - selected.size} more`}
              </button>
            </div>
          </>
        )}
      </div>
    );
  }

  // ---------------------------------------------------------------- my turn
  if (legal) {
    if (raising && legal.canRaise && hand.game.structure !== 'FL') {
      return (
        <div className="action-area">
          <RaisePanel hand={hand} legal={legal} busy={busy} onCancel={() => setRaising(false)} onConfirm={(to) => act({ type: 'raise', to }).then(() => setRaising(false))} />
        </div>
      );
    }
    const callIsAllIn = legal.canCall && legal.callAmount >= legal.stack;
    const raiseLabel = legal.isBet ? 'Bet' : 'Raise';
    const fixedRaise = hand.game.structure === 'FL' || legal.minRaiseTo === legal.maxRaiseTo;
    return (
      <div className="action-area">
        <TimerBar deadline={view.deadline} total={totalMs} now={now} />
        <div className="status-line">
          <b>Your turn</b>
          {strength && <span>· {strength}</span>}
        </div>
        <div className="act-row">
          <button
            className="btn-act btn-fold"
            disabled={busy}
            onClick={() => {
              if (legal.canCheck && !confirmFold) {
                setConfirmFold(true);
                return;
              }
              void act({ type: 'fold' });
            }}
          >
            {confirmFold ? 'Sure?' : 'Fold'}
            {confirmFold && <small>You can check</small>}
          </button>
          {legal.canCheck ? (
            <button className="btn-act btn-check" disabled={busy} onClick={() => act({ type: 'check' })}>
              Check
            </button>
          ) : (
            <button className={cls('btn-act', callIsAllIn ? 'btn-allin' : 'btn-call')} disabled={busy} onClick={() => act({ type: 'call' })}>
              {callIsAllIn ? 'All-in' : 'Call'}
              <small className="num">{chips(legal.callAmount)}</small>
            </button>
          )}
          {legal.canRaise ? (
            <button
              className={cls('btn-act', legal.minRaiseTo === legal.allInTo ? 'btn-allin' : 'btn-raise')}
              disabled={busy}
              onClick={() => (fixedRaise ? act({ type: 'raise', to: legal.minRaiseTo }) : setRaising(true))}
            >
              {legal.minRaiseTo === legal.allInTo ? 'All-in' : raiseLabel}
              <small className="num">{fixedRaise ? chips(legal.minRaiseTo) : `${chipsShort(legal.minRaiseTo)}+`}</small>
            </button>
          ) : (
            <button className="btn-act btn-neutral" disabled>
              {raiseLabel}
            </button>
          )}
        </div>
      </div>
    );
  }

  // ---------------------------------------------------------------- waiting: pre-actions
  const toCall = toCallNow;
  const canPre = !hp.allIn && d.running && hand.awaiting.type === 'action';
  return (
    <div className="action-area">
      <TimerBar deadline={null} total={1} now={now} />
      <div className="status-line">
        {strength && <b>{strength}</b>}
        {strength && actingName && <span>·</span>}
        {hp.allIn ? <span>You are all-in</span> : actingName ? <span>Waiting for {actingName}…</span> : <span>Dealing…</span>}
      </div>
      {canPre ? (
        <div className="pre-row">
          <PreBtn on={pre === 'checkfold'} onClick={() => setPre(pre === 'checkfold' ? null : 'checkfold')}>
            {toCall > 0 ? 'Fold' : 'Check / Fold'}
          </PreBtn>
          {toCall === 0 && (
            <PreBtn on={pre === 'check'} onClick={() => setPre(pre === 'check' ? null : 'check')}>
              Check
            </PreBtn>
          )}
          <PreBtn on={pre === 'callany'} onClick={() => setPre(pre === 'callany' ? null : 'callany')}>
            {toCall > 0 ? `Call ${chipsShort(Math.min(toCall, hp.stack))}` : 'Call any'}
          </PreBtn>
        </div>
      ) : (
        <div style={{ height: 46 }} />
      )}
    </div>
  );
}

function PreBtn({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button className={cls('pre-btn', on && 'on')} onClick={onClick}>
      <span className="box">{on ? '✓' : ''}</span>
      {children}
    </button>
  );
}

function RaisePanel({ hand, legal, busy, onCancel, onConfirm }: { hand: FlopHandView; legal: FlopLegal; busy: boolean; onCancel: () => void; onConfirm: (to: number) => void }) {
  const { minRaiseTo: min, maxRaiseTo: max } = legal;
  const bb = hand.stakes.bb;
  const span = Math.max(0, max - min);
  const step = span > bb * 20 ? bb : Math.max(1, hand.stakes.sb || 1);
  const [amount, setAmount] = useState(min);
  const trackRef = useRef<HTMLDivElement>(null);

  const clamp = (v: number) => Math.max(min, Math.min(max, v));
  const fromT = (t: number) => {
    if (t >= 0.999) return max;
    const raw = min + span * t * t;
    return clamp(Math.round(raw / step) * step);
  };
  const toT = (v: number) => (span === 0 ? 1 : Math.sqrt((v - min) / span));

  const presets = useMemo(() => {
    const list: { label: string; to: number }[] = [{ label: 'Min', to: min }];
    const unopenedPreflop = hand.street === 'preflop' && legal.currentBet <= bb;
    if (unopenedPreflop) {
      list.push({ label: '2.5×', to: clamp(Math.round(bb * 2.5)) });
      list.push({ label: '3×', to: clamp(bb * 3) });
    } else {
      list.push({ label: '½ Pot', to: potFractionRaiseTo(legal, 0.5) });
      list.push({ label: '¾ Pot', to: potFractionRaiseTo(legal, 0.75) });
    }
    list.push({ label: 'Pot', to: potFractionRaiseTo(legal, 1) });
    if (hand.game.structure === 'NL') list.push({ label: 'All-in', to: max });
    return list;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [legal]);

  const setFromPointer = (clientX: number) => {
    const el = trackRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const t = Math.max(0, Math.min(1, (clientX - r.left) / r.width));
    setAmount(fromT(t));
  };

  const isAllIn = amount === legal.allInTo;
  const label = isAllIn ? 'All-in' : legal.isBet ? 'Bet' : 'Raise to';
  const t = toT(amount);

  return (
    <motion.div className="raise-panel" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}>
      <div className="raise-top">
        <button className="step-btn" onClick={() => setAmount((a) => clamp(a - step))} aria-label="Less">
          −
        </button>
        <div className="raise-amount">
          <div className="ra-lbl">{label}</div>
          <div className="ra-val num">{chips(amount)}</div>
        </div>
        <button className="step-btn" onClick={() => setAmount((a) => clamp(a + step))} aria-label="More">
          +
        </button>
      </div>
      <div className="presets" style={{ gridTemplateColumns: `repeat(${presets.length}, 1fr)` }}>
        {presets.map((p) => (
          <button key={p.label} className={cls('preset', amount === p.to && 'on')} onClick={() => setAmount(p.to)}>
            {p.label}
          </button>
        ))}
      </div>
      <div
        className="slider-wrap"
        ref={trackRef}
        role="slider"
        aria-valuemin={min}
        aria-valuemax={max}
        aria-valuenow={amount}
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === 'ArrowRight' || e.key === 'ArrowUp') setAmount((a) => clamp(a + step));
          if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') setAmount((a) => clamp(a - step));
          if (e.key === 'Enter') onConfirm(amount);
          if (e.key === 'Escape') onCancel();
        }}
        onPointerDown={(e) => {
          (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
          setFromPointer(e.clientX);
        }}
        onPointerMove={(e) => {
          if (e.buttons === 0 && e.pointerType === 'mouse') return;
          if ((e.currentTarget as HTMLElement).hasPointerCapture(e.pointerId)) setFromPointer(e.clientX);
        }}
      >
        <div className="slider-track">
          <div className="slider-fill" style={{ width: `${t * 100}%` }} />
        </div>
        <div className="slider-thumb" style={{ left: `${t * 100}%` }} />
      </div>
      <div className="act-row" style={{ gridTemplateColumns: '1fr 2fr' }}>
        <button className="btn-act btn-neutral" onClick={onCancel}>
          Cancel
        </button>
        <button className={cls('btn-act', isAllIn ? 'btn-allin' : 'btn-raise')} disabled={busy} onClick={() => onConfirm(amount)}>
          {label === 'Raise to' ? 'Raise to' : label}
          <small className="num">{chips(amount)}</small>
        </button>
      </div>
    </motion.div>
  );
}

// ==================================================================== Teen Patti

function TPActions({ view, hand, now }: { view: RoomView; hand: TPHandView; now: number }) {
  const d = derive(view);
  const me = d.me!;
  const hp = hand.players.find((p) => p.id === me.id)!;
  const legal = hand.legal;
  const { act, busy } = useAct(hand.handId);
  const toast = useStore((s) => s.toast);
  const totalMs = hand.awaiting.type === 'sideshow' ? 15000 : view.settings.actionTime * 1000;
  const actingName = d.actingId ? view.players.find((p) => p.id === d.actingId)?.name : null;

  const see = async () => {
    const r = await request('game:see', { handId: hand.handId });
    if (!r.ok) toast(r.error ?? 'Could not look', 'error');
  };
  const answer = async (accept: boolean) => {
    const r = await request('game:sideshow', { handId: hand.handId, accept });
    if (!r.ok) toast(r.error ?? 'Failed', 'error');
  };

  const sideshowForMe = hand.awaiting.type === 'sideshow' && hand.awaiting.playerId === me.id;
  const requester = hand.sideshow ? view.players.find((p) => p.id === hand.sideshow!.from)?.name : '';

  const seeRow = !hp.seen && !hp.allIn && (
    <div className="act-row one" style={{ marginBottom: 8 }}>
      <button className="btn-act btn-see" style={{ height: 44 }} onClick={see}>
        👀 See cards
      </button>
    </div>
  );

  return (
    <div className="action-area">
      <TimerBar deadline={legal || sideshowForMe ? view.deadline : null} total={totalMs} now={now} />
      <div className="status-line">
        {hand.myHandName && <b>{hand.myHandName}</b>}
        {hand.myHandName && <span>·</span>}
        {legal ? (
          <span>
            <b>Your turn</b> · {hp.seen ? 'Seen' : 'Blind'}
          </span>
        ) : hand.awaiting.type === 'sideshow' ? (
          <span>Side show in progress…</span>
        ) : hp.allIn ? (
          <span>You are all-in</span>
        ) : actingName ? (
          <span>Waiting for {actingName}…</span>
        ) : (
          <span>Showdown…</span>
        )}
      </div>
      {seeRow}
      {legal ? (
        <div className={cls('act-row', (legal.canShow || legal.canSideshow) && !legal.finalCall && 'four', legal.finalCall && 'two')}>
          <button className="btn-act btn-fold" disabled={busy} onClick={() => act({ type: 'pack' })}>
            Pack
          </button>
          {legal.canChaal && (
            <button className={cls('btn-act', legal.chaalIsAllIn ? 'btn-allin' : 'btn-call')} disabled={busy} onClick={() => act({ type: 'chaal' })}>
              {legal.chaalIsAllIn ? 'All-in' : legal.seen ? 'Chaal' : 'Blind'}
              <small className="num">{chipsShort(legal.chaalAmount)}</small>
            </button>
          )}
          {!legal.finalCall && (
            <button className="btn-act btn-raise" disabled={busy || !legal.canRaise} onClick={() => act({ type: 'raise' })}>
              Raise
              <small className="num">{chipsShort(legal.raiseAmount)}</small>
            </button>
          )}
          {legal.canShow && (
            <button className="btn-act btn-show" disabled={busy} onClick={() => act({ type: 'show' })}>
              Show
              <small className="num">{chipsShort(legal.showAmount)}</small>
            </button>
          )}
          {!legal.canShow && legal.canSideshow && (
            <button className="btn-act btn-see" disabled={busy} onClick={() => act({ type: 'sideshow' })}>
              Side show
              <small className="num">{chipsShort(legal.chaalAmount)}</small>
            </button>
          )}
        </div>
      ) : (
        !seeRow && <div style={{ height: 46 }} />
      )}
      <AnimatePresence>
        {sideshowForMe && (
          <div className="modal-wrap">
            <motion.div className="modal" initial={{ opacity: 0, scale: 0.85 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.9 }}>
              <div style={{ fontSize: 40 }}>🤝</div>
              <h3>{requester} asks for a side show</h3>
              <p className="muted" style={{ fontSize: 14, margin: '0 0 16px' }}>
                You both see each other's cards. The weaker hand packs{hp.seen ? '' : ' (you will see your cards)'}.
              </p>
              <div className="act-row two">
                <button className="btn-act btn-fold" onClick={() => answer(false)}>
                  Deny
                </button>
                <button className="btn-act btn-call" onClick={() => answer(true)}>
                  Accept
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
