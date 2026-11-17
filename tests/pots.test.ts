import { describe, expect, it } from 'vitest';
import { buildPots, settlePots, shareAmong, splitEven } from '../src/shared/engine/pots';

describe('buildPots', () => {
  it('creates main and side pots from all-ins', () => {
    const pots = buildPots([
      { id: 'a', amount: 50, folded: false },
      { id: 'b', amount: 200, folded: false },
      { id: 'c', amount: 500, folded: false },
      { id: 'd', amount: 500, folded: false },
    ]);
    expect(pots).toEqual([
      { amount: 200, eligible: ['a', 'b', 'c', 'd'] },
      { amount: 450, eligible: ['b', 'c', 'd'] },
      { amount: 600, eligible: ['c', 'd'] },
    ]);
  });

  it('puts folded money into the pots without making the folder eligible', () => {
    const pots = buildPots([
      { id: 'a', amount: 50, folded: false },
      { id: 'b', amount: 80, folded: true },
      { id: 'c', amount: 200, folded: false },
      { id: 'd', amount: 200, folded: false },
    ]);
    expect(pots).toEqual([
      { amount: 200, eligible: ['a', 'c', 'd'] },
      { amount: 330, eligible: ['c', 'd'] },
    ]);
    expect(pots.reduce((s, p) => s + p.amount, 0)).toBe(530);
  });

  it('never loses chips even with odd dead money', () => {
    const pots = buildPots([
      { id: 'a', amount: 100, folded: false },
      { id: 'b', amount: 300, folded: true },
    ]);
    expect(pots.reduce((s, p) => s + p.amount, 0)).toBe(400);
    expect(pots.every((p) => p.eligible.length > 0)).toBe(true);
  });
});

describe('splitting', () => {
  it('splits evenly with odd chips to the earliest', () => {
    expect(splitEven(10, 3)).toEqual([4, 3, 3]);
    expect(splitEven(1, 2)).toEqual([1, 0]);
    expect(shareAmong(101, ['c', 'a'], ['a', 'b', 'c'])).toEqual({ a: 51, c: 50 });
  });
});

describe('settlePots', () => {
  const order = ['a', 'b', 'c', 'd'];
  it('awards each side pot to its best eligible hand', () => {
    const pots = buildPots([
      { id: 'a', amount: 50, folded: false },
      { id: 'b', amount: 200, folded: false },
      { id: 'c', amount: 500, folded: false },
      { id: 'd', amount: 500, folded: false },
    ]);
    const hi = { a: 10, b: 5, c: 1, d: 3 } as Record<string, number>;
    const { totals } = settlePots(pots, { boards: 1, hiLo: false, hi: (id) => hi[id], order });
    expect(totals).toEqual({ a: 200, b: 450, d: 600 });
  });

  it('splits hi/lo, and gives the whole share to high when no low qualifies', () => {
    const pots = [{ amount: 101, eligible: ['a', 'b'] }];
    const r1 = settlePots(pots, {
      boards: 1,
      hiLo: true,
      hi: (id) => (id === 'a' ? 9 : 1),
      lo: (id) => (id === 'b' ? 5 : null),
      order,
    });
    expect(r1.totals).toEqual({ a: 51, b: 50 });
    const r2 = settlePots(pots, { boards: 1, hiLo: true, hi: (id) => (id === 'a' ? 9 : 1), lo: () => null, order });
    expect(r2.totals).toEqual({ a: 101 });
    // Scoop: same player best high and best low
    const r3 = settlePots(pots, { boards: 1, hiLo: true, hi: (id) => (id === 'a' ? 9 : 1), lo: (id) => (id === 'a' ? 5 : 1), order });
    expect(r3.totals).toEqual({ a: 101 });
  });

  it('splits across multiple boards', () => {
    const pots = [{ amount: 300, eligible: ['a', 'b', 'c'] }];
    const r = settlePots(pots, {
      boards: 3,
      hiLo: false,
      hi: (id, b) => (b === 0 ? (id === 'a' ? 2 : 1) : b === 1 ? (id === 'b' ? 2 : 1) : 1),
      order,
    });
    // board 0 -> a, board 1 -> b, board 2 -> three-way tie (100 split 34/33/33 from left of button)
    expect(r.totals).toEqual({ a: 100 + 34, b: 100 + 33, c: 33 });
    expect(Object.values(r.totals).reduce((s, x) => s + x, 0)).toBe(300);
  });
});
