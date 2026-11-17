import { Card, Rng, shuffle } from '../cards';

/**
 * Returns a deck to be drawn with pop(). Normally a full shuffle; for tests a preset
 * dealing order can be forced (remaining cards follow, shuffled).
 */
export function buildDeck(full: Card[], rng: Rng, preset?: Card[]): Card[] {
  if (!preset || preset.length === 0) return shuffle(full, rng);
  for (const c of preset) if (!full.includes(c)) throw new Error(`Preset card not in deck: ${c}`);
  if (new Set(preset).size !== preset.length) throw new Error('Duplicate preset card');
  const rest = shuffle(full.filter((c) => !preset.includes(c)), rng);
  return [...preset, ...rest].reverse();
}
