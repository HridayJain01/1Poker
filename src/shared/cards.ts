// Cards are two-character strings: rank + suit, e.g. "As", "Td", "2c".
export type Suit = 's' | 'h' | 'd' | 'c';
export type Card = string;

export const RANK_CHARS = '23456789TJQKA';
export const SUITS: Suit[] = ['s', 'h', 'd', 'c'];

/** Returns 2..14 (Ace = 14). */
export function rankOf(card: Card): number {
  const r = RANK_CHARS.indexOf(card[0]);
  if (r < 0) throw new Error(`Bad card: ${card}`);
  return r + 2;
}

export function suitOf(card: Card): Suit {
  const s = card[1] as Suit;
  if (!SUITS.includes(s)) throw new Error(`Bad card: ${card}`);
  return s;
}

export function isCard(x: unknown): x is Card {
  return typeof x === 'string' && x.length === 2 && RANK_CHARS.includes(x[0]) && (SUITS as string[]).includes(x[1]);
}

/** Standard 52-card deck, or the 36-card short deck (6 through Ace). */
export function makeDeck(shortDeck = false): Card[] {
  const deck: Card[] = [];
  for (const s of SUITS) {
    for (let r = shortDeck ? 4 : 0; r < RANK_CHARS.length; r++) deck.push(RANK_CHARS[r] + s);
  }
  return deck;
}

/** Random integer source: returns an integer in [0, n). */
export type Rng = (n: number) => number;

/** Unbiased Fisher–Yates shuffle (returns a new array). */
export function shuffle<T>(items: T[], rng: Rng): T[] {
  const a = items.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = rng(i + 1);
    const t = a[i];
    a[i] = a[j];
    a[j] = t;
  }
  return a;
}

/** Small deterministic RNG for tests (mulberry32). */
export function seededRng(seed: number): Rng {
  let s = seed >>> 0;
  return (n: number) => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    const x = ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    return Math.floor(x * n);
  };
}

const RANK_NAMES: Record<number, [string, string]> = {
  2: ['Two', 'Twos'],
  3: ['Three', 'Threes'],
  4: ['Four', 'Fours'],
  5: ['Five', 'Fives'],
  6: ['Six', 'Sixes'],
  7: ['Seven', 'Sevens'],
  8: ['Eight', 'Eights'],
  9: ['Nine', 'Nines'],
  10: ['Ten', 'Tens'],
  11: ['Jack', 'Jacks'],
  12: ['Queen', 'Queens'],
  13: ['King', 'Kings'],
  14: ['Ace', 'Aces'],
};

export function rankName(rank: number, plural = false): string {
  const r = rank === 1 ? 14 : rank;
  return RANK_NAMES[r][plural ? 1 : 0];
}

/** Combinations of k items from arr (k small). */
export function combinations<T>(arr: T[], k: number): T[][] {
  const out: T[][] = [];
  const n = arr.length;
  if (k > n || k < 0) return out;
  const idx = Array.from({ length: k }, (_, i) => i);
  for (;;) {
    out.push(idx.map((i) => arr[i]));
    let i = k - 1;
    while (i >= 0 && idx[i] === n - k + i) i--;
    if (i < 0) break;
    idx[i]++;
    for (let j = i + 1; j < k; j++) idx[j] = idx[j - 1] + 1;
  }
  return out;
}
