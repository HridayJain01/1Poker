const DENOMS: [number, string][] = [
  [1_000_000, '#f59e0b'],
  [100_000, '#ec4899'],
  [25_000, '#06b6d4'],
  [5_000, '#8b5cf6'],
  [1_000, '#facc15'],
  [500, '#a855f7'],
  [100, '#111827'],
  [25, '#16a34a'],
  [5, '#dc2626'],
  [1, '#e5e7eb'],
];

/** Picks up to `max` chip colors that roughly represent an amount. */
export function chipColors(amount: number, max = 4): string[] {
  const out: string[] = [];
  let rest = Math.max(1, Math.floor(amount));
  for (const [v, c] of DENOMS) {
    while (rest >= v && out.length < max) {
      out.push(c);
      rest -= v;
    }
    if (out.length >= max) break;
  }
  return out.length ? out : ['#dc2626'];
}

export function ChipStack({ amount, max = 4 }: { amount: number; max?: number }) {
  const colors = chipColors(amount, max).reverse();
  return (
    <div className="chipstack" style={{ height: 18 + (colors.length - 1) * 3 }}>
      {colors.map((c, i) => (
        <div key={i} className="chip" style={{ ['--c' as string]: c, bottom: i * 3 }} />
      ))}
    </div>
  );
}
