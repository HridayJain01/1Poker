import { AnimatePresence, motion } from 'framer-motion';
import { memo } from 'react';
import type { Card as CardT } from '../../shared/cards';
import type { PublicPlayer } from '../../shared/protocol';
import { Avatar } from './Avatar';
import { Card } from './Card';
import { chipsShort, cls } from '../lib/format';
import { ACTION_LABEL, HandPlayer } from '../lib/derive';
import { serverNow } from '../lib/store';

export function TimerRing({ deadline, total }: { deadline: number; total: number }) {
  const remaining = Math.max(0, deadline - serverNow());
  const elapsed = Math.max(0, total - remaining);
  const r = 46;
  const C = 2 * Math.PI * r;
  return (
    <svg className="timer-ring" viewBox="0 0 100 100" key={deadline}>
      <circle cx="50" cy="50" r={r} stroke="rgba(0,0,0,0.35)" strokeWidth={4} />
      <circle
        cx="50"
        cy="50"
        r={r}
        strokeDasharray={C}
        style={{
          animation: `ringDrain ${total}ms linear forwards`,
          animationDelay: `-${elapsed}ms`,
          ['--C' as string]: `${C}`,
        }}
      />
    </svg>
  );
}

export interface SeatProps {
  player: PublicPlayer;
  hp: HandPlayer | undefined;
  x: number;
  y: number;
  /** offset from the seat to the deck (table center), for the deal animation */
  deal: { x: number; y: number };
  hero: boolean;
  acting: boolean;
  deadline: number | null;
  total: number;
  winner: boolean;
  handName?: string;
  handId: number;
  running: boolean;
  teenPatti: boolean;
  highlight: Set<CardT>;
  onTap?: () => void;
}

export const Seat = memo(function Seat(p: SeatProps) {
  const { player, hp } = p;
  const folded = !!hp?.folded;
  const out = !hp && (player.sittingOut || player.stack === 0);
  const stack = player.stack;
  const n = hp?.holeCount ?? 0;
  const showFaces = !p.hero && hp && !folded && hp.hole && hp.hole.length > 0;
  const showBacks = !p.hero && hp && !folded && !showFaces && n > 0;
  const last = p.running && hp?.lastAction && !['sb', 'bb', 'ante', 'boot'].includes(hp.lastAction.kind) ? hp.lastAction : null;
  const tp = p.teenPatti && hp && !folded;
  const backW = n <= 3 ? 19 : 15;
  const faceW = n <= 2 ? 30 : n <= 3 ? 26 : n <= 4 ? 23 : 20;
  const tags: { cls: string; text: string }[] = [];
  if (player.isHost) tags.push({ cls: 'host', text: 'Host' });
  if (tp && (hp as { seen?: boolean }).seen) tags.push({ cls: 'seen', text: 'Seen' });
  else if (tp) tags.push({ cls: 'blind', text: 'Blind' });
  if (!hp && player.sittingOut) tags.push({ cls: 'off', text: 'Away' });
  if (player.leavingAfterHand) tags.push({ cls: 'off', text: 'Leaving' });

  return (
    <div
      className={cls('seat', p.hero && 'hero', p.acting && 'acting', folded && 'folded', out && 'out', p.winner && 'winner')}
      style={{ left: p.x, top: p.y }}
      onClick={p.onTap}
      data-seat={player.seat ?? undefined}
    >
      <AnimatePresence>
        {last && (
          <motion.div
            key={`${p.handId}-${last.kind}-${last.amount ?? 0}`}
            className="pill-anchor"
            initial={{ opacity: 0, y: 8, scale: 0.8 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ type: 'spring', stiffness: 500, damping: 30 }}
          >
            <div className={`action-pill k-${last.kind}`}>
              {ACTION_LABEL[last.kind] ?? last.kind}
              {p.teenPatti && last.amount && last.kind !== 'pack' ? ` ${chipsShort(last.amount)}` : ''}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
      <div className="avatar-wrap">
        {showBacks && (
          <div className="seat-cards backs">
            {Array.from({ length: n }, (_, i) => (
              <Card
                key={`${p.handId}-b${i}`}
                w={backW}
                down
                rotate={(i - (n - 1) / 2) * 9}
                style={{ marginLeft: i ? -backW * 0.55 : 0 }}
                from={{ x: p.deal.x, y: p.deal.y }}
                delay={i * 0.08}
              />
            ))}
          </div>
        )}
        {showFaces && (
          <div className="seat-cards shown">
            {hp!.hole!.map((c, i) => (
              <Card
                key={`${p.handId}-f${c}`}
                card={c}
                w={faceW}
                flipIn
                delay={i * 0.06}
                highlight={p.highlight.has(c)}
                style={{ marginLeft: i ? -faceW * (n > 4 ? 0.42 : n > 2 ? 0.3 : 0.12) : 0 }}
              />
            ))}
          </div>
        )}
        <Avatar avatar={player.avatar} size={p.hero ? 46 : 50} />
        {p.acting && p.deadline && <TimerRing deadline={p.deadline} total={p.total} />}
        {!player.connected && (
          <span className="offline" title="Offline">
            ⏸
          </span>
        )}
      </div>
      <div className="plate">
        {tags.length > 0 && (
          <div className="seat-tags">
            {tags.map((t) => (
              <span key={t.text} className={`tag ${t.cls}`}>
                {t.text}
              </span>
            ))}
          </div>
        )}
        <div className="nm">{player.name}</div>
        <div className={cls('stk', 'num', hp?.allIn && !folded && 'allin')}>{hp?.allIn && !folded ? 'ALL-IN' : chipsShort(stack)}</div>
      </div>
      {p.handName && !folded && <div className="hand-name">{p.handName}</div>}
    </div>
  );
});
