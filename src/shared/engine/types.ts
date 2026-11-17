import type { Card } from '../cards';
import type { PotResult } from './pots';

export type ActionKind =
  | 'fold'
  | 'check'
  | 'call'
  | 'bet'
  | 'raise'
  | 'allin'
  | 'sb'
  | 'bb'
  | 'ante'
  | 'boot'
  | 'blind'
  | 'chaal'
  | 'pack'
  | 'see'
  | 'show'
  | 'sideshow'
  | 'discard';

export interface LastAction {
  kind: ActionKind;
  amount?: number;
}

export type Awaiting =
  | { type: 'action'; playerId: string }
  | { type: 'discard'; playerIds: string[] }
  | { type: 'sideshow'; playerId: string; fromId: string }
  | { type: 'advance'; delay: 'collect' | 'street' | 'runout' | 'showdown' | 'short' }
  | { type: 'complete' };

export interface HandSeatInput {
  id: string;
  seat: number;
  stack: number;
}

export type HandEvent =
  | { t: 'deal' }
  | { t: 'act'; id: string; kind: ActionKind; amount: number; to?: number }
  | { t: 'street'; street: string }
  | { t: 'reveal' }
  | { t: 'discard'; id: string }
  | { t: 'refund'; id: string; amount: number }
  | { t: 'see'; id: string }
  | { t: 'sideshow'; from: string; to: string; result?: 'accepted' | 'denied'; loser?: string }
  | { t: 'show'; id: string }
  | { t: 'win'; totals: Record<string, number>; byFold: boolean };

export interface ShownHandPart {
  name: string;
  short: string;
  cards: Card[];
}

export interface ShowdownHand {
  id: string;
  hole: Card[];
  /** One entry per board. */
  boards: { hi: ShownHandPart | null; lo: ShownHandPart | null }[];
}

export interface HandResult {
  byFold: boolean;
  /** Chips won by each player (gross). */
  totals: Record<string, number>;
  potTotal: number;
  pots: PotResult[];
  hands: ShowdownHand[];
}
