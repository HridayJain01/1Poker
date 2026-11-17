import { memo } from 'react';
import { motion } from 'framer-motion';
import type { Card as CardT } from '../../shared/cards';
import { cls } from '../lib/format';
import { useStore } from '../lib/store';

const SUIT_PATHS: Record<string, string> = {
  s: 'M50 4C62 25 95 40 95 63c0 14-11 24-23 24-9 0-16-5-19-11 1 9 5 16 12 21H35c7-5 11-12 12-21-3 6-10 11-19 11C16 87 5 77 5 63 5 40 38 25 50 4z',
  h: 'M50 92C21 70 4 52 4 32 4 17 16 6 30 6c9 0 16 5 20 13 4-8 11-13 20-13 14 0 26 11 26 26 0 20-17 38-46 60z',
  d: 'M50 3c11 17 25 33 40 47-15 14-29 30-40 47C39 80 25 64 10 50 25 36 39 20 50 3z',
  c: 'M50 6a20 20 0 0 1 17 30.5A20 20 0 1 1 54 70c1 10 5 18 12 25H34c7-7 11-15 12-25A20 20 0 1 1 33 36.5 20 20 0 0 1 50 6z',
};

export function Suit({ s, className }: { s: string; className?: string }) {
  return (
    <svg viewBox="0 0 100 100" className={className} aria-hidden="true">
      <path d={SUIT_PATHS[s]} fill="currentColor" />
    </svg>
  );
}

const RANK_LABEL: Record<string, string> = { T: '10' };
const SUIT_NAME: Record<string, string> = { s: 'spades', h: 'hearts', d: 'diamonds', c: 'clubs' };

export interface CardProps {
  card?: CardT | null;
  /** width in px */
  w?: number;
  /** show the back */
  down?: boolean;
  dim?: boolean;
  highlight?: boolean;
  selected?: boolean;
  className?: string;
  onClick?: () => void;
  /** Flip in from face-down when it first appears. */
  flipIn?: boolean;
  delay?: number;
  /** Fly in from this offset (px) when it first appears. */
  from?: { x: number; y: number };
  rotate?: number;
  style?: React.CSSProperties;
}

function colorFor(suit: string, fourColor: boolean) {
  if (suit === 'h') return 'red';
  if (suit === 'd') return fourColor ? 'blue' : 'red';
  if (suit === 'c') return fourColor ? 'green' : '';
  return '';
}

export const Card = memo(function Card({ card, w = 44, down, dim, highlight, selected, className, onClick, flipIn, delay = 0, from, rotate = 0, style }: CardProps) {
  const fourColor = useStore((s) => s.settings.fourColor);
  const faceDown = down || !card;
  const rank = card ? RANK_LABEL[card[0]] ?? card[0] : '';
  const suit = card ? card[1] : 's';
  const initial = from
    ? { x: from.x, y: from.y, opacity: 0, scale: 0.6, rotate: rotate - 20, rotateY: flipIn ? 180 : faceDown ? 0 : 0 }
    : flipIn
      ? { rotateY: 180, scale: 0.9, opacity: 1 }
      : false;
  return (
    <motion.div
      className={cls('card', faceDown && 'down', dim && 'dim', highlight && 'hl', selected && 'sel', onClick && 'tappable', className)}
      style={{ ['--w' as string]: `${w}px`, ...style }}
      initial={initial}
      animate={{ x: 0, y: selected ? -w * 0.18 : 0, opacity: 1, scale: 1, rotate, rotateY: 0 }}
      transition={{ type: 'spring', stiffness: 260, damping: 24, delay }}
      onClick={onClick}
      role={card && !faceDown ? 'img' : undefined}
      aria-label={card && !faceDown ? `${rank} of ${SUIT_NAME[suit]}` : undefined}
    >
      <div className={cls('face', colorFor(suit, fourColor))}>
        {card && (
          <>
            <span className={cls('rank', rank === '10' && 'ten')}>{rank}</span>
            <Suit s={suit} className="suit-sm" />
            <Suit s={suit} className="suit-lg" />
          </>
        )}
      </div>
      <div className="back" />
    </motion.div>
  );
});
