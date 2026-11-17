import type { Rng } from '../cards';
import { FlopStakes, GameConfig, TeenPattiStakes, VARIANTS, normalizeGame } from '../variants';
import { FlopHand, FlopHandView } from './flopHand';
import { TeenPattiHand, TPHandView } from './teenPatti';
import type { HandSeatInput } from './types';

export * from './types';
export * from './pots';
export * from './flopHand';
export * from './teenPatti';

export type HandEngine = FlopHand | TeenPattiHand;
export type HandView = FlopHandView | TPHandView;

export interface CreateHandOptions {
  players: HandSeatInput[];
  buttonSeat: number;
  game: GameConfig;
  flopStakes: FlopStakes;
  tpStakes: TeenPattiStakes;
  rng: Rng;
  handId?: number;
}

export function createHand(o: CreateHandOptions): HandEngine {
  const game = normalizeGame(o.game);
  if (VARIANTS[game.variant].family === 'teenpatti') {
    return new TeenPattiHand({ players: o.players, buttonSeat: o.buttonSeat, game, stakes: o.tpStakes, rng: o.rng, handId: o.handId });
  }
  return new FlopHand({ players: o.players, buttonSeat: o.buttonSeat, game, stakes: o.flopStakes, rng: o.rng, handId: o.handId });
}
