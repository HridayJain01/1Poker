export interface Contribution {
  id: string;
  amount: number;
  folded: boolean;
}

export interface Pot {
  amount: number;
  /** Players (not folded) who can win this pot. */
  eligible: string[];
}

/**
 * Builds the main pot and side pots from each player's total contribution to the hand.
 * Folded players' chips are dead money that goes into the pots up to their contribution level.
 */
export function buildPots(contribs: Contribution[]): Pot[] {
  const live = contribs.filter((c) => !c.folded && c.amount > 0);
  const levels = [...new Set(live.map((c) => c.amount))].sort((a, b) => a - b);
  const pots: Pot[] = [];
  let prev = 0;
  for (const level of levels) {
    let amount = 0;
    for (const c of contribs) amount += Math.min(c.amount, level) - Math.min(c.amount, prev);
    const eligible = live.filter((c) => c.amount >= level).map((c) => c.id);
    if (amount > 0) pots.push({ amount, eligible });
    prev = level;
  }
  // Dead chips above the highest live contribution (should not normally happen once
  // uncalled bets are returned) are added to the last pot so no chip is ever lost.
  const total = contribs.reduce((s, c) => s + c.amount, 0);
  const allocated = pots.reduce((s, p) => s + p.amount, 0);
  if (total > allocated) {
    if (pots.length) pots[pots.length - 1].amount += total - allocated;
    else {
      const fallback = contribs.filter((c) => !c.folded).map((c) => c.id);
      pots.push({ amount: total - allocated, eligible: fallback.length ? fallback : contribs.map((c) => c.id) });
    }
  }
  return pots;
}

/** Splits an amount into n near-equal integer parts; earlier parts get the odd chips. */
export function splitEven(amount: number, n: number): number[] {
  const base = Math.floor(amount / n);
  const rem = amount - base * n;
  return Array.from({ length: n }, (_, i) => base + (i < rem ? 1 : 0));
}

/**
 * Splits an amount between tied winners. Odd chips go to the winners closest to the
 * left of the button, i.e. earliest in `order`.
 */
export function shareAmong(amount: number, winners: string[], order: string[]): Record<string, number> {
  const sorted = winners.slice().sort((a, b) => order.indexOf(a) - order.indexOf(b));
  const parts = splitEven(amount, sorted.length);
  const out: Record<string, number> = {};
  sorted.forEach((id, i) => (out[id] = parts[i]));
  return out;
}

export interface PotPart {
  board: number;
  side: 'hi' | 'lo' | 'all';
  amount: number;
  winners: string[];
  shares: Record<string, number>;
}

export interface PotResult {
  amount: number;
  eligible: string[];
  parts: PotPart[];
}

export interface SettleOptions {
  boards: number;
  hiLo: boolean;
  /** High score for player on board (higher wins). */
  hi: (id: string, board: number) => number;
  /** Low score for player on board, or null if no qualifying low (higher wins). */
  lo?: (id: string, board: number) => number | null;
  /** Seat order starting left of the button (for odd chips). */
  order: string[];
}

function bestOf(ids: string[], score: (id: string) => number): string[] {
  let best = -Infinity;
  let winners: string[] = [];
  for (const id of ids) {
    const s = score(id);
    if (s > best) {
      best = s;
      winners = [id];
    } else if (s === best) winners.push(id);
  }
  return winners;
}

export function settlePots(pots: Pot[], opts: SettleOptions): { results: PotResult[]; totals: Record<string, number> } {
  const totals: Record<string, number> = {};
  const add = (shares: Record<string, number>) => {
    for (const [id, amt] of Object.entries(shares)) totals[id] = (totals[id] ?? 0) + amt;
  };
  const results: PotResult[] = [];
  for (const pot of pots) {
    const parts: PotPart[] = [];
    const boardShares = splitEven(pot.amount, opts.boards);
    for (let b = 0; b < opts.boards; b++) {
      const share = boardShares[b];
      if (share <= 0) continue;
      if (pot.eligible.length === 1) {
        const shares = { [pot.eligible[0]]: share };
        parts.push({ board: b, side: 'all', amount: share, winners: [pot.eligible[0]], shares });
        add(shares);
        continue;
      }
      let lowQualifiers: string[] = [];
      if (opts.hiLo && opts.lo) lowQualifiers = pot.eligible.filter((id) => opts.lo!(id, b) !== null);
      if (lowQualifiers.length > 0) {
        const loAmt = Math.floor(share / 2);
        const hiAmt = share - loAmt;
        const hiWinners = bestOf(pot.eligible, (id) => opts.hi(id, b));
        const loWinners = bestOf(lowQualifiers, (id) => opts.lo!(id, b) as number);
        const hiShares = shareAmong(hiAmt, hiWinners, opts.order);
        const loShares = shareAmong(loAmt, loWinners, opts.order);
        parts.push({ board: b, side: 'hi', amount: hiAmt, winners: hiWinners, shares: hiShares });
        parts.push({ board: b, side: 'lo', amount: loAmt, winners: loWinners, shares: loShares });
        add(hiShares);
        add(loShares);
      } else {
        const winners = bestOf(pot.eligible, (id) => opts.hi(id, b));
        const shares = shareAmong(share, winners, opts.order);
        parts.push({ board: b, side: opts.hiLo ? 'hi' : 'all', amount: share, winners, shares });
        add(shares);
      }
    }
    results.push({ amount: pot.amount, eligible: pot.eligible, parts });
  }
  return { results, totals };
}
