import type { EvalMode, HandRule } from './eval';

export type VariantId =
  | 'holdem'
  | 'shortdeck'
  | 'pineapple'
  | 'crazypineapple'
  | 'irish'
  | 'omaha'
  | 'teenpatti'
  | 'muflis';

export type Structure = 'NL' | 'PL' | 'FL';

export interface GameConfig {
  variant: VariantId;
  /** Betting structure (community-card games only). */
  structure: Structure;
  /** Hole cards for Omaha (4 = PLO, 5 = PLO5, 6 = PLO6). */
  omahaCards: 4 | 5 | 6;
  /** Omaha eight-or-better split pot. */
  hiLo: boolean;
  /** Number of boards (pot is split between boards). */
  boards: 1 | 2 | 3;
}

export interface VariantInfo {
  id: VariantId;
  name: string;
  family: 'flop' | 'teenpatti';
  blurb: string;
  rule: HandRule;
  mode: EvalMode;
  shortDeck: boolean;
  /** Discard step: after which betting round, and how many cards each player throws away. */
  discard?: { after: 'preflop' | 'flop'; count: number };
  structures: Structure[];
  defaultStructure: Structure;
  allowBoards: boolean;
  allowHiLo: boolean;
  allowOmahaCards: boolean;
  baseHoleCards: number;
}

export const VARIANTS: Record<VariantId, VariantInfo> = {
  holdem: {
    id: 'holdem',
    name: "Texas Hold'em",
    family: 'flop',
    blurb: 'Two hole cards, five on the board. The classic.',
    rule: 'holdem',
    mode: 'standard',
    shortDeck: false,
    structures: ['NL', 'PL', 'FL'],
    defaultStructure: 'NL',
    allowBoards: true,
    allowHiLo: false,
    allowOmahaCards: false,
    baseHoleCards: 2,
  },
  omaha: {
    id: 'omaha',
    name: 'Omaha',
    family: 'flop',
    blurb: '4, 5 or 6 hole cards — use exactly two with three from the board. Hi-Lo & multi-board splits.',
    rule: 'omaha',
    mode: 'standard',
    shortDeck: false,
    structures: ['PL', 'NL', 'FL'],
    defaultStructure: 'PL',
    allowBoards: true,
    allowHiLo: true,
    allowOmahaCards: true,
    baseHoleCards: 4,
  },
  irish: {
    id: 'irish',
    name: 'Irish Poker',
    family: 'flop',
    blurb: 'Four hole cards like Omaha — discard two after the flop betting, then play it like Hold\'em.',
    rule: 'holdem',
    mode: 'standard',
    shortDeck: false,
    discard: { after: 'flop', count: 2 },
    structures: ['PL', 'NL'],
    defaultStructure: 'PL',
    allowBoards: false,
    allowHiLo: false,
    allowOmahaCards: false,
    baseHoleCards: 4,
  },
  pineapple: {
    id: 'pineapple',
    name: 'Pineapple',
    family: 'flop',
    blurb: 'Three hole cards — discard one before the flop, then Hold\'em.',
    rule: 'holdem',
    mode: 'standard',
    shortDeck: false,
    discard: { after: 'preflop', count: 1 },
    structures: ['NL', 'PL', 'FL'],
    defaultStructure: 'NL',
    allowBoards: false,
    allowHiLo: false,
    allowOmahaCards: false,
    baseHoleCards: 3,
  },
  crazypineapple: {
    id: 'crazypineapple',
    name: 'Crazy Pineapple',
    family: 'flop',
    blurb: 'Three hole cards — keep all three through the flop, then discard one.',
    rule: 'holdem',
    mode: 'standard',
    shortDeck: false,
    discard: { after: 'flop', count: 1 },
    structures: ['NL', 'PL', 'FL'],
    defaultStructure: 'NL',
    allowBoards: false,
    allowHiLo: false,
    allowOmahaCards: false,
    baseHoleCards: 3,
  },
  shortdeck: {
    id: 'shortdeck',
    name: 'Short Deck (6+)',
    family: 'flop',
    blurb: '36-card deck (6s to Aces). Flush beats full house, trips beat a straight, A-6-7-8-9 is a straight.',
    rule: 'holdem',
    mode: 'shortdeck',
    shortDeck: true,
    structures: ['NL', 'PL'],
    defaultStructure: 'NL',
    allowBoards: true,
    allowHiLo: false,
    allowOmahaCards: false,
    baseHoleCards: 2,
  },
  teenpatti: {
    id: 'teenpatti',
    name: 'Teen Patti',
    family: 'teenpatti',
    blurb: 'Three cards. Play blind or seen, chaal, raise, side show and show. Trail is king.',
    rule: 'holdem',
    mode: 'standard',
    shortDeck: false,
    structures: ['NL'],
    defaultStructure: 'NL',
    allowBoards: false,
    allowHiLo: false,
    allowOmahaCards: false,
    baseHoleCards: 3,
  },
  muflis: {
    id: 'muflis',
    name: 'Teen Patti Muflis',
    family: 'teenpatti',
    blurb: 'Teen Patti lowball — every ranking is flipped. The worst hand wins!',
    rule: 'holdem',
    mode: 'standard',
    shortDeck: false,
    structures: ['NL'],
    defaultStructure: 'NL',
    allowBoards: false,
    allowHiLo: false,
    allowOmahaCards: false,
    baseHoleCards: 3,
  },
};

export const VARIANT_ORDER: VariantId[] = [
  'holdem',
  'omaha',
  'irish',
  'pineapple',
  'crazypineapple',
  'shortdeck',
  'teenpatti',
  'muflis',
];

export const MAX_SEATS = 10;
export const MIN_SEATS = 2;

export function defaultGame(variant: VariantId = 'holdem'): GameConfig {
  return normalizeGame({ variant, structure: VARIANTS[variant].defaultStructure, omahaCards: 4, hiLo: false, boards: 1 });
}

/** Coerces any (possibly untrusted) config into a valid one. */
export function normalizeGame(input: Partial<GameConfig> | undefined | null): GameConfig {
  const variant: VariantId = input && input.variant && input.variant in VARIANTS ? input.variant : 'holdem';
  const info = VARIANTS[variant];
  const structure = input?.structure && info.structures.includes(input.structure) ? input.structure : info.defaultStructure;
  const omahaCards = info.allowOmahaCards && (input?.omahaCards === 5 || input?.omahaCards === 6) ? input.omahaCards : 4;
  const hiLo = info.allowHiLo ? !!input?.hiLo : false;
  let boards: 1 | 2 | 3 = info.allowBoards && (input?.boards === 2 || input?.boards === 3) ? input.boards : 1;
  // Short deck has 36 cards: three boards can't be dealt to a full table, keep it at two.
  if (variant === 'shortdeck' && boards === 3) boards = 2;
  return { variant, structure, omahaCards, hiLo, boards };
}

export function holeCardCount(cfg: GameConfig): number {
  return cfg.variant === 'omaha' ? cfg.omahaCards : VARIANTS[cfg.variant].baseHoleCards;
}

export function deckSize(cfg: GameConfig): number {
  return VARIANTS[cfg.variant].shortDeck ? 36 : 52;
}

/** Maximum number of players that can be dealt in with this configuration. */
export function capacity(cfg: GameConfig): number {
  const info = VARIANTS[cfg.variant];
  const boardCards = info.family === 'flop' ? 5 * cfg.boards : 0;
  return Math.min(MAX_SEATS, Math.floor((deckSize(cfg) - boardCards) / holeCardCount(cfg)));
}

export function sameGame(a: GameConfig, b: GameConfig): boolean {
  const x = normalizeGame(a);
  const y = normalizeGame(b);
  return (
    x.variant === y.variant &&
    x.structure === y.structure &&
    x.omahaCards === y.omahaCards &&
    x.hiLo === y.hiLo &&
    x.boards === y.boards
  );
}

const STRUCT_LONG: Record<Structure, string> = { NL: 'No-Limit', PL: 'Pot-Limit', FL: 'Limit' };
const BOARD_LABEL = ['', '', 'Double Board', 'Triple Board'];

/** Human label, e.g. "Pot-Limit Omaha 5 Hi-Lo · Double Board". */
export function gameLabel(input: GameConfig): string {
  const cfg = normalizeGame(input);
  const info = VARIANTS[cfg.variant];
  if (info.family === 'teenpatti') return info.name;
  let name = info.name;
  if (cfg.variant === 'omaha') name = `Omaha${cfg.omahaCards > 4 ? ' ' + cfg.omahaCards : ''}${cfg.hiLo ? ' Hi-Lo' : ''}`;
  const parts = [`${STRUCT_LONG[cfg.structure]} ${name}`];
  if (cfg.boards > 1) parts.push(BOARD_LABEL[cfg.boards]);
  return parts.join(' · ');
}

/** Compact label, e.g. "PLO5 H/L ×2". */
export function gameShortLabel(input: GameConfig): string {
  const cfg = normalizeGame(input);
  const info = VARIANTS[cfg.variant];
  if (cfg.variant === 'teenpatti') return 'Teen Patti';
  if (cfg.variant === 'muflis') return 'Muflis';
  const s = cfg.structure === 'FL' ? 'L' : cfg.structure;
  let base: string;
  switch (cfg.variant) {
    case 'holdem':
      base = `${s}HE`;
      break;
    case 'omaha':
      base = `${s}O${cfg.omahaCards > 4 ? cfg.omahaCards : ''}${cfg.hiLo ? ' H/L' : ''}`;
      break;
    case 'irish':
      base = `${s} Irish`;
      break;
    case 'pineapple':
      base = `${s} Pineapple`;
      break;
    case 'crazypineapple':
      base = `${s} Crazy Pine`;
      break;
    case 'shortdeck':
      base = `${s} 6+`;
      break;
    default:
      base = info.name;
  }
  return cfg.boards > 1 ? `${base} ×${cfg.boards}` : base;
}

export interface FlopStakes {
  sb: number;
  bb: number;
  ante: number;
}

export interface TeenPattiStakes {
  boot: number;
  /** Chaal limit: the stake can never be raised above this (0 = no limit). */
  maxStake: number;
  /** When the pot reaches this, all remaining players are forced to show (0 = no limit). */
  potLimit: number;
}
