import { describe, expect, it } from 'vitest';
import { TeenPattiHand } from '../src/shared/engine/teenPatti';
import { seededRng } from '../src/shared/cards';
import { normalizeGame } from '../src/shared/variants';

function mk(o: { stacks: number[]; button?: number; boot?: number; maxStake?: number; potLimit?: number; preset?: string[]; muflis?: boolean }) {
  return new TeenPattiHand({
    players: o.stacks.map((s, i) => ({ id: 'p' + i, seat: i, stack: s })),
    buttonSeat: o.button ?? 0,
    game: normalizeGame({ variant: o.muflis ? 'muflis' : 'teenpatti' }),
    stakes: { boot: o.boot ?? 10, maxStake: o.maxStake ?? 0, potLimit: o.potLimit ?? 0 },
    rng: seededRng(9),
    presetDeck: o.preset,
  });
}
const turn = (h: TeenPattiHand) => {
  const a = h.awaiting();
  return a.type === 'action' ? a.playerId : null;
};

describe('Teen Patti', () => {
  it('collects the boot and applies blind/seen amounts', () => {
    const h = mk({ stacks: [1000, 1000, 1000] });
    expect(h.view(null).pot).toBe(30);
    expect(turn(h)).toBe('p1');
    let l = h.legal('p1')!;
    expect([l.chaalAmount, l.raiseAmount, l.seen]).toEqual([10, 20, false]);
    h.act('p1', { type: 'chaal' });
    h.see('p2');
    l = h.legal('p2')!;
    expect([l.chaalAmount, l.raiseAmount, l.seen]).toEqual([20, 40, true]);
    h.act('p2', { type: 'chaal' });
    h.act('p0', { type: 'raise' }); // blind raise: pays 20, stake becomes 20
    expect(h.view(null).stake).toBe(20);
    expect(h.legal('p1')!.chaalAmount).toBe(20);
    h.act('p1', { type: 'chaal' });
    expect(h.legal('p2')!.chaalAmount).toBe(40);
    expect(h.view(null).pot).toBe(30 + 10 + 20 + 20 + 20);
  });

  it('hides cards from blind players until they look', () => {
    const h = mk({ stacks: [1000, 1000] });
    expect(h.view('p1').players[1].hole).toBeNull();
    expect(h.view('p1').myHandName).toBeNull();
    h.see('p1');
    expect(h.view('p1').players[1].hole).toHaveLength(3);
    expect(h.view('p1').myHandName).toBeTruthy();
    expect(h.view('p0').players[1].hole).toBeNull();
    expect(h.view('p0').players[1].seen).toBe(true);
  });

  it('show between two players decides the pot', () => {
    // deal order: p1, p0, p1, p0, p1, p0
    const h = mk({ stacks: [1000, 1000], preset: ['Ah', '2c', 'Ad', '7d', 'As', '9h'] });
    expect(h.legal('p1')!.canShow).toBe(true);
    expect(h.legal('p1')!.canSideshow).toBe(false);
    h.act('p1', { type: 'show' });
    expect(h.awaiting().type).toBe('advance');
    h.advance();
    expect(h.isComplete()).toBe(true);
    expect(h.result!.totals).toEqual({ p1: 30 });
    expect(h.stacks()).toEqual({ p0: 990, p1: 1010 });
    expect(h.result!.hands.find((x) => x.id === 'p1')!.boards[0].hi!.name).toBe('Trail of Aces');
  });

  it('show is not allowed with three active players', () => {
    const h = mk({ stacks: [1000, 1000, 1000] });
    expect(h.legal('p1')!.canShow).toBe(false);
    expect(() => h.act('p1', { type: 'show' })).toThrow();
  });

  it('side show: loser packs, and the requester loses ties', () => {
    // deal order p1,p2,p0 x3. p1 = trail of 2s, p2 = A-K-J high, p0 = random
    const h = mk({ stacks: [1000, 1000, 1000], preset: ['2c', 'Ah', '5s', '2d', 'Kd', '6s', '2h', 'Jc', '8d'] });
    h.see('p1');
    h.act('p1', { type: 'chaal' });
    h.see('p2');
    let l = h.legal('p2')!;
    expect(l.canSideshow).toBe(true);
    expect(l.sideshowTarget).toBe('p1');
    h.act('p2', { type: 'sideshow' });
    expect(h.awaiting()).toEqual({ type: 'sideshow', playerId: 'p1', fromId: 'p2' });
    expect(h.view('p1').sideshow).toEqual({ from: 'p2', to: 'p1' });
    h.respondSideshow('p1', true);
    const v = h.view(null);
    expect(v.players[2].folded).toBe(true);
    expect(v.players[1].folded).toBe(false);
    // both saw each other's cards
    expect(h.view('p1').players[2].hole).toHaveLength(3);
    expect(h.view('p2').players[1].hole).toHaveLength(3);
    expect(h.view('p0').players[1].hole).toBeNull();
    expect(turn(h)).toBe('p0');
    l = h.legal('p0')!;
    expect(l.canShow).toBe(true);
  });

  it('side show tie: requester packs', () => {
    const h = mk({ stacks: [1000, 1000, 1000], preset: ['Ac', 'Ah', '5s', 'Kc', 'Kh', '6s', '9c', '9h', '8d'] });
    h.see('p1');
    h.act('p1', { type: 'chaal' });
    h.see('p2');
    h.act('p2', { type: 'sideshow' });
    h.respondSideshow('p1', true);
    expect(h.view(null).players[2].folded).toBe(true);
    expect(h.view(null).players[1].folded).toBe(false);
  });

  it('side show can be denied, and requires a seen previous player', () => {
    const h = mk({ stacks: [1000, 1000, 1000] });
    h.act('p1', { type: 'chaal' }); // p1 still blind
    h.see('p2');
    expect(h.legal('p2')!.canSideshow).toBe(false);
    h.act('p2', { type: 'chaal' });
    h.see('p0');
    expect(h.legal('p0')!.sideshowTarget).toBe('p2');
    h.act('p0', { type: 'sideshow' });
    h.timeout(); // p2 does not answer -> denied
    expect(h.view(null).players.every((p) => !p.folded)).toBe(true);
    expect(turn(h)).toBe('p1');
  });

  it('respects the chaal limit and pot limit', () => {
    const h = mk({ stacks: [1000, 1000, 1000], maxStake: 20, potLimit: 70 });
    h.act('p1', { type: 'raise' }); // stake 20, pot 50
    expect(h.legal('p2')!.canRaise).toBe(false);
    h.act('p2', { type: 'chaal' }); // pot 70 -> forced show
    expect(h.awaiting().type).toBe('advance');
    h.advance();
    expect(h.isComplete()).toBe(true);
    expect(h.result!.hands).toHaveLength(3);
  });

  it('handles a short all-in with a side pot', () => {
    const h = mk({ stacks: [15, 1000] });
    h.act('p1', { type: 'chaal' }); // p1 total 20
    const l = h.legal('p0')!;
    expect(l.chaalIsAllIn).toBe(true);
    expect(l.chaalAmount).toBe(5);
    h.act('p0', { type: 'chaal' }); // all-in total 15
    expect(h.awaiting().type).toBe('advance');
    h.advance();
    const start = 1015;
    expect(Object.values(h.stacks()).reduce((s, x) => s + x, 0)).toBe(start);
    // p1 always gets back the 5 chips nobody could match
    expect(h.stacks().p1).toBeGreaterThanOrEqual(985);
  });

  it('lone player facing a bigger all-in must pack or show', () => {
    const h = mk({ stacks: [1000, 1000, 30] });
    h.act('p1', { type: 'chaal' }); // p1 total 20
    h.act('p2', { type: 'raise' }); // p2 puts its last 20 in: all-in, total 30, stake 20
    expect(h.view(null).players[2].allIn).toBe(true);
    expect(h.view(null).stake).toBe(20);
    h.act('p0', { type: 'pack' });
    // p1 (total 20) vs p2 all-in (total 30): p1 must decide
    expect(turn(h)).toBe('p1');
    const l = h.legal('p1')!;
    expect(l.finalCall).toBe(true);
    expect(l.canShow).toBe(true);
    expect(l.canChaal).toBe(false);
    expect(l.canRaise).toBe(false);
    expect(l.showAmount).toBe(20);
    h.act('p1', { type: 'show' });
    h.advance();
    expect(h.isComplete()).toBe(true);
    expect(h.result!.pots.map((p) => p.amount)).toEqual([70, 10]);
    expect(h.result!.pots[1].eligible).toEqual(['p1']);
  });

  it('times out to pack', () => {
    const h = mk({ stacks: [1000, 1000] });
    h.timeout();
    expect(h.isComplete()).toBe(true);
    expect(h.result!.byFold).toBe(true);
    expect(h.stacks()).toEqual({ p0: 1010, p1: 990 });
  });
});
