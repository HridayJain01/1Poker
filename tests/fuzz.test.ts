import { describe, expect, it } from 'vitest';
import { createHand, FlopHand, potFractionRaiseTo, TeenPattiHand } from '../src/shared/engine';
import { seededRng } from '../src/shared/cards';
import { capacity, GameConfig, normalizeGame } from '../src/shared/variants';

const CONFIGS: Partial<GameConfig>[] = [
  { variant: 'holdem', structure: 'NL' },
  { variant: 'holdem', structure: 'PL' },
  { variant: 'holdem', structure: 'FL' },
  { variant: 'holdem', structure: 'NL', boards: 2 },
  { variant: 'holdem', structure: 'NL', boards: 3 },
  { variant: 'shortdeck', structure: 'NL' },
  { variant: 'shortdeck', structure: 'NL', boards: 2 },
  { variant: 'pineapple', structure: 'NL' },
  { variant: 'crazypineapple', structure: 'PL' },
  { variant: 'irish', structure: 'PL' },
  { variant: 'irish', structure: 'NL' },
  { variant: 'omaha', structure: 'PL', omahaCards: 4 },
  { variant: 'omaha', structure: 'PL', omahaCards: 4, hiLo: true },
  { variant: 'omaha', structure: 'PL', omahaCards: 5, hiLo: true, boards: 2 },
  { variant: 'omaha', structure: 'PL', omahaCards: 6, boards: 3 },
  { variant: 'omaha', structure: 'NL', omahaCards: 4, hiLo: true, boards: 3 },
  { variant: 'omaha', structure: 'FL', omahaCards: 5, hiLo: true },
  { variant: 'teenpatti' },
  { variant: 'muflis' },
];

function playRandomHand(seed: number, cfgIn: Partial<GameConfig>) {
  const rng = seededRng(seed);
  const game = normalizeGame(cfgIn);
  const cap = capacity(game);
  const n = 2 + rng(cap - 1);
  // choose n distinct seats out of 10
  const chosen: number[] = [];
  while (chosen.length < n) {
    const s = rng(10);
    if (!chosen.includes(s)) chosen.push(s);
  }
  const players = chosen.map((seat, i) => ({ id: 'p' + i, seat, stack: 1 + rng(rng(2) ? 400 : 5000) }));
  const startTotal = players.reduce((s, p) => s + p.stack, 0);
  const bb = 2 + rng(40);
  const hand = createHand({
    players,
    buttonSeat: rng(10),
    game,
    flopStakes: { sb: Math.floor(bb / 2), bb, ante: rng(3) === 0 ? 1 + rng(5) : 0 },
    tpStakes: { boot: 1 + rng(20), maxStake: rng(2) ? 0 : 50 + rng(500), potLimit: rng(3) === 0 ? 200 + rng(3000) : 0 },
    rng,
    handId: seed,
  });
  expect(hand.chipTotal()).toBe(startTotal);
  let steps = 0;
  while (!hand.isComplete()) {
    if (++steps > 2000) throw new Error(`hand did not finish (seed ${seed})`);
    const aw = hand.awaiting();
    if (aw.type === 'advance') hand.advance();
    else if (aw.type === 'discard') {
      const f = hand as FlopHand;
      for (const id of aw.playerIds) {
        if (rng(4) === 0) continue; // let the timeout pick for some
        const v = f.view(id);
        const mine = v.players.find((p) => p.id === id)!.hole!;
        const chosenCards: string[] = [];
        while (chosenCards.length < v.discardCount) {
          const c = mine[rng(mine.length)];
          if (!chosenCards.includes(c)) chosenCards.push(c);
        }
        f.discard(id, chosenCards);
      }
      if (hand.awaiting().type === 'discard') hand.timeout();
    } else if (aw.type === 'sideshow') {
      const t = hand as TeenPattiHand;
      if (rng(3) === 0) t.timeout();
      else t.respondSideshow(aw.playerId, rng(2) === 0);
    } else if (aw.type === 'action') {
      const id = aw.playerId;
      if (rng(25) === 0) {
        hand.timeout();
      } else if (hand.family === 'flop') {
        const l = hand.legal(id)!;
        const opts: (() => void)[] = [];
        if (l.canCheck) opts.push(() => hand.act(id, { type: 'check' }), () => hand.act(id, { type: 'check' }));
        if (l.canCall) opts.push(() => hand.act(id, { type: 'call' }), () => hand.act(id, { type: 'call' }));
        if (l.canRaise) {
          opts.push(() => hand.act(id, { type: 'raise', to: l.minRaiseTo }));
          opts.push(() => hand.act(id, { type: 'raise', to: l.minRaiseTo + rng(l.maxRaiseTo - l.minRaiseTo + 1) }));
          opts.push(() => hand.act(id, { type: 'raise', to: potFractionRaiseTo(l, 0.75) }));
          if (l.maxRaiseTo === l.allInTo) opts.push(() => hand.act(id, { type: 'allin' }));
        }
        if (!l.canCheck) opts.push(() => hand.act(id, { type: 'fold' }));
        opts[rng(opts.length)]();
      } else {
        const t = hand as TeenPattiHand;
        if (rng(3) === 0) t.see(id);
        // a random other player may also look at their cards
        t.see('p' + rng(n));
        const l = t.legal(id)!;
        const opts: (() => void)[] = [];
        if (l.canChaal) opts.push(() => t.act(id, { type: 'chaal' }), () => t.act(id, { type: 'chaal' }), () => t.act(id, { type: 'chaal' }));
        if (l.canRaise) opts.push(() => t.act(id, { type: 'raise' }));
        if (l.canShow) opts.push(() => t.act(id, { type: 'show' }));
        if (l.canSideshow) opts.push(() => t.act(id, { type: 'sideshow' }));
        opts.push(() => t.act(id, { type: 'pack' }));
        opts[rng(opts.length)]();
      }
    }
    expect(hand.chipTotal()).toBe(startTotal);
    for (const s of Object.values(hand.stacks())) expect(s).toBeGreaterThanOrEqual(0);
  }
  const stacks = hand.stacks();
  const end = Object.values(stacks).reduce((s, x) => s + x, 0);
  expect(end).toBe(startTotal);
  const r = hand.result!;
  expect(Object.values(r.totals).reduce((s, x) => s + x, 0)).toBe(r.potTotal);
  for (const pot of r.pots) {
    expect(pot.parts.reduce((s, p) => s + p.amount, 0)).toBe(pot.amount);
    for (const part of pot.parts) {
      expect(Object.values(part.shares).reduce((s, x) => s + x, 0)).toBe(part.amount);
      for (const w of part.winners) expect(pot.eligible).toContain(w);
    }
  }
  // Every non-folded player shows at a real showdown, no one else is listed.
  if (!r.byFold) {
    const view = hand.view(null);
    for (const hnd of r.hands) expect(view.players.find((p) => p.id === hnd.id)!.folded).toBe(false);
  }
  return r;
}

describe('randomized hands (chip conservation & termination)', () => {
  for (const cfg of CONFIGS) {
    it(`${cfg.variant} ${cfg.structure ?? ''} ${cfg.omahaCards ?? ''} ${cfg.hiLo ? 'hilo' : ''} boards=${cfg.boards ?? 1}`, () => {
      let showdowns = 0;
      for (let seed = 1; seed <= 400; seed++) {
        const r = playRandomHand(seed * 7919 + (cfg.variant?.length ?? 0), cfg);
        if (!r.byFold) showdowns++;
      }
      expect(showdowns).toBeGreaterThan(10);
    });
  }
});
