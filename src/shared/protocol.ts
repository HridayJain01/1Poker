import type { HandEvent, HandView } from './engine';
import type { FlopAction } from './engine/flopHand';
import type { TPAction } from './engine/teenPatti';
import type { Card } from './cards';
import { GameConfig, MAX_SEATS, MIN_SEATS, normalizeGame } from './variants';

export type Avatar =
  | { kind: 'emoji'; emoji: string; color: string }
  | { kind: 'photo'; mediaId: string };

export interface Profile {
  name: string;
  avatar: Avatar;
}

export type RoomMode = 'fixed' | 'custom' | 'dealers';

export interface RoomSettings {
  name: string;
  /** fixed = one game; custom = host switches games any time; dealers = dealer picks each hand. */
  mode: RoomMode;
  game: GameConfig;
  sb: number;
  bb: number;
  ante: number;
  /** Teen Patti boot (ante). */
  boot: number;
  /** Teen Patti chaal limit as a multiple of the boot (0 = no limit). */
  maxStakeMult: number;
  /** Teen Patti pot limit as a multiple of the boot (0 = no limit). */
  potLimitMult: number;
  /** Chips per bank (buy-in). */
  startingStack: number;
  maxSeats: number;
  /** Seconds per decision. */
  actionTime: number;
  rebuy: boolean;
  /** Maximum banks per player (0 = unlimited). */
  maxBanks: number;
}

export interface PublicPlayer {
  id: string;
  name: string;
  avatar: Avatar;
  seat: number | null;
  stack: number;
  banks: number;
  boughtIn: number;
  connected: boolean;
  sittingOut: boolean;
  isHost: boolean;
  /** Dealt into the current hand. */
  dealt: boolean;
  rebuyPending: boolean;
  leavingAfterHand: boolean;
}

export interface LedgerRow {
  id: string;
  name: string;
  banks: number;
  boughtIn: number;
  stack: number;
  net: number;
  left: boolean;
}

export interface HandSummary {
  handNumber: number;
  game: GameConfig;
  potTotal: number;
  byFold: boolean;
  winners: { id: string; name: string; amount: number; hand: string | null }[];
  boards: Card[][];
  at: number;
}

export interface RoomView {
  code: string;
  you: string;
  hostId: string;
  settings: RoomSettings;
  /** Game queued for the next hand (custom rooms). */
  pendingGame: GameConfig | null;
  started: boolean;
  paused: boolean;
  players: PublicPlayer[];
  hand: HandView | null;
  /** True while `hand` is a finished hand being shown. */
  handOver: boolean;
  handNumber: number;
  nextHandAt: number | null;
  /** Deadline for whatever the hand is waiting on (action, discard, side show). */
  deadline: number | null;
  /** Dealer's choice: who is picking, until when. */
  chooser: { playerId: string; deadline: number } | null;
  capacity: number;
  ledger: LedgerRow[];
  history: HandSummary[];
  notice: string | null;
  serverNow: number;
}

export type ChatKind = 'text' | 'sticker' | 'voice' | 'phrase' | 'face' | 'emoji' | 'system';

export interface ChatMessage {
  id: string;
  at: number;
  from: string | null;
  name: string;
  kind: ChatKind;
  text?: string;
  /** Image (sticker / face snap). */
  mediaId?: string;
  /** Sound (voice note / sound sticker). */
  audioId?: string;
  emoji?: string;
  durationMs?: number;
}

export type ChatInput = Omit<ChatMessage, 'id' | 'at' | 'from' | 'name'>;

export interface Ack<T = unknown> {
  ok: boolean;
  error?: string;
  data?: T;
}

export interface ClientToServer {
  'room:create': (p: { profile: Profile; settings: Partial<RoomSettings> }, ack: (r: Ack<{ code: string; token: string; playerId: string }>) => void) => void;
  'room:join': (p: { code: string; profile: Profile; token?: string }, ack: (r: Ack<{ code: string; token: string; playerId: string }>) => void) => void;
  'room:leave': (ack?: (r: Ack) => void) => void;
  'seat:take': (p: { seat: number }, ack?: (r: Ack) => void) => void;
  'seat:leave': (ack?: (r: Ack) => void) => void;
  'player:sitout': (p: { value: boolean }, ack?: (r: Ack) => void) => void;
  'player:rebuy': (ack?: (r: Ack) => void) => void;
  'player:profile': (p: Profile, ack?: (r: Ack) => void) => void;
  'host:start': (ack?: (r: Ack) => void) => void;
  'host:pause': (ack?: (r: Ack) => void) => void;
  'host:settings': (p: Partial<RoomSettings>, ack?: (r: Ack) => void) => void;
  'host:game': (p: { game: GameConfig }, ack?: (r: Ack) => void) => void;
  'host:kick': (p: { playerId: string }, ack?: (r: Ack) => void) => void;
  'host:transfer': (p: { playerId: string }, ack?: (r: Ack) => void) => void;
  'game:act': (p: { handId: number; action: FlopAction | TPAction }, ack?: (r: Ack) => void) => void;
  'game:discard': (p: { handId: number; cards: Card[] }, ack?: (r: Ack) => void) => void;
  'game:see': (p: { handId: number }, ack?: (r: Ack) => void) => void;
  'game:sideshow': (p: { handId: number; accept: boolean }, ack?: (r: Ack) => void) => void;
  'game:show': (p: { handId: number }, ack?: (r: Ack) => void) => void;
  'game:choose': (p: { game: GameConfig }, ack?: (r: Ack) => void) => void;
  'chat:send': (p: ChatInput, ack?: (r: Ack) => void) => void;
}

export interface ServerToClient {
  'room:state': (v: RoomView) => void;
  'room:fx': (e: { handId: number; events: HandEvent[] }) => void;
  'room:kicked': () => void;
  'chat:msg': (m: ChatMessage) => void;
  'chat:history': (m: ChatMessage[]) => void;
  toast: (t: { text: string }) => void;
}

export const DEFAULT_SETTINGS: RoomSettings = {
  name: 'Friday Night Poker',
  mode: 'custom',
  game: { variant: 'holdem', structure: 'NL', omahaCards: 4, hiLo: false, boards: 1 },
  sb: 50,
  bb: 100,
  ante: 0,
  boot: 100,
  maxStakeMult: 128,
  potLimitMult: 0,
  startingStack: 10000,
  maxSeats: 9,
  actionTime: 30,
  rebuy: true,
  maxBanks: 0,
};

export const ACTION_TIMES = [10, 15, 20, 30, 45, 60, 90];
export const MEDIA_ID_RE = /^[a-f0-9]{32}$/;
export const ROOM_CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const ROOM_CODE_LEN = 5;

const clampInt = (v: unknown, def: number, min: number, max: number) => {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN;
  if (!Number.isFinite(n)) return def;
  return Math.min(max, Math.max(min, Math.floor(n)));
};

/** Sanitizes (possibly untrusted) settings on top of a base. */
export function normalizeSettings(input: Partial<RoomSettings> | undefined | null, base: RoomSettings = DEFAULT_SETTINGS): RoomSettings {
  const i = input ?? {};
  const name = typeof i.name === 'string' && i.name.trim() ? i.name.trim().slice(0, 40) : base.name;
  const mode: RoomMode = i.mode === 'fixed' || i.mode === 'custom' || i.mode === 'dealers' ? i.mode : base.mode;
  const game = normalizeGame(i.game ?? base.game);
  const bb = clampInt(i.bb, base.bb, 1, 1_000_000_000);
  const sb = clampInt(i.sb, Math.min(base.sb, bb), 0, bb);
  const ante = clampInt(i.ante, Math.min(base.ante, bb), 0, bb);
  return {
    name,
    mode,
    game,
    sb,
    bb,
    ante,
    boot: clampInt(i.boot, base.boot, 1, 1_000_000_000),
    maxStakeMult: clampInt(i.maxStakeMult, base.maxStakeMult, 0, 1_000_000),
    potLimitMult: clampInt(i.potLimitMult, base.potLimitMult, 0, 10_000_000),
    startingStack: clampInt(i.startingStack, base.startingStack, 1, 1_000_000_000),
    maxSeats: clampInt(i.maxSeats, base.maxSeats, MIN_SEATS, MAX_SEATS),
    actionTime: clampInt(i.actionTime, base.actionTime, 5, 120),
    rebuy: typeof i.rebuy === 'boolean' ? i.rebuy : base.rebuy,
    maxBanks: clampInt(i.maxBanks, base.maxBanks, 0, 1000),
  };
}

/** Normalizes a display name. */
export function cleanName(name: unknown): string {
  const s = typeof name === 'string' ? name.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 16) : '';
  return s || 'Player';
}

export function cleanAvatar(a: unknown): Avatar {
  const x = a as Partial<Avatar> | null;
  if (x && x.kind === 'photo' && typeof (x as { mediaId?: unknown }).mediaId === 'string' && MEDIA_ID_RE.test((x as { mediaId: string }).mediaId))
    return { kind: 'photo', mediaId: (x as { mediaId: string }).mediaId };
  if (x && x.kind === 'emoji') {
    const e = x as { emoji?: unknown; color?: unknown };
    const emoji = typeof e.emoji === 'string' && e.emoji.length > 0 && e.emoji.length <= 16 ? e.emoji : '🦊';
    const color = typeof e.color === 'string' && /^#[0-9a-fA-F]{6}$/.test(e.color) ? e.color : '#7c3aed';
    return { kind: 'emoji', emoji, color };
  }
  return { kind: 'emoji', emoji: '🦊', color: '#7c3aed' };
}
