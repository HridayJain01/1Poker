import { Card, combinations, rankName, rankOf, suitOf } from './cards';

export type EvalMode = 'standard' | 'shortdeck';
export type HandCat =
  | 'high'
  | 'pair'
  | 'twopair'
  | 'trips'
  | 'straight'
  | 'flush'
  | 'fullhouse'
  | 'quads'
  | 'straightflush';

// Category strength order (index = strength).
const ORDER_STANDARD: HandCat[] = ['high', 'pair', 'twopair', 'trips', 'straight', 'flush', 'fullhouse', 'quads', 'straightflush'];
// Short deck (Triton rules): flush beats full house, three of a kind beats a straight.
const ORDER_SHORTDECK: HandCat[] = ['high', 'pair', 'twopair', 'straight', 'trips', 'fullhouse', 'flush', 'quads', 'straightflush'];

export const CAT_SHORT: Record<HandCat, string> = {
  high: 'High Card',
  pair: 'Pair',
  twopair: 'Two Pair',
  trips: 'Three of a Kind',
  straight: 'Straight',
  flush: 'Flush',
  fullhouse: 'Full House',
  quads: 'Four of a Kind',
  straightflush: 'Straight Flush',
};

export interface HandValue {
  /** Higher is better. Only comparable between hands evaluated with the same mode. */
  score: number;
  cat: HandCat;
  /** The five cards making the hand, ordered for display. */
  cards: Card[];
  name: string;
  short: string;
}

function encode(cat: number, tiebreak: number[]): number {
  let s = cat;
  for (let i = 0; i < 5; i++) s = s * 16 + (tiebreak[i] ?? 0);
  return s;
}

/** Evaluates exactly five cards. */
export function eval5(cards: Card[], mode: EvalMode = 'standard'): HandValue {
  if (cards.length !== 5) throw new Error('eval5 needs 5 cards');
  const ranks = cards.map(rankOf);
  const sorted = ranks.slice().sort((a, b) => b - a);
  const s0 = suitOf(cards[0]);
  const flush = cards.every((c) => suitOf(c) === s0);
  const counts = new Map<number, number>();
  for (const r of ranks) counts.set(r, (counts.get(r) ?? 0) + 1);
  const groups = [...counts.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0]);

  let straightHigh = 0;
  let wheel = false;
  if (groups.length === 5) {
    if (sorted[0] - sorted[4] === 4) straightHigh = sorted[0];
    else if (mode === 'standard' && sorted.join(',') === '14,5,4,3,2') {
      straightHigh = 5;
      wheel = true;
    } else if (mode === 'shortdeck' && sorted.join(',') === '14,9,8,7,6') {
      straightHigh = 9;
      wheel = true;
    }
  }

  let cat: HandCat;
  let tb: number[];
  if (straightHigh && flush) {
    cat = 'straightflush';
    tb = [straightHigh];
  } else if (groups[0][1] === 4) {
    cat = 'quads';
    tb = [groups[0][0], groups[1][0]];
  } else if (groups[0][1] === 3 && groups[1][1] === 2) {
    cat = 'fullhouse';
    tb = [groups[0][0], groups[1][0]];
  } else if (flush) {
    cat = 'flush';
    tb = sorted;
  } else if (straightHigh) {
    cat = 'straight';
    tb = [straightHigh];
  } else if (groups[0][1] === 3) {
    cat = 'trips';
    tb = [groups[0][0], groups[1][0], groups[2][0]];
  } else if (groups[0][1] === 2 && groups[1][1] === 2) {
    cat = 'twopair';
    tb = [groups[0][0], groups[1][0], groups[2][0]];
  } else if (groups[0][1] === 2) {
    cat = 'pair';
    tb = [groups[0][0], groups[1][0], groups[2][0], groups[3][0]];
  } else {
    cat = 'high';
    tb = sorted;
  }

  const order = mode === 'shortdeck' ? ORDER_SHORTDECK : ORDER_STANDARD;
  const score = encode(order.indexOf(cat), tb);

  // Display order: by group size then rank; wheel puts the ace last.
  const rankWeight = (c: Card) => {
    const r = rankOf(c);
    if (wheel && r === 14) return -1;
    return r;
  };
  const display = cards
    .slice()
    .sort((a, b) => (counts.get(rankOf(b))! - counts.get(rankOf(a))!) || rankWeight(b) - rankWeight(a));

  return { score, cat, cards: display, name: describe(cat, tb), short: shortName(cat, tb) };
}

function shortName(cat: HandCat, tb: number[]): string {
  if (cat === 'straightflush' && tb[0] === 14) return 'Royal Flush';
  return CAT_SHORT[cat];
}

function describe(cat: HandCat, tb: number[]): string {
  switch (cat) {
    case 'straightflush':
      return tb[0] === 14 ? 'Royal Flush' : `Straight Flush, ${rankName(tb[0])} high`;
    case 'quads':
      return `Four of a Kind, ${rankName(tb[0], true)}`;
    case 'fullhouse':
      return `Full House, ${rankName(tb[0], true)} full of ${rankName(tb[1], true)}`;
    case 'flush':
      return `Flush, ${rankName(tb[0])} high`;
    case 'straight':
      return `Straight, ${rankName(tb[0])} high`;
    case 'trips':
      return `Three of a Kind, ${rankName(tb[0], true)}`;
    case 'twopair':
      return `Two Pair, ${rankName(tb[0], true)} and ${rankName(tb[1], true)}`;
    case 'pair':
      return `Pair of ${rankName(tb[0], true)}`;
    default:
      return `High Card, ${rankName(tb[0])}`;
  }
}

export type HandRule = 'holdem' | 'omaha';

/**
 * Best high hand.
 *  - holdem: best five of all hole + board cards (any number from hole).
 *  - omaha: exactly two hole cards and exactly three board cards.
 * Returns null when there are not enough cards to form a hand.
 */
export function bestHigh(hole: Card[], board: Card[], rule: HandRule, mode: EvalMode = 'standard'): HandValue | null {
  let best: HandValue | null = null;
  if (rule === 'omaha') {
    if (hole.length < 2 || board.length < 3) return null;
    for (const h of combinations(hole, 2)) {
      for (const b of combinations(board, 3)) {
        const v = eval5([...h, ...b], mode);
        if (!best || v.score > best.score) best = v;
      }
    }
    return best;
  }
  const all = [...hole, ...board];
  if (all.length < 5) return null;
  for (const c of combinations(all, 5)) {
    const v = eval5(c, mode);
    if (!best || v.score > best.score) best = v;
  }
  return best;
}

// ---------------------------------------------------------------------------
// Ace-to-five "eight or better" low (used by Omaha Hi-Lo).

export interface LowValue {
  /** Higher is better (i.e. a lower hand). */
  score: number;
  cards: Card[];
  name: string;
}

const lowRank = (c: Card) => (rankOf(c) === 14 ? 1 : rankOf(c));

export function low5(cards: Card[]): LowValue | null {
  const ranks = cards.map(lowRank);
  if (new Set(ranks).size !== 5 || ranks.some((r) => r > 8)) return null;
  const sorted = ranks.slice().sort((a, b) => b - a);
  let s = 0;
  for (const r of sorted) s = s * 16 + r;
  const display = cards.slice().sort((a, b) => lowRank(b) - lowRank(a));
  const label = sorted.map((r) => (r === 1 ? 'A' : String(r))).join('-');
  return { score: -s, cards: display, name: `${label} low` };
}

export function bestLowOmaha(hole: Card[], board: Card[]): LowValue | null {
  if (hole.length < 2 || board.length < 3) return null;
  let best: LowValue | null = null;
  for (const h of combinations(hole, 2)) {
    for (const b of combinations(board, 3)) {
      const v = low5([...h, ...b]);
      if (v && (!best || v.score > best.score)) best = v;
    }
  }
  return best;
}

// ---------------------------------------------------------------------------
// Partial-hand description (fewer than five cards available) — display only.

export function describePartial(cards: Card[]): string {
  if (cards.length === 0) return '';
  const counts = new Map<number, number>();
  for (const c of cards) counts.set(rankOf(c), (counts.get(rankOf(c)) ?? 0) + 1);
  const groups = [...counts.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0]);
  if (groups[0][1] >= 4) return `Four of a Kind, ${rankName(groups[0][0], true)}`;
  if (groups[0][1] === 3) return `Three of a Kind, ${rankName(groups[0][0], true)}`;
  if (groups[0][1] === 2 && groups[1]?.[1] === 2)
    return `Two Pair, ${rankName(groups[0][0], true)} and ${rankName(groups[1][0], true)}`;
  if (groups[0][1] === 2) return `Pair of ${rankName(groups[0][0], true)}`;
  return `High Card, ${rankName(groups[0][0])}`;
}

// ---------------------------------------------------------------------------
// Teen Patti (three cards).

export type TPCat = 'high' | 'pair' | 'color' | 'sequence' | 'pureseq' | 'trail';
const TP_ORDER: TPCat[] = ['high', 'pair', 'color', 'sequence', 'pureseq', 'trail'];
export const TP_NAMES: Record<TPCat, string> = {
  high: 'High Card',
  pair: 'Pair',
  color: 'Color',
  sequence: 'Sequence',
  pureseq: 'Pure Sequence',
  trail: 'Trail',
};

export interface TPValue {
  score: number;
  cat: TPCat;
  name: string;
  short: string;
}

const tpChar = (r: number) => (r === 14 ? 'A' : r === 13 ? 'K' : r === 12 ? 'Q' : r === 11 ? 'J' : r === 10 ? '10' : String(r));

/**
 * Teen Patti ranking: Trail > Pure Sequence > Sequence > Color > Pair > High Card.
 * Sequences: A-K-Q is highest, A-2-3 second highest, 4-3-2 lowest.
 * In Muflis (lowball) the order is fully reversed.
 */
export function evalTeenPatti(cards: Card[], muflis = false): TPValue {
  if (cards.length !== 3) throw new Error('Teen Patti hands have 3 cards');
  const r = cards.map(rankOf).sort((a, b) => b - a);
  const s0 = suitOf(cards[0]);
  const flush = cards.every((c) => suitOf(c) === s0);
  const distinct = new Set(r).size;
  let seqVal = 0;
  let seqLabel = '';
  if (distinct === 3) {
    if (r[0] === 14 && r[1] === 13 && r[2] === 12) {
      seqVal = 15;
      seqLabel = 'A-K-Q';
    } else if (r[0] === 14 && r[1] === 3 && r[2] === 2) {
      seqVal = 14;
      seqLabel = 'A-2-3';
    } else if (r[0] - r[2] === 2) {
      seqVal = r[0];
      seqLabel = `${tpChar(r[0])}-${tpChar(r[1])}-${tpChar(r[2])}`;
    }
  }
  let cat: TPCat;
  let tb: number[];
  let name: string;
  if (distinct === 1) {
    cat = 'trail';
    tb = [r[0]];
    name = `Trail of ${rankName(r[0], true)}`;
  } else if (seqVal && flush) {
    cat = 'pureseq';
    tb = [seqVal];
    name = `Pure Sequence ${seqLabel}`;
  } else if (seqVal) {
    cat = 'sequence';
    tb = [seqVal];
    name = `Sequence ${seqLabel}`;
  } else if (flush) {
    cat = 'color';
    tb = r;
    name = `Color, ${rankName(r[0])} high`;
  } else if (distinct === 2) {
    const pair = r[0] === r[1] ? r[0] : r[1];
    const kicker = r[0] === r[1] ? r[2] : r[0];
    cat = 'pair';
    tb = [pair, kicker];
    name = `Pair of ${rankName(pair, true)}`;
  } else {
    cat = 'high';
    tb = r;
    name = `High Card, ${rankName(r[0])}`;
  }
  let score = TP_ORDER.indexOf(cat);
  for (let i = 0; i < 3; i++) score = score * 16 + (tb[i] ?? 0);
  return { score: muflis ? -score : score, cat, name, short: TP_NAMES[cat] };
}
