import { Card, Rng, makeDeck, rankOf, suitOf, combinations } from '../cards';
import { buildDeck } from './deck';
import { bestHigh, bestLowOmaha, HandValue, LowValue } from '../eval';
import { FlopStakes, GameConfig, VARIANTS, VariantInfo, holeCardCount, normalizeGame, capacity } from '../variants';
import { buildPots, settlePots } from './pots';
import type { ActionKind, Awaiting, HandEvent, HandResult, HandSeatInput, LastAction, ShowdownHand } from './types';

export type Street = 'preflop' | 'flop' | 'turn' | 'river' | 'showdown';

export type FlopAction =
  | { type: 'fold' }
  | { type: 'check' }
  | { type: 'call' }
  /** Bet or raise so that the player's total bet on this street becomes `to`. */
  | { type: 'raise'; to: number }
  | { type: 'allin' };

export interface FlopLegal {
  canFold: boolean;
  canCheck: boolean;
  canCall: boolean;
  /** Chips added by calling (already capped by the stack). */
  callAmount: number;
  canRaise: boolean;
  /** True when nobody has bet on this street yet (label the button "Bet"). */
  isBet: boolean;
  minRaiseTo: number;
  maxRaiseTo: number;
  /** Street total if the player moves all-in. */
  allInTo: number;
  streetBet: number;
  stack: number;
  currentBet: number;
  /** Pot including every bet in front of players. */
  potTotal: number;
}

interface FPlayer {
  id: string;
  seat: number;
  stack: number;
  startStack: number;
  hole: Card[];
  discards: Card[];
  folded: boolean;
  allIn: boolean;
  streetBet: number;
  totalBet: number;
  hasActed: boolean;
  actedAtLevel: number;
  shown: boolean;
  needDiscard: boolean;
  lastAction: LastAction | null;
}

export interface FlopPlayerView {
  id: string;
  seat: number;
  stack: number;
  streetBet: number;
  totalBet: number;
  folded: boolean;
  allIn: boolean;
  holeCount: number;
  /** Visible hole cards: your own, or revealed ones. */
  hole: Card[] | null;
  shown: boolean;
  needDiscard: boolean;
  lastAction: LastAction | null;
}

export interface FlopHandView {
  family: 'flop';
  handId: number;
  game: GameConfig;
  street: Street;
  boards: Card[][];
  pot: number;
  potTotal: number;
  currentBet: number;
  buttonSeat: number;
  sbSeat: number;
  bbSeat: number;
  stakes: FlopStakes;
  players: FlopPlayerView[];
  awaiting: Awaiting;
  legal: FlopLegal | null;
  discardCount: number;
  /** Cards you threw away (only sent to you). */
  myDiscards: Card[];
  result: HandResult | null;
}

export interface FlopHandOptions {
  players: HandSeatInput[];
  buttonSeat: number;
  game: GameConfig;
  stakes: FlopStakes;
  rng: Rng;
  handId?: number;
  /** Testing only: the first cards to be dealt, in dealing order. */
  presetDeck?: Card[];
}

/** Pot-sized raise target for a fraction of the pot: currentBet + f × (pot after calling). */
export function potFractionRaiseTo(legal: FlopLegal, fraction: number): number {
  const toCall = Math.max(0, legal.currentBet - legal.streetBet);
  const target = legal.currentBet + Math.floor(fraction * (legal.potTotal + toCall));
  return Math.max(legal.minRaiseTo, Math.min(legal.maxRaiseTo, target));
}

export class FlopHand {
  readonly family = 'flop' as const;
  readonly handId: number;
  readonly game: GameConfig;
  readonly info: VariantInfo;
  readonly stakes: FlopStakes;
  private players: FPlayer[];
  private deck: Card[];
  private boards: Card[][];
  private street: Street = 'preflop';
  private discardDone = false;
  private revealed = false;
  private buttonIdx: number;
  private sbIdx: number;
  private bbIdx: number;
  private collected = 0;
  private currentBet = 0;
  private lastRaiseSize = 0;
  private betsCount = 0;
  private fullBetLevel = 0;
  private _awaiting: Awaiting = { type: 'complete' };
  private events: HandEvent[] = [];
  result: HandResult | null = null;

  constructor(opts: FlopHandOptions) {
    this.game = normalizeGame(opts.game);
    this.info = VARIANTS[this.game.variant];
    if (this.info.family !== 'flop') throw new Error('Not a community-card game');
    this.handId = opts.handId ?? 1;
    const sb = Math.max(0, Math.floor(opts.stakes.sb));
    const bb = Math.max(1, Math.floor(opts.stakes.bb));
    this.stakes = { sb: Math.min(sb, bb), bb, ante: Math.max(0, Math.floor(opts.stakes.ante)) };

    const seated = opts.players.filter((p) => p.stack > 0).slice().sort((a, b) => a.seat - b.seat);
    if (seated.length < 2) throw new Error('Need at least two players with chips');
    if (seated.length > capacity(this.game)) throw new Error('Too many players for this game');
    this.players = seated.map((p) => ({
      id: p.id,
      seat: p.seat,
      stack: Math.floor(p.stack),
      startStack: Math.floor(p.stack),
      hole: [],
      discards: [],
      folded: false,
      allIn: false,
      streetBet: 0,
      totalBet: 0,
      hasActed: false,
      actedAtLevel: 0,
      shown: false,
      needDiscard: false,
      lastAction: null,
    }));
    const n = this.players.length;
    let bi = this.players.findIndex((p) => p.seat === opts.buttonSeat);
    if (bi < 0) {
      // Button seat is empty: give it to the next occupied seat clockwise.
      bi = this.players.findIndex((p) => p.seat > opts.buttonSeat);
      if (bi < 0) bi = 0;
    }
    this.buttonIdx = bi;
    if (n === 2) {
      this.sbIdx = bi;
      this.bbIdx = (bi + 1) % n;
    } else {
      this.sbIdx = (bi + 1) % n;
      this.bbIdx = (bi + 2) % n;
    }
    this.deck = buildDeck(makeDeck(this.info.shortDeck), opts.rng, opts.presetDeck);
    this.boards = Array.from({ length: this.game.boards }, () => []);
    this.start();
  }

  // ------------------------------------------------------------------ helpers

  private get bb() {
    return this.stakes.bb;
  }

  private betSize(): number {
    return this.street === 'turn' || this.street === 'river' ? this.bb * 2 : this.bb;
  }

  private canAct(p: FPlayer) {
    return !p.folded && !p.allIn;
  }

  private actors() {
    return this.players.filter((p) => this.canAct(p));
  }

  private live() {
    return this.players.filter((p) => !p.folded);
  }

  private idx(id: string) {
    return this.players.findIndex((p) => p.id === id);
  }

  private put(p: FPlayer, amount: number) {
    const a = Math.min(amount, p.stack);
    p.stack -= a;
    p.streetBet += a;
    p.totalBet += a;
    if (p.stack === 0) p.allIn = true;
    return a;
  }

  private draw(): Card {
    const c = this.deck.pop();
    if (!c) throw new Error('Deck exhausted');
    return c;
  }

  /** The amount a player must reach to stay in. */
  private callTarget(p: FPlayer): number {
    if (this.actors().length <= 1) {
      // Nobody left who could bet further: only match what live opponents actually put in.
      let maxOther = 0;
      for (const o of this.players) if (o !== p && !o.folded) maxOther = Math.max(maxOther, o.streetBet);
      return Math.min(this.currentBet, Math.max(maxOther, p.streetBet));
    }
    return this.currentBet;
  }

  private needsToAct(p: FPlayer): boolean {
    if (!this.canAct(p)) return false;
    if (p.streetBet < this.callTarget(p)) return true;
    return !p.hasActed && this.actors().length >= 2;
  }

  private potTotal() {
    return this.collected + this.players.reduce((s, p) => s + p.streetBet, 0);
  }

  private nextNeeding(fromIdx: number): number {
    const n = this.players.length;
    for (let k = 1; k <= n; k++) {
      const i = (fromIdx + k) % n;
      if (this.needsToAct(this.players[i])) return i;
    }
    return -1;
  }

  private emit(e: HandEvent) {
    this.events.push(e);
  }

  private record(p: FPlayer, kind: ActionKind, amount: number, to?: number) {
    p.lastAction = { kind, amount: amount || undefined };
    this.emit({ t: 'act', id: p.id, kind, amount, to });
  }

  // ------------------------------------------------------------------ flow

  private start() {
    const { ante, sb } = this.stakes;
    if (ante > 0) {
      for (const p of this.players) {
        const a = Math.min(ante, p.stack);
        p.stack -= a;
        p.totalBet += a;
        this.collected += a;
        if (p.stack === 0) p.allIn = true;
        p.lastAction = { kind: 'ante', amount: a };
      }
    }
    const sbP = this.players[this.sbIdx];
    const bbP = this.players[this.bbIdx];
    const sbAmt = this.put(sbP, sb);
    if (sbAmt > 0) this.record(sbP, 'sb', sbAmt, sbP.streetBet);
    const bbAmt = this.put(bbP, this.bb);
    if (bbAmt > 0) this.record(bbP, 'bb', bbAmt, bbP.streetBet);
    this.currentBet = this.bb;
    this.lastRaiseSize = this.bb;
    this.betsCount = 1;
    this.fullBetLevel = this.bb;

    const holeN = holeCardCount(this.game);
    const n = this.players.length;
    for (let r = 0; r < holeN; r++) {
      for (let k = 1; k <= n; k++) this.players[(this.buttonIdx + k) % n].hole.push(this.draw());
    }
    this.emit({ t: 'deal' });

    const first = this.nextNeeding(this.bbIdx);
    if (first < 0) this.endStreet();
    else this._awaiting = { type: 'action', playerId: this.players[first].id };
  }

  private startBettingRound() {
    for (const p of this.players) {
      p.streetBet = 0;
      p.hasActed = false;
      p.actedAtLevel = 0;
      if (p.lastAction && p.lastAction.kind !== 'fold' && p.lastAction.kind !== 'allin') p.lastAction = null;
    }
    this.currentBet = 0;
    this.lastRaiseSize = this.bb;
    this.betsCount = 0;
    this.fullBetLevel = 0;
    const first = this.nextNeeding(this.buttonIdx);
    if (first < 0) {
      this.revealIfAllIn();
      this._awaiting = { type: 'advance', delay: 'runout' };
    } else this._awaiting = { type: 'action', playerId: this.players[first].id };
  }

  private refundUncalled() {
    const sorted = this.players.slice().sort((a, b) => b.streetBet - a.streetBet);
    const top = sorted[0];
    const second = sorted[1]?.streetBet ?? 0;
    if (top && top.streetBet > second) {
      const r = top.streetBet - second;
      top.streetBet -= r;
      top.totalBet -= r;
      top.stack += r;
      if (top.stack > 0) top.allIn = false;
      this.emit({ t: 'refund', id: top.id, amount: r });
    }
  }

  private collectBets() {
    for (const p of this.players) {
      this.collected += p.streetBet;
      p.streetBet = 0;
    }
  }

  private revealIfAllIn() {
    if (!this.revealed && this.live().length >= 2 && this.actors().length <= 1) {
      this.revealed = true;
      for (const p of this.live()) p.shown = true;
      this.emit({ t: 'reveal' });
    }
  }

  private endStreet() {
    this.refundUncalled();
    this.collectBets();
    if (this.live().length === 1) return this.endByFold();
    this.revealIfAllIn();
    this._awaiting = { type: 'advance', delay: 'collect' };
  }

  private endByFold() {
    this.refundUncalled();
    this.collectBets();
    const winner = this.live()[0];
    const total = this.players.reduce((s, p) => s + p.totalBet, 0);
    winner.stack += total;
    this.result = {
      byFold: true,
      totals: { [winner.id]: total },
      potTotal: total,
      pots: [
        {
          amount: total,
          eligible: [winner.id],
          parts: [{ board: 0, side: 'all', amount: total, winners: [winner.id], shares: { [winner.id]: total } }],
        },
      ],
      hands: [],
    };
    this.street = 'showdown';
    this.emit({ t: 'win', totals: this.result.totals, byFold: true });
    this._awaiting = { type: 'complete' };
  }

  private nextStep(): 'discard' | 'flop' | 'turn' | 'river' | 'showdown' {
    const d = this.info.discard;
    if (this.street === 'preflop') return d?.after === 'preflop' && !this.discardDone ? 'discard' : 'flop';
    if (this.street === 'flop') return d?.after === 'flop' && !this.discardDone ? 'discard' : 'turn';
    if (this.street === 'turn') return 'river';
    return 'showdown';
  }

  /** Moves the hand forward when awaiting `advance` (called by the server after a short pause). */
  advance() {
    if (this._awaiting.type !== 'advance') return;
    const step = this.nextStep();
    if (step === 'discard') {
      const ids: string[] = [];
      for (const p of this.live()) {
        p.needDiscard = true;
        ids.push(p.id);
      }
      this._awaiting = { type: 'discard', playerIds: ids };
      return;
    }
    if (step === 'showdown') return this.showdown();
    const count = step === 'flop' ? 3 : 1;
    for (const b of this.boards) for (let i = 0; i < count; i++) b.push(this.draw());
    this.street = step;
    this.emit({ t: 'street', street: step });
    this.startBettingRound();
  }

  private showdown() {
    this.street = 'showdown';
    const live = this.live();
    for (const p of live) p.shown = true;
    const { rule, mode } = this.info;
    const hi: Record<string, (HandValue | null)[]> = {};
    const lo: Record<string, (LowValue | null)[]> = {};
    for (const p of live) {
      hi[p.id] = this.boards.map((b) => bestHigh(p.hole, b, rule, mode));
      lo[p.id] = this.boards.map((b) => (this.game.hiLo ? bestLowOmaha(p.hole, b) : null));
    }
    const pots = buildPots(this.players.map((p) => ({ id: p.id, amount: p.totalBet, folded: p.folded })));
    const n = this.players.length;
    const order = Array.from({ length: n }, (_, k) => this.players[(this.buttonIdx + 1 + k) % n].id);
    const { results, totals } = settlePots(pots, {
      boards: this.boards.length,
      hiLo: this.game.hiLo,
      hi: (id, b) => hi[id][b]?.score ?? -1,
      lo: (id, b) => lo[id][b]?.score ?? null,
      order,
    });
    for (const [id, amt] of Object.entries(totals)) this.players[this.idx(id)].stack += amt;
    const hands: ShowdownHand[] = live.map((p) => ({
      id: p.id,
      hole: p.hole.slice(),
      boards: this.boards.map((_, b) => {
        const h = hi[p.id][b];
        const l = lo[p.id][b];
        return {
          hi: h ? { name: h.name, short: h.short, cards: h.cards } : null,
          lo: l ? { name: l.name, short: 'Low', cards: l.cards } : null,
        };
      }),
    }));
    const potTotal = pots.reduce((s, p) => s + p.amount, 0);
    this.result = { byFold: false, totals, potTotal, pots: results, hands };
    this.emit({ t: 'win', totals, byFold: false });
    this._awaiting = { type: 'complete' };
  }

  // ------------------------------------------------------------------ queries

  awaiting(): Awaiting {
    return this._awaiting;
  }

  drainEvents(): HandEvent[] {
    const e = this.events;
    this.events = [];
    return e;
  }

  isComplete() {
    return this._awaiting.type === 'complete';
  }

  /** Current stack of every dealt player (chips behind, excluding chips in the pot). */
  stacks(): Record<string, number> {
    const out: Record<string, number> = {};
    for (const p of this.players) out[p.id] = p.stack;
    return out;
  }

  dealtIds(): string[] {
    return this.players.map((p) => p.id);
  }

  isLive(id: string): boolean {
    const p = this.players[this.idx(id)];
    return !!p && !p.folded;
  }

  /** Sum of all chips held by players plus the undistributed pot — must equal the starting total. */
  chipTotal(): number {
    return this.players.reduce((s, p) => s + p.stack + p.streetBet, 0) + (this.result ? 0 : this.collected);
  }

  legal(id: string): FlopLegal | null {
    if (this._awaiting.type !== 'action' || this._awaiting.playerId !== id) return null;
    const p = this.players[this.idx(id)];
    const target = this.callTarget(p);
    const toCall = Math.max(0, target - p.streetBet);
    const callAmount = Math.min(toCall, p.stack);
    const allInTo = p.streetBet + p.stack;
    const structure = this.game.structure;
    let canRaise = this.actors().length >= 2 && allInTo > this.currentBet;
    if (canRaise && p.hasActed) {
      const threshold = structure === 'FL' ? Math.ceil(this.betSize() / 2) : this.lastRaiseSize;
      if (this.currentBet - p.actedAtLevel < threshold) canRaise = false;
    }
    let minRaiseTo = 0;
    let maxRaiseTo = 0;
    if (canRaise) {
      if (structure === 'FL') {
        if (this.betsCount >= 4) canRaise = false;
        const to = this.fullBetLevel + this.betSize();
        minRaiseTo = maxRaiseTo = Math.min(to, allInTo);
      } else {
        minRaiseTo = this.currentBet + this.lastRaiseSize;
        if (structure === 'PL') {
          const potAfterCall = this.potTotal() + (this.currentBet - p.streetBet);
          maxRaiseTo = Math.max(minRaiseTo, this.currentBet + potAfterCall);
        } else maxRaiseTo = allInTo;
        maxRaiseTo = Math.min(maxRaiseTo, allInTo);
        if (allInTo < minRaiseTo) minRaiseTo = maxRaiseTo = allInTo;
      }
    }
    return {
      canFold: true,
      canCheck: toCall === 0,
      canCall: toCall > 0,
      callAmount,
      canRaise,
      isBet: this.currentBet === 0,
      minRaiseTo: canRaise ? minRaiseTo : 0,
      maxRaiseTo: canRaise ? maxRaiseTo : 0,
      allInTo,
      streetBet: p.streetBet,
      stack: p.stack,
      currentBet: this.currentBet,
      potTotal: this.potTotal(),
    };
  }

  // ------------------------------------------------------------------ inputs

  /** Applies a betting action. Throws on an illegal action. */
  act(id: string, action: FlopAction) {
    const legal = this.legal(id);
    if (!legal) throw new Error('Not your turn');
    const i = this.idx(id);
    const p = this.players[i];
    let a = action;
    if (a.type === 'allin') {
      if (legal.canRaise && legal.maxRaiseTo === legal.allInTo) a = { type: 'raise', to: legal.allInTo };
      else if (legal.canCall && legal.callAmount === p.stack) a = { type: 'call' };
      else throw new Error('All-in is not available here');
    }
    switch (a.type) {
      case 'fold':
        p.folded = true;
        p.hasActed = true;
        this.record(p, 'fold', 0);
        break;
      case 'check':
        if (!legal.canCheck) throw new Error('Cannot check');
        p.hasActed = true;
        p.actedAtLevel = this.currentBet;
        this.record(p, 'check', 0);
        break;
      case 'call': {
        if (!legal.canCall) throw new Error('Nothing to call');
        const added = this.put(p, legal.callAmount);
        p.hasActed = true;
        p.actedAtLevel = this.currentBet;
        this.record(p, p.allIn ? 'allin' : 'call', added, p.streetBet);
        break;
      }
      case 'raise': {
        if (!legal.canRaise) throw new Error('Cannot raise');
        const to = Math.floor(Number(a.to));
        if (!Number.isFinite(to) || to < legal.minRaiseTo || to > legal.maxRaiseTo) throw new Error('Invalid raise amount');
        const wasBet = this.currentBet === 0;
        const increment = to - this.currentBet;
        const added = this.put(p, to - p.streetBet);
        if (this.game.structure === 'FL') {
          if (increment * 2 >= this.betSize()) {
            this.betsCount++;
            this.fullBetLevel += this.betSize();
          }
        } else if (increment >= this.lastRaiseSize) {
          this.lastRaiseSize = increment;
        }
        this.currentBet = to;
        p.hasActed = true;
        p.actedAtLevel = to;
        this.record(p, p.allIn ? 'allin' : wasBet ? 'bet' : 'raise', added, to);
        break;
      }
      default:
        throw new Error('Unknown action');
    }
    this.afterAction(i);
  }

  private afterAction(i: number) {
    if (this.live().length === 1) return this.endByFold();
    const next = this.nextNeeding(i);
    if (next >= 0) {
      this._awaiting = { type: 'action', playerId: this.players[next].id };
      return;
    }
    this.endStreet();
  }

  discardCount(): number {
    return this.info.discard?.count ?? 0;
  }

  discard(id: string, cards: Card[]) {
    if (this._awaiting.type !== 'discard') throw new Error('Not discarding now');
    const p = this.players[this.idx(id)];
    if (!p || !p.needDiscard) throw new Error('Nothing to discard');
    const count = this.discardCount();
    const uniq = [...new Set(cards)];
    if (uniq.length !== count || uniq.some((c) => !p.hole.includes(c))) throw new Error(`Choose exactly ${count} of your cards`);
    p.hole = p.hole.filter((c) => !uniq.includes(c));
    p.discards = uniq;
    p.needDiscard = false;
    p.lastAction = { kind: 'discard' };
    this.emit({ t: 'discard', id });
    const pending = this.players.filter((x) => x.needDiscard).map((x) => x.id);
    if (pending.length === 0) {
      this.discardDone = true;
      this._awaiting = { type: 'advance', delay: 'short' };
    } else this._awaiting = { type: 'discard', playerIds: pending };
  }

  /** Picks the cards to throw away for a player who ran out of time. */
  autoDiscardChoice(id: string): Card[] {
    const p = this.players[this.idx(id)];
    const keepN = p.hole.length - this.discardCount();
    let best: Card[] = p.hole.slice(0, keepN);
    let bestScore = -Infinity;
    for (const keep of combinations(p.hole, keepN)) {
      const s = keepScore(keep, this.boards[0], this.info.mode);
      if (s > bestScore) {
        bestScore = s;
        best = keep;
      }
    }
    return p.hole.filter((c) => !best.includes(c));
  }

  /** Default action when the clock runs out (check if possible, else fold; auto-discard). */
  timeout() {
    const aw = this._awaiting;
    if (aw.type === 'action') {
      const legal = this.legal(aw.playerId)!;
      this.act(aw.playerId, legal.canCheck ? { type: 'check' } : { type: 'fold' });
    } else if (aw.type === 'discard') {
      for (const id of aw.playerIds) this.discard(id, this.autoDiscardChoice(id));
    }
  }

  /** Optional show after the hand (e.g. winner without showdown). */
  showCards(id: string) {
    if (!this.isComplete()) throw new Error('Hand still running');
    const p = this.players[this.idx(id)];
    if (!p || p.shown) return;
    p.shown = true;
    this.emit({ t: 'show', id });
  }

  // ------------------------------------------------------------------ view

  view(viewerId: string | null): FlopHandView {
    const viewer = viewerId ? this.players[this.idx(viewerId)] : undefined;
    return {
      family: 'flop',
      handId: this.handId,
      game: this.game,
      street: this.street,
      boards: this.boards.map((b) => b.slice()),
      pot: this.collected,
      potTotal: this.potTotal(),
      currentBet: this.currentBet,
      buttonSeat: this.players[this.buttonIdx].seat,
      sbSeat: this.players[this.sbIdx].seat,
      bbSeat: this.players[this.bbIdx].seat,
      stakes: this.stakes,
      players: this.players.map((p) => ({
        id: p.id,
        seat: p.seat,
        stack: p.stack,
        streetBet: p.streetBet,
        totalBet: p.totalBet,
        folded: p.folded,
        allIn: p.allIn,
        holeCount: p.hole.length,
        hole: p.id === viewerId || p.shown ? p.hole.slice() : null,
        shown: p.shown,
        needDiscard: p.needDiscard,
        lastAction: p.lastAction,
      })),
      awaiting: this._awaiting,
      legal: viewerId ? this.legal(viewerId) : null,
      discardCount: viewer?.needDiscard ? this.discardCount() : 0,
      myDiscards: viewer ? viewer.discards.slice() : [],
      result: this.result,
    };
  }
}

/** Heuristic value of keeping `keep` (used for auto-discard). */
function keepScore(keep: Card[], board: Card[], mode: 'standard' | 'shortdeck'): number {
  const made = board.length >= 3 ? bestHigh(keep, board, 'holdem', mode) : null;
  const ranks = keep.map(rankOf).sort((a, b) => b - a);
  let pre = ranks[0] * 2 + (ranks[1] ?? 0);
  if (ranks.length >= 2 && ranks[0] === ranks[1]) pre += 60 + ranks[0] * 2;
  if (keep.length >= 2 && suitOf(keep[0]) === suitOf(keep[1])) pre += 6;
  if (ranks.length >= 2 && ranks[0] - ranks[1] <= 2 && ranks[0] !== ranks[1]) pre += 3;
  return (made ? made.score * 1000 : 0) + pre;
}
