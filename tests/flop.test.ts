import { describe, expect, it } from 'vitest';
import { FlopHand, potFractionRaiseTo } from '../src/shared/engine/flopHand';
import { seededRng } from '../src/shared/cards';
import { GameConfig, normalizeGame } from '../src/shared/variants';

function mk(o: {
  stacks: number[];
  button?: number;
  game?: Partial<GameConfig>;
  sb?: number;
  bb?: number;
  ante?: number;
  preset?: string[];
}) {
  return new FlopHand({
    players: o.stacks.map((s, i) => ({ id: 'p' + i, seat: i, stack: s })),
    buttonSeat: o.button ?? 0,
    game: normalizeGame({ variant: 'holdem', structure: 'NL', ...o.game }),
    stakes: { sb: o.sb ?? 50, bb: o.bb ?? 100, ante: o.ante ?? 0 },
    rng: seededRng(42),
    presetDeck: o.preset,
  });
}

const turn = (h: FlopHand) => {
  const a = h.awaiting();
  return a.type === 'action' ? a.playerId : null;
};
const runAdvances = (h: FlopHand) => {
  let guard = 0;
  while (h.awaiting().type === 'advance' && guard++ < 50) h.advance();
};
const total = (h: FlopHand) => h.chipTotal();

describe("Hold'em flow", () => {
  it('heads-up: button posts the small blind, acts first preflop and last after', () => {
    const h = mk({ stacks: [1000, 1000] });
    const v = h.view(null);
    expect(v.sbSeat).toBe(0);
    expect(v.bbSeat).toBe(1);
    expect(turn(h)).toBe('p0');
    h.act('p0', { type: 'call' });
    expect(turn(h)).toBe('p1');
    expect(h.legal('p1')!.canCheck).toBe(true);
    h.act('p1', { type: 'check' });
    expect(h.awaiting().type).toBe('advance');
    h.advance();
    expect(h.view(null).street).toBe('flop');
    expect(h.view(null).boards[0]).toHaveLength(3);
    expect(turn(h)).toBe('p1');
  });

  it('gives the big blind its option when everyone limps', () => {
    const h = mk({ stacks: [1000, 1000, 1000] });
    expect(turn(h)).toBe('p0'); // button is first to act three-handed (after BB)
    h.act('p0', { type: 'call' });
    h.act('p1', { type: 'call' });
    expect(turn(h)).toBe('p2');
    const l = h.legal('p2')!;
    expect(l.canCheck).toBe(true);
    expect(l.canRaise).toBe(true);
    expect(l.minRaiseTo).toBe(200);
    h.act('p2', { type: 'raise', to: 400 });
    expect(turn(h)).toBe('p0');
    expect(h.legal('p0')!.callAmount).toBe(300);
  });

  it('enforces no-limit minimum raises', () => {
    const h = mk({ stacks: [5000, 5000, 5000, 5000] });
    expect(turn(h)).toBe('p3');
    expect(h.legal('p3')!.minRaiseTo).toBe(200);
    expect(() => h.act('p3', { type: 'raise', to: 150 })).toThrow();
    h.act('p3', { type: 'raise', to: 300 });
    const l = h.legal('p0')!;
    expect(l.minRaiseTo).toBe(500);
    expect(l.maxRaiseTo).toBe(5000);
    h.act('p0', { type: 'raise', to: 1000 });
    expect(h.legal('p1')!.minRaiseTo).toBe(1700);
  });

  it('a short all-in does not reopen the betting', () => {
    // seats: p0 button, p1 sb, p2 bb, p3 utg, p4
    const h = mk({ stacks: [450, 5000, 5000, 5000, 5000] });
    h.act('p3', { type: 'raise', to: 300 });
    h.act('p4', { type: 'call' });
    h.act('p0', { type: 'allin' }); // 450: only +150, less than a full raise of 200
    h.act('p1', { type: 'fold' });
    h.act('p2', { type: 'fold' });
    expect(turn(h)).toBe('p3');
    let l = h.legal('p3')!;
    expect(l.canCall).toBe(true);
    expect(l.callAmount).toBe(150);
    expect(l.canRaise).toBe(false);
    h.act('p3', { type: 'call' });
    l = h.legal('p4')!;
    expect(l.canRaise).toBe(false);
    h.act('p4', { type: 'call' });
    expect(h.awaiting().type).toBe('advance');
  });

  it('a player who has not acted yet may still re-raise after a short all-in', () => {
    const h = mk({ stacks: [450, 5000, 5000, 5000, 5000] });
    h.act('p3', { type: 'raise', to: 300 });
    h.act('p4', { type: 'fold' });
    h.act('p0', { type: 'allin' }); // 450 (+150, incomplete)
    const l = h.legal('p1')!;
    expect(l.canRaise).toBe(true);
    expect(l.minRaiseTo).toBe(650); // last full raise (200) on top of 450
  });

  it('cumulative short all-ins that add up to a full raise do reopen', () => {
    const h = mk({ stacks: [420, 520, 5000, 5000, 5000] });
    h.act('p3', { type: 'raise', to: 300 });
    h.act('p4', { type: 'call' });
    h.act('p0', { type: 'allin' }); // 420 (+120)
    h.act('p1', { type: 'allin' }); // 520 (+100)
    h.act('p2', { type: 'fold' });
    expect(turn(h)).toBe('p3');
    const l = h.legal('p3')!;
    expect(l.canRaise).toBe(true); // facing 220 more >= 200
    expect(l.minRaiseTo).toBe(720);
  });

  it('no raising when nobody else can act', () => {
    const h = mk({ stacks: [5000, 300, 5000] });
    h.act('p0', { type: 'raise', to: 1000 });
    h.act('p1', { type: 'allin' });
    const l = h.legal('p2')!;
    expect(l.canRaise).toBe(true); // p0 can still act
    h.act('p2', { type: 'fold' });
    expect(h.awaiting().type).toBe('advance'); // p0 has nothing to respond to
  });

  it('computes pot-limit maximums', () => {
    const h = mk({ stacks: [1000, 1000, 1000], sb: 1, bb: 2, game: { structure: 'PL' } });
    expect(h.legal('p0')!.maxRaiseTo).toBe(7);
    h.act('p0', { type: 'raise', to: 7 });
    expect(h.legal('p1')!.maxRaiseTo).toBe(23);
    expect(h.legal('p1')!.minRaiseTo).toBe(12);
    expect(() => h.act('p1', { type: 'raise', to: 24 })).toThrow();
    h.act('p1', { type: 'raise', to: 23 });
    // pot = 23 + 2 + 7 = 32, bb calls 21 -> 53, raise 53 -> to 76
    expect(h.legal('p2')!.maxRaiseTo).toBe(76);
  });

  it('pot fraction presets', () => {
    const h = mk({ stacks: [1000, 1000, 1000], sb: 1, bb: 2 });
    const l = h.legal('p0')!;
    expect(potFractionRaiseTo(l, 1)).toBe(7);
    expect(potFractionRaiseTo(l, 0.5)).toBe(4);
  });

  it('fixed limit uses small/big bets and caps at four bets', () => {
    const h = mk({ stacks: [1000, 1000, 1000, 1000], sb: 1, bb: 2, game: { structure: 'FL' } });
    let l = h.legal('p3')!;
    expect([l.minRaiseTo, l.maxRaiseTo]).toEqual([4, 4]);
    h.act('p3', { type: 'raise', to: 4 });
    h.act('p0', { type: 'raise', to: 6 });
    h.act('p1', { type: 'raise', to: 8 });
    l = h.legal('p2')!;
    expect(l.canRaise).toBe(false);
    expect(l.callAmount).toBe(6);
    h.act('p2', { type: 'call' });
    h.act('p3', { type: 'call' });
    h.act('p0', { type: 'call' });
    runAdvances(h);
    expect(h.view(null).street).toBe('flop');
    expect(h.legal(turn(h)!)!.minRaiseTo).toBe(2);
    for (const _ of [0, 1, 2, 3]) h.act(turn(h)!, { type: 'check' });
    runAdvances(h);
    expect(h.view(null).street).toBe('turn');
    expect(h.legal(turn(h)!)!.minRaiseTo).toBe(4);
  });

  it('returns uncalled chips and runs out the board when all-in', () => {
    const h = mk({ stacks: [1000, 300], preset: ['As', 'Kc', 'Ad', 'Kd', '2c', '7d', '9h', 'Js', '3s'] });
    const start = total(h);
    h.act('p0', { type: 'allin' });
    h.act('p1', { type: 'call' });
    expect(h.view(null).players.every((p) => p.shown)).toBe(true);
    runAdvances(h);
    expect(h.isComplete()).toBe(true);
    expect(h.view(null).boards[0]).toEqual(['2c', '7d', '9h', 'Js', '3s']);
    expect(h.stacks()).toEqual({ p0: 700, p1: 600 });
    expect(total(h)).toBe(start);
    expect(h.result!.hands.find((x) => x.id === 'p1')!.boards[0].hi!.name).toBe('Pair of Aces');
  });

  it('awards the pot when everyone folds', () => {
    const h = mk({ stacks: [1000, 1000, 1000] });
    h.act('p0', { type: 'raise', to: 300 });
    h.act('p1', { type: 'fold' });
    h.act('p2', { type: 'fold' });
    expect(h.isComplete()).toBe(true);
    expect(h.result!.byFold).toBe(true);
    expect(h.stacks()).toEqual({ p0: 1150, p1: 950, p2: 900 });
    expect(h.view('p1').players[0].hole).toBeNull();
    h.showCards('p0');
    expect(h.view('p1').players[0].hole).toHaveLength(2);
  });

  it('handles a big blind that is all-in for less', () => {
    const h = mk({ stacks: [1000, 1000, 60] });
    expect(h.view(null).players[2].allIn).toBe(true);
    expect(h.legal('p0')!.callAmount).toBe(100);
    h.act('p0', { type: 'call' });
    h.act('p1', { type: 'call' });
    // BB is all-in -> no option, street ends
    expect(h.awaiting().type).toBe('advance');
    h.advance();
    expect(h.view(null).street).toBe('flop');
    expect(h.view(null).pot).toBe(260);
    expect(turn(h)).toBe('p1');
    h.act('p1', { type: 'check' });
    h.act('p0', { type: 'check' });
    runAdvances(h);
    while (!h.isComplete()) {
      h.act(turn(h)!, { type: 'check' });
      runAdvances(h);
    }
    const pots = h.result!.pots;
    expect(pots.map((p) => p.amount)).toEqual([180, 80]);
    expect(pots[1].eligible.sort()).toEqual(['p0', 'p1']);
  });

  it('times out to check, or fold when facing a bet', () => {
    const h = mk({ stacks: [1000, 1000, 1000] });
    h.timeout();
    expect(h.view(null).players[0].folded).toBe(true);
    h.act('p1', { type: 'call' });
    h.timeout(); // bb can check
    expect(h.view(null).players[2].folded).toBe(false);
    expect(h.awaiting().type).toBe('advance');
  });

  it('applies antes as dead money', () => {
    const h = mk({ stacks: [1000, 1000, 1000], ante: 10 });
    expect(h.view(null).pot).toBe(30);
    expect(h.view(null).potTotal).toBe(180);
    h.act('p0', { type: 'fold' });
    h.act('p1', { type: 'fold' });
    expect(h.stacks()).toEqual({ p0: 990, p1: 940, p2: 1070 });
  });
});

describe('discard games', () => {
  it('Irish: four cards, discard two after the flop betting', () => {
    const h = mk({ stacks: [1000, 1000, 1000], game: { variant: 'irish', structure: 'PL' } });
    expect(h.view('p0').players[0].hole).toHaveLength(4);
    h.act('p0', { type: 'call' });
    h.act('p1', { type: 'call' });
    h.act('p2', { type: 'check' });
    runAdvances(h);
    expect(h.view(null).street).toBe('flop');
    h.act('p1', { type: 'check' });
    h.act('p2', { type: 'check' });
    h.act('p0', { type: 'check' });
    h.advance();
    expect(h.awaiting().type).toBe('discard');
    const v = h.view('p0');
    expect(v.discardCount).toBe(2);
    const mine = v.players[0].hole!;
    expect(() => h.discard('p0', [mine[0]])).toThrow();
    expect(() => h.discard('p0', [mine[0], 'Zz'])).toThrow();
    h.discard('p0', [mine[0], mine[1]]);
    expect(h.view('p0').players[0].hole).toEqual(mine.slice(2));
    expect(h.view('p0').myDiscards).toEqual(mine.slice(0, 2));
    h.timeout(); // auto-discard the rest
    expect(h.view('p1').players[1].hole).toHaveLength(2);
    h.advance();
    expect(h.view(null).street).toBe('turn');
    expect(turn(h)).toBe('p1');
  });

  it('Pineapple: discard one before the flop', () => {
    const h = mk({ stacks: [1000, 1000], game: { variant: 'pineapple' } });
    expect(h.view('p0').players[0].hole).toHaveLength(3);
    h.act('p0', { type: 'call' });
    h.act('p1', { type: 'check' });
    h.advance();
    expect(h.awaiting().type).toBe('discard');
    expect(h.view(null).boards[0]).toHaveLength(0);
    h.timeout();
    h.advance();
    expect(h.view(null).street).toBe('flop');
    expect(h.view('p0').players[0].hole).toHaveLength(2);
  });

  it('Crazy Pineapple: discard one after the flop', () => {
    const h = mk({ stacks: [1000, 1000], game: { variant: 'crazypineapple' } });
    h.act('p0', { type: 'call' });
    h.act('p1', { type: 'check' });
    h.advance();
    expect(h.view(null).street).toBe('flop');
    h.act('p1', { type: 'check' });
    h.act('p0', { type: 'check' });
    h.advance();
    expect(h.awaiting().type).toBe('discard');
    expect(h.view(null).boards[0]).toHaveLength(3);
  });
});

describe('Omaha hi-lo, double board', () => {
  it('splits each board and each half correctly', () => {
    const h = mk({
      stacks: [100, 100],
      sb: 1,
      bb: 2,
      game: { variant: 'omaha', structure: 'PL', hiLo: true, boards: 2 },
      // deal: p1,p0 x4 | flop b0 | flop b1 | turn b0 | turn b1 | river b0 | river b1
      preset: ['Ac', 'Qs', '2c', 'Qd', 'Kh', 'Js', 'Kd', 'Jd', '3h', '4h', '5s', 'Qh', 'Jh', '8c', 'Kc', '7s', '9d', '6s'],
    });
    h.act('p0', { type: 'call' });
    h.act('p1', { type: 'check' });
    runAdvances(h);
    while (!h.isComplete()) {
      h.act(turn(h)!, { type: 'check' });
      runAdvances(h);
    }
    const v = h.view(null);
    expect(v.boards).toEqual([
      ['3h', '4h', '5s', 'Kc', '9d'],
      ['Qh', 'Jh', '8c', '7s', '6s'],
    ]);
    expect(h.result!.totals).toEqual({ p1: 3, p0: 1 });
    expect(h.stacks()).toEqual({ p0: 99, p1: 101 });
    const p0 = h.result!.hands.find((x) => x.id === 'p0')!;
    expect(p0.boards[1].hi!.name).toBe('Three of a Kind, Queens');
    expect(p0.boards[0].lo).toBeNull();
    const p1 = h.result!.hands.find((x) => x.id === 'p1')!;
    expect(p1.boards[0].hi!.short).toBe('Straight');
    expect(p1.boards[1].lo!.name).toBe('8-7-6-2-A low');
  });

  it('refuses more players than the deck can deal', () => {
    expect(() => mk({ stacks: Array(8).fill(1000), game: { variant: 'omaha', omahaCards: 6 } })).toThrow();
    expect(() => mk({ stacks: Array(7).fill(1000), game: { variant: 'omaha', omahaCards: 6 } })).not.toThrow();
  });
});
