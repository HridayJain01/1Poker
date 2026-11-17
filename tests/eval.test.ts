import { describe, expect, it } from 'vitest';
import { bestHigh, bestLowOmaha, eval5, evalTeenPatti, low5 } from '../src/shared/eval';
import { combinations, makeDeck } from '../src/shared/cards';

const h = (s: string) => s.trim().split(/\s+/);
const score = (s: string, mode: 'standard' | 'shortdeck' = 'standard') => eval5(h(s), mode).score;

describe('five-card evaluator (standard)', () => {
  it('orders every category correctly', () => {
    const ladder = [
      'As Ks Qs Js Ts', // royal
      '9h 8h 7h 6h 5h', // straight flush
      '5d 4d 3d 2d Ad', // steel wheel
      'Qc Qd Qh Qs 2c', // quads
      'Jc Jd Jh 4s 4c', // full house
      'Ah Th 7h 4h 2h', // flush
      'Tc 9d 8h 7s 6c', // straight
      '5c 4d 3h 2s Ac', // wheel straight
      '8c 8d 8h Ks 2c', // trips
      'Kc Kd 7h 7s Ac', // two pair
      'Ac Ad Kh 7s 2c', // pair
      'Ac Qd 9h 7s 3c', // high card
    ];
    for (let i = 0; i < ladder.length - 1; i++) expect(score(ladder[i])).toBeGreaterThan(score(ladder[i + 1]));
    expect(eval5(h(ladder[0])).name).toBe('Royal Flush');
    expect(eval5(h(ladder[2])).cat).toBe('straightflush');
    expect(eval5(h(ladder[7])).name).toBe('Straight, Five high');
  });

  it('compares kickers and pairs', () => {
    expect(score('Ac Ad Kh 7s 2c')).toBeGreaterThan(score('Ah As Qh Js Tc'));
    expect(score('Kc Kd 7h 7s 2c')).toBeGreaterThan(score('Kh Ks 6h 6s Ac'));
    expect(score('Kc Kd 7h 7s 3c')).toBeGreaterThan(score('Kh Ks 7d 7c 2c'));
    expect(score('Ah Th 7h 4h 3h')).toBeGreaterThan(score('Ad Td 7d 4d 2d'));
    expect(score('Jc Jd Jh 2s 2c')).toBeGreaterThan(score('Tc Td Th As Ac'));
    expect(score('6c 5d 4h 3s 2c')).toBeGreaterThan(score('5c 4d 3h 2s Ac'));
    expect(score('Ac Kd Qh Js 9c')).toBe(score('Ad Kc Qs Jh 9d'));
  });

  it('describes hands', () => {
    expect(eval5(h('Jc Jd Jh 4s 4c')).name).toBe('Full House, Jacks full of Fours');
    expect(eval5(h('Kc Kd 7h 7s Ac')).name).toBe('Two Pair, Kings and Sevens');
    expect(eval5(h('Ac Ad Kh 7s 2c')).name).toBe('Pair of Aces');
    // display order: grouped cards first, wheel ace last
    expect(eval5(h('Ac 2d 3h 4s 5c')).cards).toEqual(h('5c 4s 3h 2d Ac'));
    expect(eval5(h('7c Ad 7h As 7s')).cards.map((c) => c[0]).join('')).toBe('777AA');
  });
});

describe('short deck evaluator', () => {
  it('flush beats full house, trips beat straight', () => {
    expect(score('Ah Th 8h 7h 6h', 'shortdeck')).toBeGreaterThan(score('Kc Kd Kh 6s 6c', 'shortdeck'));
    expect(score('8c 8d 8h Ks 7c', 'shortdeck')).toBeGreaterThan(score('Tc 9d 8h 7s 6c', 'shortdeck'));
    expect(score('Kc Kd Kh Ks 6c', 'shortdeck')).toBeGreaterThan(score('Ah Th 8h 7h 6h', 'shortdeck'));
  });
  it('A-6-7-8-9 is the lowest straight', () => {
    const v = eval5(h('Ac 6d 7h 8s 9c'), 'shortdeck');
    expect(v.cat).toBe('straight');
    expect(v.name).toBe('Straight, Nine high');
    expect(score('Tc 9d 8h 7s 6c', 'shortdeck')).toBeGreaterThan(v.score);
    expect(v.score).toBeGreaterThan(score('Ac Ad Kh Qs Jc', 'shortdeck'));
    // A-2-3-4-5 is not a straight in standard terms for short deck
    expect(eval5(h('Ac 2d 3h 4s 5c'), 'shortdeck').cat).toBe('high');
  });
});

describe('best-hand selection', () => {
  it("Hold'em uses any five of seven (board can play)", () => {
    const v = bestHigh(h('2c 3d'), h('As Ks Qs Js Ts'), 'holdem')!;
    expect(v.name).toBe('Royal Flush');
    const w = bestHigh(h('Ah Kh'), h('Qh Jh Th 2c 3d'), 'holdem')!;
    expect(w.name).toBe('Royal Flush');
  });

  it('Omaha must use exactly two hole cards', () => {
    // Four spades on board, one spade in hand -> no flush in Omaha.
    const v = bestHigh(h('As Kd 7c 2h'), h('Qs Js 9s 3s 4d'), 'omaha')!;
    expect(v.cat).not.toBe('flush');
    expect(bestHigh(h('As Kd 7c 2h'), h('Qs Js 9s 3s 4d'), 'holdem')!.cat).toBe('flush');
    // Two spades in hand -> flush.
    expect(bestHigh(h('As Ks 7c 2h'), h('Qs Js 9s 3d 4d'), 'omaha')!.cat).toBe('flush');
    // Quads on board are not quads in Omaha.
    const q = bestHigh(h('2c 3d 5h 7s'), h('Ac Ad Ah As Kd'), 'omaha')!;
    expect(q.cat).toBe('trips');
    // Board trips + pocket pair = full house.
    expect(bestHigh(h('Kc Kd 5h 7s'), h('Ac Ad Ah 2s 3d'), 'omaha')!.name).toBe('Full House, Aces full of Kings');
  });

  it('agrees with brute force on random 7-card hands', () => {
    const deck = makeDeck();
    let seed = 7;
    const rnd = (n: number) => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed % n;
    };
    for (let t = 0; t < 200; t++) {
      const d = deck.slice();
      const cards: string[] = [];
      for (let i = 0; i < 7; i++) cards.push(d.splice(rnd(d.length), 1)[0]);
      const best = bestHigh(cards.slice(0, 2), cards.slice(2), 'holdem')!;
      const brute = Math.max(...combinations(cards, 5).map((c) => eval5(c).score));
      expect(best.score).toBe(brute);
    }
  });
});

describe('eight-or-better low', () => {
  it('qualifies and ranks lows', () => {
    expect(low5(h('Ac 2d 3h 4s 5c'))!.name).toBe('5-4-3-2-A low');
    expect(low5(h('8c 7d 6h 4s 3c'))).not.toBeNull();
    expect(low5(h('9c 7d 6h 4s 3c'))).toBeNull();
    expect(low5(h('Ac Ad 3h 4s 5c'))).toBeNull();
    expect(low5(h('Ac 2d 3h 4s 6c'))!.score).toBeGreaterThan(low5(h('Ac 2d 3h 5s 6c'))!.score);
    expect(low5(h('Ac 2d 3h 4s 5c'))!.score).toBeGreaterThan(low5(h('Ac 2d 3h 4s 6c'))!.score);
    expect(low5(h('7c 6d 5h 4s 3c'))!.score).toBeGreaterThan(low5(h('8c 4d 3h 2s Ac'))!.score);
  });
  it('Omaha low uses exactly two hole cards', () => {
    // Only one low card in hand -> no low.
    expect(bestLowOmaha(h('Ac Kd Qh Js'), h('2c 3d 4h 9s Td'))).toBeNull();
    expect(bestLowOmaha(h('Ac 2d Qh Js'), h('3c 4d 5h 9s Td'))!.name).toBe('5-4-3-2-A low');
    // Board without three low cards -> nobody has a low.
    expect(bestLowOmaha(h('Ac 2d 3h 4s'), h('5c 9d Th Js Qd'))).toBeNull();
  });
});

describe('Teen Patti evaluator', () => {
  const tp = (s: string, m = false) => evalTeenPatti(h(s), m).score;
  it('ranks categories', () => {
    const ladder = ['Ac Ad Ah', '2c 2d 2h', 'Ah Kh Qh', 'Ah 2h 3h', '4c 3c 2c', 'Ah Kd Qc', 'Ah 2d 3c', 'Kh Qd Jc', '4h 3d 2c', 'Ah Jh 9h', 'Kh Qh Th', 'Ac Ad Kh', 'Ac Ad 2h', 'Kc Kd Ah', 'Ac Kd Jh', 'Ac Kd Th', '5c 3d 2h'];
    for (let i = 0; i < ladder.length - 1; i++) expect(tp(ladder[i])).toBeGreaterThan(tp(ladder[i + 1]));
  });
  it('names hands', () => {
    expect(evalTeenPatti(h('Ah 2d 3c')).name).toBe('Sequence A-2-3');
    expect(evalTeenPatti(h('Qs Ks As')).name).toBe('Pure Sequence A-K-Q');
    expect(evalTeenPatti(h('7c 7d 7h')).name).toBe('Trail of Sevens');
    expect(evalTeenPatti(h('Kc 5d 5h')).name).toBe('Pair of Fives');
    expect(evalTeenPatti(h('Kc 5c 9c')).cat).toBe('color');
  });
  it('treats non-sequences correctly', () => {
    expect(evalTeenPatti(h('Ah Kd 2c')).cat).toBe('high');
    expect(evalTeenPatti(h('Qh Kd 2c')).cat).toBe('high');
  });
  it('Muflis reverses everything', () => {
    expect(tp('5c 3d 2h', true)).toBeGreaterThan(tp('Ac Kd Jh', true));
    expect(tp('Ac Kd Jh', true)).toBeGreaterThan(tp('2c 2d 3h', true));
    // normally a sequence beats a color; in Muflis the color wins
    expect(tp('4h 3d 2c', true)).toBeLessThan(tp('Ah Jh 9h', true));
    expect(tp('Ac Ad Ah', true)).toBeLessThan(tp('2c 2d 2h', true));
  });
});
