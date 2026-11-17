/** 12,345 */
export function chips(n: number): string {
  return Math.round(n).toLocaleString('en-US');
}

/** 950 · 12.5K · 1.25M — compact for stacks and pots. */
export function chipsShort(n: number): string {
  const a = Math.abs(n);
  const sign = n < 0 ? '-' : '';
  if (a < 10_000) return sign + Math.round(a).toLocaleString('en-US');
  if (a < 1_000_000) {
    const k = a / 1000;
    return sign + (k < 100 ? trim(k.toFixed(1)) : Math.round(k).toString()) + 'K';
  }
  if (a < 1_000_000_000) {
    const m = a / 1_000_000;
    return sign + (m < 100 ? trim(m.toFixed(2)) : Math.round(m).toString()) + 'M';
  }
  return sign + trim((a / 1_000_000_000).toFixed(2)) + 'B';
}

function trim(s: string) {
  return s.replace(/\.0+$/, '').replace(/(\.\d*?)0+$/, '$1');
}

export function signed(n: number): string {
  return (n > 0 ? '+' : n < 0 ? '−' : '') + chips(Math.abs(n));
}

export function seconds(ms: number) {
  return Math.max(0, Math.ceil(ms / 1000));
}

export function cls(...parts: (string | false | null | undefined)[]) {
  return parts.filter(Boolean).join(' ');
}
