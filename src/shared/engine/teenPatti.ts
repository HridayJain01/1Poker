import { Card, Rng, makeDeck } from '../cards';
import { buildDeck } from './deck';
import { evalTeenPatti } from '../eval';
import { GameConfig, TeenPattiStakes, VARIANTS, normalizeGame, capacity } from '../variants';
import { buildPots, settlePots } from './pots';
import type { ActionKind, Awaiting, HandEvent, HandResult, HandSeatInput, LastAction, ShowdownHand } from './types';

export type TPAction =
  | { type: 'pack' }
  /** Stay in: pay the stake (blind) or twice the stake (seen). */
  | { type: 'chaal' }
  /** Double the stake: pay 2× (blind) or 4× (seen) the old stake. */
  | { type: 'raise' }
  /** Pay the chaal amount and show (only when two players are left to act). */
  | { type: 'show' }
  /** Seen players only: pay the chaal and ask the previous (seen) player to compare privately. */
  | { type: 'sideshow' };

export interface TPLegal {
  canPack: boolean;
  canChaal: boolean;
  chaalAmount: number;
  chaalIsAllIn: boolean;
  canRaise: boolean;
  raiseAmount: number;
  canShow: boolean;
  showAmount: number;
  canSideshow: boolean;
  sideshowTarget: string | null;
  seen: boolean;
  stake: number;
  stack: number;
  /** Only pack or show is allowed (everyone else is all-in). */
  finalCall: boolean;
}

interface TPPlayer {
  id: string;
  seat: number;
  stack: number;
  hole: Card[];
  folded: boolean;
  allIn: boolean;
  seen: boolean;
  totalBet: number;
  shown: boolean;
  revealedTo: Set<string>;
  lastAction: LastAction | null;
}

export interface TPPlayerView {
  id: string;
  seat: number;
  stack: number;
  totalBet: number;
  folded: boolean;
  allIn: boolean;
  seen: boolean;
  holeCount: number;
  hole: Card[] | null;
  shown: boolean;
  lastAction: LastAction | null;
}

export interface TPHandView {
  family: 'teenpatti';
  handId: number;
  game: GameConfig;
  buttonSeat: number;
  pot: number;
  stake: number;
  stakes: TeenPattiStakes;
  players: TPPlayerView[];
  awaiting: Awaiting;
  legal: TPLegal | null;
  sideshow: { from: string; to: string } | null;
  /** Your own hand name once you have seen your cards. */
  myHandName: string | null;
  result: HandResult | null;
}

export interface TPHandOptions {
  players: HandSeatInput[];
  buttonSeat: number;
  game: GameConfig;
  stakes: TeenPattiStakes;
  rng: Rng;
  handId?: number;
  /** Testing only: the first cards to be dealt, in dealing order. */
  presetDeck?: Card[];
}

export class TeenPattiHand {
  readonly family = 'teenpatti' as const;
  readonly handId: number;
  readonly game: GameConfig;
  readonly stakes: TeenPattiStakes;
  readonly muflis: boolean;
  private players: TPPlayer[];
  private buttonIdx: number;
  private deck: Card[];
  private stake: number;
  private _awaiting: Awaiting = { type: 'complete' };
  private events: HandEvent[] = [];
  private sideshowReq: { from: number; to: number } | null = null;
  result: HandResult | null = null;

  constructor(opts: TPHandOptions) {
    this.game = normalizeGame(opts.game);
    if (VARIANTS[this.game.variant].family !== 'teenpatti') throw new Error('Not a Teen Patti game');
    this.muflis = this.game.variant === 'muflis';
    this.handId = opts.handId ?? 1;
    const boot = Math.max(1, Math.floor(opts.stakes.boot));
    this.stakes = {
      boot,
      maxStake: Math.max(0, Math.floor(opts.stakes.maxStake)),
      potLimit: Math.max(0, Math.floor(opts.stakes.potLimit)),
    };
    const seated = opts.players.filter((p) => p.stack > 0).slice().sort((a, b) => a.seat - b.seat);
    if (seated.length < 2) throw new Error('Need at least two players with chips');
    if (seated.length > capacity(this.game)) throw new Error('Too many players for this game');
    this.players = seated.map((p) => ({
      id: p.id,
      seat: p.seat,
      stack: Math.floor(p.stack),
      hole: [],
      folded: false,
      allIn: false,
      seen: false,
      totalBet: 0,
      shown: false,
      revealedTo: new Set(),
      lastAction: null,
    }));
    let bi = this.players.findIndex((p) => p.seat === opts.buttonSeat);
    if (bi < 0) {
      bi = this.players.findIndex((p) => p.seat > opts.buttonSeat);
      if (bi < 0) bi = 0;
    }
    this.buttonIdx = bi;
    this.deck = buildDeck(makeDeck(false), opts.rng, opts.presetDeck);
    this.stake = boot;
    this.start();
  }

  private idx(id: string) {
    return this.players.findIndex((p) => p.id === id);
  }

  private live() {
    return this.players.filter((p) => !p.folded);
  }

  private actors() {
    return this.players.filter((p) => !p.folded && !p.allIn);
  }

  private pot() {
    return this.players.reduce((s, p) => s + p.totalBet, 0);
  }

  private put(p: TPPlayer, amount: number) {
    const a = Math.min(amount, p.stack);
    p.stack -= a;
    p.totalBet += a;
    if (p.stack === 0) p.allIn = true;
    return a;
  }

  private record(p: TPPlayer, kind: ActionKind, amount: number) {
    p.lastAction = { kind, amount: amount || undefined };
    this.emit({ t: 'act', id: p.id, kind, amount });
  }

  private emit(e: HandEvent) {
    this.events.push(e);
  }

  private start() {
    for (const p of this.players) {
      const a = this.put(p, this.stakes.boot);
      p.lastAction = { kind: 'boot', amount: a };
    }
    const n = this.players.length;
    for (let r = 0; r < 3; r++) for (let k = 1; k <= n; k++) this.players[(this.buttonIdx + k) % n].hole.push(this.deck.pop()!);
    this.emit({ t: 'deal' });
    this.continueFrom(this.buttonIdx);
  }

  /** Whether the lone remaining actor still has to decide (others all-in for more). */
  private finalCallPending(p: TPPlayer) {
    let maxOther = 0;
    for (const o of this.players) if (o !== p && !o.folded) maxOther = Math.max(maxOther, o.totalBet);
    return p.totalBet < maxOther;
  }

  private nextActorAfter(i: number): number {
    const n = this.players.length;
    for (let k = 1; k <= n; k++) {
      const j = (i + k) % n;
      const p = this.players[j];
      if (!p.folded && !p.allIn) return j;
    }
    return -1;
  }

  private prevActorBefore(i: number): number {
    const n = this.players.length;
    for (let k = 1; k < n; k++) {
      const j = (i - k + n) % n;
      const p = this.players[j];
      if (!p.folded && !p.allIn) return j;
    }
    return -1;
  }

  private continueFrom(i: number) {
    const live = this.live();
    if (live.length === 1) return this.endByFold();
    if (this.stakes.potLimit > 0 && this.pot() >= this.stakes.potLimit) {
      this._awaiting = { type: 'advance', delay: 'showdown' };
      return;
    }
    const actors = this.actors();
    if (actors.length === 0) {
      this._awaiting = { type: 'advance', delay: 'showdown' };
      return;
    }
    if (actors.length === 1) {
      const p = actors[0];
      if (this.finalCallPending(p)) this._awaiting = { type: 'action', playerId: p.id };
      else this._awaiting = { type: 'advance', delay: 'showdown' };
      return;
    }
    const next = this.nextActorAfter(i);
    this._awaiting = { type: 'action', playerId: this.players[next].id };
  }

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

  chipTotal(): number {
    return this.players.reduce((s, p) => s + p.stack, 0) + (this.result ? 0 : this.pot());
  }

  legal(id: string): TPLegal | null {
    if (this._awaiting.type !== 'action' || this._awaiting.playerId !== id) return null;
    const i = this.idx(id);
    const p = this.players[i];
    const mult = p.seen ? 2 : 1;
    const chaalAmount = this.stake * mult;
    const raiseAmount = this.stake * 2 * mult;
    const actors = this.actors();
    const finalCall = actors.length === 1;
    const raiseAllowed = this.stakes.maxStake === 0 || this.stake * 2 <= this.stakes.maxStake;
    let sideshowTarget: string | null = null;
    let canSideshow = false;
    if (!finalCall && p.seen && actors.length >= 3 && p.stack > chaalAmount) {
      const j = this.prevActorBefore(i);
      if (j >= 0 && this.players[j].seen) {
        canSideshow = true;
        sideshowTarget = this.players[j].id;
      }
    }
    return {
      canPack: true,
      canChaal: !finalCall,
      chaalAmount: Math.min(chaalAmount, p.stack),
      chaalIsAllIn: p.stack <= chaalAmount,
      canRaise: !finalCall && raiseAllowed && p.stack >= raiseAmount,
      raiseAmount,
      canShow: finalCall || actors.length === 2,
      showAmount: Math.min(chaalAmount, p.stack),
      canSideshow,
      sideshowTarget,
      seen: p.seen,
      stake: this.stake,
      stack: p.stack,
      finalCall,
    };
  }

  /** Look at your cards (any time during the hand). */
  see(id: string) {
    const p = this.players[this.idx(id)];
    if (!p || p.folded || p.seen || this.isComplete()) return;
    p.seen = true;
    this.emit({ t: 'see', id });
  }

  act(id: string, action: TPAction) {
    const legal = this.legal(id);
    if (!legal) throw new Error('Not your turn');
    const i = this.idx(id);
    const p = this.players[i];
    switch (action.type) {
      case 'pack':
        p.folded = true;
        this.record(p, 'pack', 0);
        return this.continueFrom(i);
      case 'chaal': {
        if (!legal.canChaal) throw new Error('Cannot chaal now');
        const added = this.put(p, legal.chaalAmount);
        this.record(p, p.allIn ? 'allin' : p.seen ? 'chaal' : 'blind', added);
        return this.continueFrom(i);
      }
      case 'raise': {
        if (!legal.canRaise) throw new Error('Cannot raise now');
        const added = this.put(p, legal.raiseAmount);
        this.stake *= 2;
        this.record(p, p.allIn ? 'allin' : 'raise', added);
        return this.continueFrom(i);
      }
      case 'show': {
        if (!legal.canShow) throw new Error('Show needs exactly two players left');
        const added = this.put(p, legal.showAmount);
        this.record(p, 'show', added);
        this._awaiting = { type: 'advance', delay: 'showdown' };
        return;
      }
      case 'sideshow': {
        if (!legal.canSideshow || !legal.sideshowTarget) throw new Error('Side show not available');
        const added = this.put(p, legal.chaalAmount);
        this.record(p, 'sideshow', added);
        const j = this.idx(legal.sideshowTarget);
        this.sideshowReq = { from: i, to: j };
        this.emit({ t: 'sideshow', from: p.id, to: legal.sideshowTarget });
        this._awaiting = { type: 'sideshow', playerId: legal.sideshowTarget, fromId: p.id };
        return;
      }
      default:
        throw new Error('Unknown action');
    }
  }

  respondSideshow(id: string, accept: boolean) {
    const aw = this._awaiting;
    if (aw.type !== 'sideshow' || aw.playerId !== id || !this.sideshowReq) throw new Error('No side show to answer');
    const { from, to } = this.sideshowReq;
    this.sideshowReq = null;
    const a = this.players[from];
    const b = this.players[to];
    if (accept) {
      const va = evalTeenPatti(a.hole, this.muflis).score;
      const vb = evalTeenPatti(b.hole, this.muflis).score;
      // Requester loses ties.
      const loser = va > vb ? b : a;
      a.revealedTo.add(b.id);
      b.revealedTo.add(a.id);
      a.seen = true;
      b.seen = true;
      loser.folded = true;
      loser.lastAction = { kind: 'pack' };
      this.emit({ t: 'sideshow', from: a.id, to: b.id, result: 'accepted', loser: loser.id });
    } else {
      this.emit({ t: 'sideshow', from: a.id, to: b.id, result: 'denied' });
    }
    this.continueFrom(from);
  }

  advance() {
    if (this._awaiting.type !== 'advance') return;
    this.showdown();
  }

  private endByFold() {
    const winner = this.live()[0];
    const total = this.pot();
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
    this.emit({ t: 'win', totals: this.result.totals, byFold: true });
    this._awaiting = { type: 'complete' };
  }

  private showdown() {
    const live = this.live();
    for (const p of live) {
      p.shown = true;
      p.seen = true;
    }
    const scores: Record<string, number> = {};
    const hands: ShowdownHand[] = live.map((p) => {
      const v = evalTeenPatti(p.hole, this.muflis);
      scores[p.id] = v.score;
      return { id: p.id, hole: p.hole.slice(), boards: [{ hi: { name: v.name, short: v.short, cards: p.hole.slice() }, lo: null }] };
    });
    const pots = buildPots(this.players.map((p) => ({ id: p.id, amount: p.totalBet, folded: p.folded })));
    const n = this.players.length;
    const order = Array.from({ length: n }, (_, k) => this.players[(this.buttonIdx + 1 + k) % n].id);
    const { results, totals } = settlePots(pots, { boards: 1, hiLo: false, hi: (id) => scores[id], order });
    for (const [id, amt] of Object.entries(totals)) this.players[this.idx(id)].stack += amt;
    this.result = { byFold: false, totals, potTotal: this.pot(), pots: results, hands };
    this.emit({ t: 'win', totals, byFold: false });
    this._awaiting = { type: 'complete' };
  }

  timeout() {
    const aw = this._awaiting;
    if (aw.type === 'action') this.act(aw.playerId, { type: 'pack' });
    else if (aw.type === 'sideshow') this.respondSideshow(aw.playerId, false);
  }

  showCards(id: string) {
    if (!this.isComplete()) throw new Error('Hand still running');
    const p = this.players[this.idx(id)];
    if (!p || p.shown) return;
    p.shown = true;
    this.emit({ t: 'show', id });
  }

  view(viewerId: string | null): TPHandView {
    const viewer = viewerId ? this.players[this.idx(viewerId)] : undefined;
    const aw = this._awaiting;
    return {
      family: 'teenpatti',
      handId: this.handId,
      game: this.game,
      buttonSeat: this.players[this.buttonIdx].seat,
      pot: this.pot(),
      stake: this.stake,
      stakes: this.stakes,
      players: this.players.map((p) => {
        const visible = p.shown || (viewerId !== null && (p.revealedTo.has(viewerId) || (p.id === viewerId && p.seen)));
        return {
          id: p.id,
          seat: p.seat,
          stack: p.stack,
          totalBet: p.totalBet,
          folded: p.folded,
          allIn: p.allIn,
          seen: p.seen,
          holeCount: p.hole.length,
          hole: visible ? p.hole.slice() : null,
          shown: p.shown,
          lastAction: p.lastAction,
        };
      }),
      awaiting: aw,
      legal: viewerId ? this.legal(viewerId) : null,
      sideshow: aw.type === 'sideshow' ? { from: aw.fromId, to: aw.playerId } : null,
      myHandName: viewer && (viewer.seen || viewer.shown) ? evalTeenPatti(viewer.hole, this.muflis).name : null,
      result: this.result,
    };
  }
}
