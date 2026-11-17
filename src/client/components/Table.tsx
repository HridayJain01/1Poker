import { AnimatePresence, motion } from 'framer-motion';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { Card as CardT } from '../../shared/cards';
import type { RoomView } from '../../shared/protocol';
import { gameLabel } from '../../shared/variants';
import { bus } from '../lib/bus';
import { derive } from '../lib/derive';
import { chips, chipsShort } from '../lib/format';
import { useSize } from '../lib/hooks';
import { CENTER, seatPositions, towards } from '../lib/layout';
import { request } from '../lib/socket';
import { useStore } from '../lib/store';
import { Card } from './Card';
import { ChipStack, chipColors } from './Chips';
import { Seat } from './Seat';
import { BubbleLayer } from './BubbleLayer';

interface Fly {
  id: number;
  from: { x: number; y: number };
  to: { x: number; y: number };
  color: string;
  delay: number;
}

let flyId = 1;

export function Table({ view, selected, onToggleCard }: { view: RoomView; selected: Set<CardT>; onToggleCard: (c: CardT) => void }) {
  const [ref, size] = useSize<HTMLDivElement>();
  const d = derive(view);
  const { hand, me } = d;
  const landscape = size.w > size.h * 1.08;
  const heroSeat = me?.seat ?? null;
  const positions = useMemo(() => seatPositions(view.settings.maxSeats, heroSeat, landscape), [view.settings.maxSeats, heroSeat, landscape]);
  const px = (pt: { x: number; y: number }) => ({ x: (pt.x / 100) * size.w, y: (pt.y / 100) * size.h });
  const center = px(CENTER);
  const potRef = useRef<HTMLDivElement>(null);
  const [flies, setFlies] = useState<Fly[]>([]);
  const openSheet = useStore((s) => s.openSheet);

  const seatPx = (seat: number) => px(positions[seat] ?? CENTER);
  const potPoint = () => {
    const el = potRef.current;
    const root = ref.current;
    if (el && root) {
      const a = el.getBoundingClientRect();
      const b = root.getBoundingClientRect();
      return { x: a.left - b.left + a.width / 2, y: a.top - b.top + a.height / 2 };
    }
    return { x: size.w / 2, y: size.h * 0.4 };
  };

  // Flying chips for Teen Patti bets and pots going to winners.
  const viewRef = useRef(view);
  viewRef.current = view;
  const sizeRef = useRef(size);
  sizeRef.current = size;
  const posRef = useRef(positions);
  posRef.current = positions;
  useEffect(() => {
    return bus.on('fx', ({ events }) => {
      const v = viewRef.current;
      const s = sizeRef.current;
      if (!s.w) return;
      const seatOf = (id: string) => v.players.find((p) => p.id === id)?.seat;
      const at = (seat: number) => {
        const pt = posRef.current[seat] ?? CENTER;
        return { x: (pt.x / 100) * s.w, y: (pt.y / 100) * s.h };
      };
      const add: Fly[] = [];
      const family = v.hand?.family;
      for (const e of events) {
        if (e.t === 'act' && family === 'teenpatti' && e.amount > 0) {
          const seat = seatOf(e.id);
          if (seat === undefined || seat === null) continue;
          const from = at(seat);
          const to = potPoint();
          chipColors(e.amount, 3).forEach((color, i) => add.push({ id: flyId++, from, to, color, delay: i * 0.05 }));
        }
        if (e.t === 'win') {
          const from = potPoint();
          Object.entries(e.totals).forEach(([id, amt], wi) => {
            if (amt <= 0) return;
            const seat = seatOf(id);
            if (seat === undefined || seat === null) return;
            const to = at(seat);
            chipColors(amt, 5).forEach((color, i) => add.push({ id: flyId++, from, to, color, delay: 0.35 + wi * 0.25 + i * 0.07 }));
          });
        }
      }
      if (add.length) setFlies((f) => [...f.slice(-40), ...add]);
    });
  }, []);

  const handId = hand?.handId ?? 0;
  const flop = hand?.family === 'flop' ? hand : null;
  const tp = hand?.family === 'teenpatti' ? hand : null;
  const boards = flop?.boards ?? [];
  const nBoards = boards.length;
  const feltW = size.w * (landscape ? 0.86 : 0.82);
  const boardW = Math.floor(Math.min(nBoards > 2 ? 34 : nBoards > 1 ? 40 : 50, (feltW - 46) / 5.6, size.h * (nBoards > 2 ? 0.06 : nBoards > 1 ? 0.075 : 0.095)));

  // hero cards
  const heroHole = d.heroHp?.hole ?? null;
  const heroCount = d.heroHp?.holeCount ?? 0;
  const heroLive = !!d.heroHp && !d.heroHp.folded;
  const heroPos = heroSeat !== null ? seatPx(heroSeat) : null;
  const baseHeroW = Math.round(Math.min(landscape ? 58 : 66, Math.max(42, size.h * (landscape ? 0.12 : 0.105))));
  const heroW = heroCount <= 3 ? baseHeroW : heroCount === 4 ? Math.round(baseHeroW * 0.88) : Math.round(baseHeroW * 0.8);
  const overlap = heroCount <= 3 ? -2 : heroCount === 4 ? heroW * 0.16 : heroW * 0.3;
  const heroCardsTop = heroPos ? heroPos.y - 26 - heroW * 1.4 : 0;
  const heroHalf = (heroCount * heroW - Math.max(0, heroCount - 1) * overlap * 2) / 2;
  const discarding = flop && flop.discardCount > 0;
  const tpBlind = tp && d.heroHp && !(d.heroHp as { seen: boolean }).seen && !heroHole;

  const timerTotal = (() => {
    if (!hand) return view.settings.actionTime * 1000;
    if (hand.awaiting.type === 'discard') return Math.max(10, Math.min(view.settings.actionTime, 30)) * 1000;
    if (hand.awaiting.type === 'sideshow') return 15000;
    return view.settings.actionTime * 1000;
  })();

  const seeCards = () => {
    if (tp) void request('game:see', { handId: tp.handId });
  };

  const label = hand ? gameLabel(hand.game) : gameLabel(view.pendingGame ?? view.settings.game);
  const showLobby = !view.started || (!hand && !view.chooser);

  return (
    <div className={`table-area ${landscape ? 'landscape' : ''}`} ref={ref}>
      <div className="felt-wrap">
        <div className="rim" />
        <div className="felt">
          <div className="felt-logo">1POKER</div>
          <div className="felt-game">{label}</div>
        </div>
      </div>

      {size.w > 0 && (
        <>
          {/* center: pot + boards */}
          {hand && (
            <div className="board-zone" style={{ top: nBoards > 1 ? '44%' : '45%' }}>
              <div className="pot num" ref={potRef}>
                <ChipStack amount={Math.max(1, (flop ? flop.pot : tp!.pot) || 1)} max={3} />
                <span className="lbl">Pot</span>
                {chips(flop ? (view.handOver ? flop.result?.potTotal ?? flop.pot : flop.pot) : tp!.pot)}
              </div>
              {flop && flop.potTotal > flop.pot && !view.handOver && <div className="pot-sub num">Total {chips(flop.potTotal)}</div>}
              {flop &&
                boards.map((b, bi) => (
                  <div className="board" key={bi}>
                    {nBoards > 1 && <span className="board-tag">{bi + 1}</span>}
                    {Array.from({ length: 5 }, (_, i) =>
                      b[i] ? (
                        <Card
                          key={`${handId}-${bi}-${b[i]}`}
                          card={b[i]}
                          w={boardW}
                          flipIn
                          delay={(i < 3 ? i * 0.09 : 0) + bi * 0.12}
                          highlight={view.handOver && d.highlight.has(b[i])}
                          dim={view.handOver && !!flop.result && !flop.result.byFold && d.highlight.size > 0 && !d.highlight.has(b[i])}
                        />
                      ) : (
                        <div key={`s${i}`} className="slot" style={{ width: boardW, height: boardW * 1.4 }} />
                      ),
                    )}
                  </div>
                ))}
              {tp && (
                <div className="stake-info num">
                  <span>Stake {chipsShort(tp.stake)}</span>
                  <span>Blind {chipsShort(tp.stake)}</span>
                  <span>Seen {chipsShort(tp.stake * 2)}</span>
                </div>
              )}
            </div>
          )}

          {/* lobby / notices */}
          {showLobby && (
            <div className="center-banner">
              <div className="lobby-card">
                <div className="label">Room code</div>
                <div className="lc-code">{view.code}</div>
                <div className="muted" style={{ fontSize: 12.5, margin: '6px 0 10px' }}>
                  {view.players.length} in room · {view.players.filter((p) => p.seat !== null).length}/{view.capacity} seated
                </div>
                <button className="btn btn-glass btn-sm btn-block" onClick={() => openSheet('invite')}>
                  Invite friends
                </button>
              </div>
            </div>
          )}
          {!showLobby && !d.running && view.chooser && (
            <div className="center-banner">
              <div className="notice-banner">
                🎲 {view.players.find((p) => p.id === view.chooser!.playerId)?.name ?? 'Dealer'} is choosing the game…
              </div>
            </div>
          )}
          {!showLobby && !hand && !view.chooser && view.notice && (
            <div className="center-banner">
              <div className="notice-banner">{view.notice}</div>
            </div>
          )}

          {/* seats */}
          {Array.from({ length: view.settings.maxSeats }, (_, seat) => {
            const pl = view.players.find((p) => p.seat === seat);
            const pos = seatPx(seat);
            if (!pl) {
              const canSit = !!me && me.seat === null && view.players.filter((p) => p.seat !== null).length < view.capacity;
              return (
                <div key={`e${seat}`} className="seat" style={{ left: pos.x, top: pos.y }}>
                  <button
                    className={`empty-seat ${canSit ? 'can' : ''}`}
                    disabled={!canSit}
                    onClick={async () => {
                      const r = await request('seat:take', { seat });
                      if (!r.ok) useStore.getState().toast(r.error ?? 'Could not sit', 'error');
                    }}
                    aria-label={`Seat ${seat + 1}`}
                  >
                    {canSit ? 'SIT' : seat + 1}
                  </button>
                </div>
              );
            }
            const hp = d.hp(pl.id);
            return (
              <Seat
                key={pl.id}
                player={pl}
                hp={hp}
                x={pos.x}
                y={pos.y}
                deal={{ x: center.x - pos.x, y: center.y - pos.y }}
                hero={pl.id === view.you}
                acting={d.actingId === pl.id || (!!hand && d.running && hand.awaiting.type === 'sideshow' && hand.awaiting.playerId === pl.id)}
                deadline={view.deadline}
                total={timerTotal}
                winner={d.winners.has(pl.id)}
                handName={view.handOver ? d.handNames[pl.id] : undefined}
                handId={handId}
                running={d.running}
                teenPatti={d.family === 'teenpatti'}
                highlight={d.highlight}
                onTap={d.isHost && pl.id !== view.you ? () => openSheet('host') : undefined}
              />
            );
          })}

          {/* street bets (community-card games) */}
          <AnimatePresence>
            {flop &&
              flop.players
                .filter((p) => p.streetBet > 0)
                .map((p) => {
                  const pl = view.players.find((x) => x.id === p.id);
                  if (!pl || pl.seat === null) return null;
                  const seatPt = positions[pl.seat];
                  const isHero = pl.id === view.you;
                  const bp = px(towards(seatPt, CENTER, isHero ? (landscape ? 0.5 : 0.6) : 0.44));
                  const from = px(seatPt);
                  const pot = potPoint();
                  return (
                    <motion.div
                      key={`${handId}-${flop.street}-${p.id}`}
                      className="bet num"
                      style={{ left: bp.x, top: bp.y }}
                      initial={{ x: from.x - bp.x, y: from.y - bp.y, opacity: 0, scale: 0.7 }}
                      animate={{ x: 0, y: 0, opacity: 1, scale: 1 }}
                      exit={{ x: pot.x - bp.x, y: pot.y - bp.y, opacity: 0, scale: 0.6, transition: { duration: 0.45, ease: 'easeIn' } }}
                      transition={{ type: 'spring', stiffness: 320, damping: 26 }}
                    >
                      <div className="bet-inner">
                        <ChipStack amount={p.streetBet} />
                        <motion.span className="amt" key={p.streetBet} initial={{ scale: 1.25 }} animate={{ scale: 1 }}>
                          {chipsShort(p.streetBet)}
                        </motion.span>
                      </div>
                    </motion.div>
                  );
                })}
          </AnimatePresence>

          {/* dealer button */}
          {hand &&
            (() => {
              const seat = hand.buttonSeat;
              const sp = positions[seat];
              if (!sp) return null;
              const s = px(sp);
              const c = center;
              const dx = c.x - s.x;
              const dy = c.y - s.y;
              const len = Math.hypot(dx, dy) || 1;
              const ux = dx / len;
              const uy = dy / len;
              const isHero = seat === heroSeat;
              const pos = isHero ? { x: s.x + heroHalf + 18, y: s.y - 34 } : { x: s.x + ux * 50 - uy * 28, y: s.y + uy * 50 + ux * 28 };
              return (
                <div className="dealer-btn" style={{ left: pos.x, top: pos.y }}>
                  D
                </div>
              );
            })()}

          {/* hero hand */}
          {heroPos && d.heroHp && heroCount > 0 && (
            <div
              className={`hero-hand ${discarding || tpBlind ? 'selectable' : ''}`}
              style={{ top: heroCardsTop, left: heroPos.x }}
              onClick={tpBlind ? seeCards : undefined}
            >
              {Array.from({ length: heroCount }, (_, i) => {
                const c = heroHole?.[i] ?? null;
                const mid = (heroCount - 1) / 2;
                const rot = heroCount > 2 ? (i - mid) * (heroCount > 4 ? 5 : 6) : (i - mid) * 5;
                const lift = heroCount > 2 ? Math.abs(i - mid) * Math.abs(i - mid) * 2.2 : 0;
                return (
                  <Card
                    key={`${handId}-h${i}-${c ?? 'x'}`}
                    card={c}
                    down={!c}
                    w={heroW}
                    rotate={rot}
                    from={{ x: center.x - heroPos.x, y: center.y - heroCardsTop }}
                    flipIn={!!c}
                    delay={i * 0.08}
                    dim={!heroLive}
                    highlight={view.handOver && d.highlight.has(c ?? '')}
                    selected={!!c && selected.has(c)}
                    onClick={discarding && c ? () => onToggleCard(c) : undefined}
                    style={{ marginLeft: i ? -overlap : 0, marginTop: lift }}
                  />
                );
              })}
            </div>
          )}
          {heroPos && tpBlind && d.running && (
            <div className="hero-strength" style={{ top: heroCardsTop - 24, left: heroPos.x }}>
              Tap cards to see 👀
            </div>
          )}

          {/* flying chips */}
          {flies.map((f) => (
            <motion.div
              key={f.id}
              className="fly-chip"
              style={{ left: f.from.x, top: f.from.y }}
              initial={{ x: 0, y: 0, opacity: 0, scale: 0.6 }}
              animate={{ x: f.to.x - f.from.x, y: f.to.y - f.from.y, opacity: [0, 1, 1, 0], scale: 1 }}
              transition={{ duration: 0.6, delay: f.delay, ease: [0.3, 0.7, 0.4, 1] }}
              onAnimationComplete={() => setFlies((all) => all.filter((x) => x.id !== f.id))}
            >
              <div className="chip" style={{ ['--c' as string]: f.color, position: 'relative', flex: '0 0 auto' }} />
            </motion.div>
          ))}

          <WinBanner view={view} />
          <BubbleLayer view={view} positions={positions} size={size} />
        </>
      )}
    </div>
  );
}

function WinBanner({ view }: { view: RoomView }) {
  const hand = view.hand;
  const r = view.handOver ? hand?.result : null;
  const winners = r ? Object.entries(r.totals).filter(([, a]) => a > 0) : [];
  const name = (id: string) => (id === view.you ? 'You' : view.players.find((p) => p.id === id)?.name ?? 'Player');
  let title = '';
  let sub = '';
  if (r && winners.length) {
    if (winners.length === 1) {
      const [id, amt] = winners[0];
      title = `${name(id)} ${id === view.you ? 'win' : 'wins'} ${chipsShort(amt)}`;
      const h = r.hands.find((x) => x.id === id);
      sub = r.byFold ? 'Everyone else folded' : h?.boards.map((b) => b.hi?.name).filter(Boolean)[0] ?? '';
    } else {
      title = winners.length > 2 ? 'Split pot' : `${name(winners[0][0])} & ${name(winners[1][0])}`;
      sub = winners.map(([id, a]) => `${name(id)} +${chipsShort(a)}`).join(' · ');
    }
  }
  return (
    <AnimatePresence>
      {title && (
        <motion.div
          key={`${hand?.handId}-win`}
          className="center-banner"
          style={{ top: hand?.family === 'teenpatti' ? '62%' : '63%' }}
          initial={{ opacity: 0, scale: 0.7, y: 10 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.9 }}
          transition={{ type: 'spring', stiffness: 300, damping: 22, delay: 0.25 }}
        >
          <div className="win-banner">
            <div className="wb-title">{title}</div>
            {sub && <div className="wb-sub">{sub}</div>}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
