/* Seat geometry: percent positions inside the table area, hero always at the bottom. */

export interface Pt {
  x: number;
  y: number;
}

// Ten slots, clockwise starting from the hero at the bottom.
const PORTRAIT: Pt[] = [
  { x: 50, y: 89 },
  { x: 13, y: 77 },
  { x: 10.5, y: 56 },
  { x: 10.5, y: 35 },
  { x: 19, y: 14 },
  { x: 50, y: 7 },
  { x: 81, y: 14 },
  { x: 89.5, y: 35 },
  { x: 89.5, y: 56 },
  { x: 87, y: 77 },
];

const LANDSCAPE: Pt[] = [
  { x: 50, y: 87 },
  { x: 23, y: 85 },
  { x: 7.5, y: 64 },
  { x: 7.5, y: 34 },
  { x: 25, y: 11 },
  { x: 50, y: 8 },
  { x: 75, y: 11 },
  { x: 92.5, y: 34 },
  { x: 92.5, y: 64 },
  { x: 77, y: 85 },
];

// Which of the ten slots to use for a table of n seats (index 0 = hero).
const SUBSETS: Record<number, number[]> = {
  2: [0, 5],
  3: [0, 3, 7],
  4: [0, 2, 5, 8],
  5: [0, 2, 4, 6, 8],
  6: [0, 1, 3, 5, 7, 9],
  7: [0, 1, 3, 4, 6, 7, 9],
  8: [0, 1, 2, 4, 5, 6, 8, 9],
  9: [0, 1, 2, 3, 4, 6, 7, 8, 9],
  10: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
};

/**
 * Positions for each seat number (0..maxSeats-1). The viewer's seat is placed at the
 * bottom; seats continue clockwise (to the viewer's left first).
 */
export function seatPositions(maxSeats: number, heroSeat: number | null, landscape: boolean): Pt[] {
  const slots = landscape ? LANDSCAPE : PORTRAIT;
  const subset = SUBSETS[Math.max(2, Math.min(10, maxSeats))];
  const base = heroSeat ?? 0;
  const out: Pt[] = [];
  for (let seat = 0; seat < maxSeats; seat++) {
    const k = (seat - base + maxSeats) % maxSeats;
    out[seat] = slots[subset[k]];
  }
  return out;
}

export const CENTER: Pt = { x: 50, y: 47 };

export function towards(from: Pt, to: Pt, f: number): Pt {
  return { x: from.x + (to.x - from.x) * f, y: from.y + (to.y - from.y) * f };
}
