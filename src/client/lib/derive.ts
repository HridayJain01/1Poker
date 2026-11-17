import type { Card } from '../../shared/cards';
import type { FlopPlayerView, TPPlayerView, HandView } from '../../shared/engine';
import type { PublicPlayer, RoomView } from '../../shared/protocol';
import { VARIANTS } from '../../shared/variants';

export type HandPlayer = FlopPlayerView | TPPlayerView;

export interface Derived {
  me: PublicPlayer | null;
  hand: HandView | null;
  heroHp: HandPlayer | undefined;
  hp: (id: string) => HandPlayer | undefined;
  actingId: string | null;
  myTurn: boolean;
  isHost: boolean;
  running: boolean;
  winners: Set<string>;
  handNames: Record<string, string>;
  highlight: Set<Card>;
  family: 'flop' | 'teenpatti';
}

export function derive(view: RoomView): Derived {
  const hand = view.hand;
  const me = view.players.find((p) => p.id === view.you) ?? null;
  const map = new Map<string, HandPlayer>();
  if (hand) for (const p of hand.players as HandPlayer[]) map.set(p.id, p);
  const running = !!hand && !view.handOver;
  const actingId = running && hand!.awaiting.type === 'action' ? hand!.awaiting.playerId : null;
  const result = hand?.result ?? null;
  const winners = new Set<string>();
  const handNames: Record<string, string> = {};
  const highlight = new Set<Card>();
  if (result && view.handOver) {
    for (const [id, amt] of Object.entries(result.totals)) if (amt > 0) winners.add(id);
    for (const h of result.hands) {
      const names: string[] = [];
      h.boards.forEach((b) => {
        if (b.hi) names.push(b.hi.short);
        if (b.lo) names.push(b.lo.name.replace(' low', ' lo'));
      });
      handNames[h.id] = [...new Set(names)].slice(0, 2).join(' · ');
    }
    // Highlight the winning five on each board (main pot).
    const main = result.pots[0];
    if (main && !result.byFold) {
      for (const part of main.parts) {
        if (part.side === 'lo') continue;
        const w = part.winners[0];
        const sh = result.hands.find((x) => x.id === w);
        sh?.boards[part.board]?.hi?.cards.forEach((c) => highlight.add(c));
      }
    }
  }
  const family = hand ? hand.family : VARIANTS[view.settings.game.variant].family;
  return {
    me,
    hand,
    heroHp: me ? map.get(me.id) : undefined,
    hp: (id) => map.get(id),
    actingId,
    myTurn: !!me && actingId === me.id,
    isHost: view.hostId === view.you,
    running,
    winners,
    handNames,
    highlight,
    family,
  };
}

export const ACTION_LABEL: Record<string, string> = {
  fold: 'Fold',
  check: 'Check',
  call: 'Call',
  bet: 'Bet',
  raise: 'Raise',
  allin: 'All-in',
  sb: 'SB',
  bb: 'BB',
  ante: 'Ante',
  boot: 'Boot',
  blind: 'Blind',
  chaal: 'Chaal',
  pack: 'Pack',
  see: 'Seen',
  show: 'Show',
  sideshow: 'Side show',
  discard: 'Discarded',
};
