import { randomBytes, randomInt } from 'node:crypto';
import type { Server } from 'socket.io';
import { createHand, HandEngine } from '../shared/engine';
import type { FlopAction } from '../shared/engine/flopHand';
import type { TPAction } from '../shared/engine/teenPatti';
import { isCard } from '../shared/cards';
import { capacity, GameConfig, gameLabel, normalizeGame, VARIANTS } from '../shared/variants';
import {
  Avatar,
  ChatInput,
  ChatMessage,
  ClientToServer,
  cleanAvatar,
  cleanName,
  FUN_SOUND_KEYS,
  HandSummary,
  LedgerRow,
  MEDIA_ID_RE,
  normalizeSettings,
  Profile,
  PublicPlayer,
  RoomSettings,
  RoomView,
  ServerToClient,
} from '../shared/protocol';
import type { MediaStore } from './media';

export interface SPlayer {
  id: string;
  token: string;
  name: string;
  avatar: Avatar;
  socketId: string | null;
  seat: number | null;
  stack: number;
  banks: number;
  boughtIn: number;
  sitOut: boolean;
  missed: number;
  left: boolean;
  kicked: boolean;
  rebuyPending: boolean;
  standAfterHand: boolean;
  leaveAfterHand: boolean;
  chatTimes: number[];
  joinedAt: number;
}

type IO = Server<ClientToServer, ServerToClient>;

const ADVANCE_DELAY: Record<string, number> = {
  collect: 650,
  street: 900,
  runout: 1500,
  showdown: 1300,
  short: 450,
};
const CHOOSE_MS = 20_000;
const SIDESHOW_MS = 15_000;
const MAX_PLAYERS_PER_ROOM = 40;

export const newId = (bytes = 8) => randomBytes(bytes).toString('base64url');

export class Room {
  settings: RoomSettings;
  hostId = '';
  players = new Map<string, SPlayer>();
  hand: HandEngine | null = null;
  handOver = false;
  handNumber = 0;
  buttonSeat: number | null = null;
  started = false;
  paused = false;
  pendingGame: GameConfig | null = null;
  nextHandAt: number | null = null;
  deadline: number | null = null;
  chooser: { playerId: string; deadline: number; buttonSeat: number } | null = null;
  chat: ChatMessage[] = [];
  history: HandSummary[] = [];
  notice: string | null = null;
  lastActivity = Date.now();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private discardDeadline: number | null = null;
  private nextTimer: ReturnType<typeof setTimeout> | null = null;
  private broadcastQueued = false;
  private disposed = false;

  constructor(
    private io: IO,
    readonly code: string,
    settings: Partial<RoomSettings>,
    private media: MediaStore,
  ) {
    this.settings = normalizeSettings(settings);
  }

  get channel() {
    return `room:${this.code}`;
  }

  // ------------------------------------------------------------------ players

  activePlayers(): SPlayer[] {
    return [...this.players.values()].filter((p) => !p.left);
  }

  seated(): SPlayer[] {
    return this.activePlayers().filter((p) => p.seat !== null);
  }

  findByToken(token: string | undefined): SPlayer | undefined {
    if (!token) return undefined;
    for (const p of this.players.values()) if (p.token === token) return p;
    return undefined;
  }

  private uniqueName(name: string, self?: SPlayer): string {
    const taken = new Set(this.activePlayers().filter((p) => p !== self).map((p) => p.name.toLowerCase()));
    if (!taken.has(name.toLowerCase())) return name;
    for (let i = 2; i < 100; i++) {
      const n = `${name.slice(0, 13)} ${i}`;
      if (!taken.has(n.toLowerCase())) return n;
    }
    return name;
  }

  canAcceptNewPlayer() {
    return this.activePlayers().length < MAX_PLAYERS_PER_ROOM;
  }

  addPlayer(profile: Profile): SPlayer {
    const p: SPlayer = {
      id: newId(6),
      token: newId(18),
      name: this.uniqueName(cleanName(profile?.name)),
      avatar: cleanAvatar(profile?.avatar),
      socketId: null,
      seat: null,
      stack: 0,
      banks: 0,
      boughtIn: 0,
      sitOut: false,
      missed: 0,
      left: false,
      kicked: false,
      rebuyPending: false,
      standAfterHand: false,
      leaveAfterHand: false,
      chatTimes: [],
      joinedAt: Date.now(),
    };
    this.players.set(p.id, p);
    if (!this.hostId || !this.players.get(this.hostId) || this.players.get(this.hostId)!.left) this.hostId = p.id;
    this.touch();
    return p;
  }

  /** Re-joining player (same token): restore them. */
  rejoin(p: SPlayer, profile: Profile) {
    if (p.left) {
      p.left = false;
      p.seat = null;
      p.leaveAfterHand = false;
      p.standAfterHand = false;
    }
    p.name = this.uniqueName(cleanName(profile?.name), p);
    p.avatar = cleanAvatar(profile?.avatar);
    if (!this.hostId || this.players.get(this.hostId)?.left) this.hostId = p.id;
    this.touch();
  }

  attach(p: SPlayer, socketId: string) {
    if (p.socketId && p.socketId !== socketId) {
      const old = this.io.sockets.sockets.get(p.socketId);
      if (old) {
        old.emit('toast', { text: 'This seat was opened on another device.' });
        old.leave(this.channel);
        old.data.roomCode = undefined;
      }
    }
    p.socketId = socketId;
    const s = this.io.sockets.sockets.get(socketId);
    s?.join(this.channel);
    s?.emit('chat:history', this.chat);
    this.broadcast();
  }

  detach(socketId: string) {
    for (const p of this.players.values()) {
      if (p.socketId === socketId) {
        p.socketId = null;
        this.broadcast();
      }
    }
  }

  connectedCount() {
    return this.activePlayers().filter((p) => p.socketId).length;
  }

  // ------------------------------------------------------------------ helpers

  private touch() {
    this.lastActivity = Date.now();
  }

  private isRunning() {
    return !!this.hand && !this.handOver;
  }

  private isDealt(p: SPlayer) {
    return this.isRunning() && this.hand!.dealtIds().includes(p.id);
  }

  private minChips() {
    return VARIANTS[this.settings.game.variant].family === 'teenpatti' ? this.settings.boot : this.settings.bb;
  }

  private seatLimit(): number {
    let cap = Math.min(this.settings.maxSeats, capacity(this.settings.game));
    if (this.pendingGame) cap = Math.min(cap, capacity(this.pendingGame));
    return cap;
  }

  private sys(text: string) {
    this.pushChat({ id: newId(6), at: Date.now(), from: null, name: '', kind: 'system', text });
  }

  private pushChat(m: ChatMessage) {
    this.chat.push(m);
    if (this.chat.length > 80) this.chat.splice(0, this.chat.length - 80);
    this.io.to(this.channel).emit('chat:msg', m);
  }

  private toast(p: SPlayer, text: string) {
    if (p.socketId) this.io.to(p.socketId).emit('toast', { text });
  }

  private eligible(): SPlayer[] {
    return this.seated().filter((p) => !p.sitOut && p.stack > 0 && !p.standAfterHand && !p.leaveAfterHand);
  }

  // ------------------------------------------------------------------ seat & bank actions

  takeSeat(p: SPlayer, seat: number): string | null {
    if (!Number.isInteger(seat) || seat < 0 || seat >= this.settings.maxSeats) return 'Invalid seat';
    if (p.seat !== null) {
      if (p.standAfterHand) return 'You are leaving this seat after the hand';
      return 'You are already seated';
    }
    if (this.seated().some((x) => x.seat === seat)) return 'Seat taken';
    if (this.seated().length >= this.seatLimit()) {
      return `Table is full for ${gameLabel(this.pendingGame ?? this.settings.game)} (max ${this.seatLimit()})`;
    }
    p.seat = seat;
    p.sitOut = false;
    p.missed = 0;
    if (p.banks === 0) {
      p.banks = 1;
      p.stack = this.settings.startingStack;
      p.boughtIn = this.settings.startingStack;
      this.sys(`${p.name} sat down with ${fmt(p.stack)} chips (bank #1)`);
    } else this.sys(`${p.name} sat down`);
    this.touch();
    this.maybeStartHand();
    this.broadcast();
    return null;
  }

  standUp(p: SPlayer): string | null {
    if (p.seat === null) return 'You are not seated';
    if (this.isDealt(p)) {
      p.standAfterHand = true;
      this.foldIfActing(p);
    } else {
      p.seat = null;
    }
    this.touch();
    this.broadcast();
    return null;
  }

  setSitOut(p: SPlayer, value: boolean): string | null {
    if (p.seat === null) return 'You are not seated';
    p.sitOut = !!value;
    p.missed = 0;
    this.touch();
    if (!p.sitOut) this.maybeStartHand();
    this.broadcast();
    return null;
  }

  rebuyBlocker(p: SPlayer): string | null {
    if (!this.settings.rebuy) return 'Rebuys are turned off by the host';
    if (this.settings.maxBanks > 0 && p.banks >= this.settings.maxBanks) return `Bank limit reached (${this.settings.maxBanks})`;
    if (p.banks === 0) return 'Take a seat first';
    if (p.stack >= this.minChips()) return 'You can take a new bank once you are out of chips';
    return null;
  }

  rebuy(p: SPlayer): string | null {
    if (this.isDealt(p)) {
      // Chips are locked in the running hand: apply when it ends.
      if (!this.settings.rebuy) return 'Rebuys are turned off by the host';
      p.rebuyPending = true;
      this.broadcast();
      return null;
    }
    const err = this.rebuyBlocker(p);
    if (err) return err;
    this.applyRebuy(p);
    this.maybeStartHand();
    this.broadcast();
    return null;
  }

  private applyRebuy(p: SPlayer) {
    if (this.rebuyBlocker(p)) return;
    p.stack += this.settings.startingStack;
    p.banks += 1;
    p.boughtIn += this.settings.startingStack;
    p.sitOut = false;
    this.sys(`${p.name} took bank #${p.banks} (+${fmt(this.settings.startingStack)})`);
  }

  leave(p: SPlayer) {
    if (this.isDealt(p)) {
      p.leaveAfterHand = true;
      this.foldIfActing(p);
    } else {
      p.seat = null;
      p.left = true;
    }
    if (p.socketId) {
      const s = this.io.sockets.sockets.get(p.socketId);
      s?.leave(this.channel);
      if (s) s.data.roomCode = undefined;
      p.socketId = null;
    }
    this.sys(`${p.name} left the room`);
    if (this.hostId === p.id) this.reassignHost();
    this.touch();
    this.broadcast();
  }

  private reassignHost() {
    const candidates = this.activePlayers().filter((x) => x.id !== this.hostId && !x.leaveAfterHand);
    const next = candidates.find((x) => x.socketId && x.seat !== null) ?? candidates.find((x) => x.socketId) ?? candidates[0];
    if (next) {
      this.hostId = next.id;
      this.sys(`${next.name} is now the host`);
    }
  }

  updateProfile(p: SPlayer, profile: Profile): string | null {
    p.name = this.uniqueName(cleanName(profile?.name), p);
    p.avatar = cleanAvatar(profile?.avatar);
    this.broadcast();
    return null;
  }

  // ------------------------------------------------------------------ host actions

  private requireHost(p: SPlayer) {
    return p.id === this.hostId ? null : 'Only the host can do that';
  }

  hostStart(p: SPlayer): string | null {
    const e = this.requireHost(p);
    if (e) return e;
    this.started = true;
    this.paused = false;
    if (this.eligible().length < 2) this.notice = 'Waiting for at least 2 players with chips…';
    this.maybeStartHand();
    this.broadcast();
    return null;
  }

  hostPause(p: SPlayer): string | null {
    const e = this.requireHost(p);
    if (e) return e;
    if (!this.started) return 'Game has not started';
    this.paused = true;
    if (this.chooser) {
      this.chooser = null;
      this.clearNextTimer();
    }
    if (this.nextTimer && !this.isRunning()) {
      this.clearNextTimer();
      this.nextHandAt = null;
    }
    this.sys('Host paused the game after this hand');
    this.broadcast();
    return null;
  }

  hostSettings(p: SPlayer, partial: Partial<RoomSettings>): string | null {
    const e = this.requireHost(p);
    if (e) return e;
    const next = normalizeSettings({ ...partial, game: this.settings.game }, this.settings);
    const maxSeat = Math.max(-1, ...this.seated().map((x) => x.seat!));
    if (next.maxSeats <= maxSeat) return `Seat ${maxSeat + 1} is occupied — can't reduce the table below ${maxSeat + 1} seats`;
    if (next.maxSeats < this.seated().length) return 'Too many seated players for that table size';
    const changedStakes = next.sb !== this.settings.sb || next.bb !== this.settings.bb || next.ante !== this.settings.ante || next.boot !== this.settings.boot;
    this.settings = next;
    if (changedStakes) {
      const fam = VARIANTS[next.game.variant].family;
      this.sys(
        fam === 'teenpatti'
          ? `Boot changed to ${fmt(next.boot)}${this.isRunning() ? ' from the next hand' : ''}`
          : `Blinds changed to ${fmt(next.sb)}/${fmt(next.bb)}${next.ante ? ` (ante ${fmt(next.ante)})` : ''}${this.isRunning() ? ' from the next hand' : ''}`,
      );
    }
    this.touch();
    this.maybeStartHand();
    this.broadcast();
    return null;
  }

  hostGame(p: SPlayer, gameIn: GameConfig): string | null {
    const e = this.requireHost(p);
    if (e) return e;
    if (this.settings.mode !== 'custom' && this.handNumber > 0) {
      return this.settings.mode === 'fixed' ? 'This room is locked to one game' : "In dealer's choice the dealer picks the game";
    }
    const game = normalizeGame(gameIn);
    const cap = capacity(game);
    if (this.seated().length > cap) return `Too many seated players for ${gameLabel(game)} (max ${cap})`;
    if (this.isRunning()) {
      this.pendingGame = game;
      this.sys(`Next hand: ${gameLabel(game)}`);
    } else {
      this.pendingGame = null;
      this.settings.game = game;
      this.sys(`Game changed to ${gameLabel(game)}`);
    }
    this.touch();
    this.maybeStartHand();
    this.broadcast();
    return null;
  }

  kick(p: SPlayer, targetId: string): string | null {
    const e = this.requireHost(p);
    if (e) return e;
    const t = this.players.get(targetId);
    if (!t || t.left) return 'Player not found';
    if (t.id === p.id) return "You can't remove yourself";
    t.kicked = true;
    if (t.socketId) this.io.to(t.socketId).emit('room:kicked');
    this.leave(t);
    return null;
  }

  transferHost(p: SPlayer, targetId: string): string | null {
    const e = this.requireHost(p);
    if (e) return e;
    const t = this.players.get(targetId);
    if (!t || t.left) return 'Player not found';
    this.hostId = t.id;
    this.sys(`${t.name} is now the host`);
    this.broadcast();
    return null;
  }

  // ------------------------------------------------------------------ game inputs

  private checkHand(handId: number) {
    if (!this.hand || this.hand.handId !== handId) return 'That hand is over';
    return null;
  }

  act(p: SPlayer, handId: number, action: FlopAction | TPAction): string | null {
    const e = this.checkHand(handId);
    if (e) return e;
    if (!this.isRunning()) return 'Hand is over';
    const hand = this.hand!;
    try {
      if (hand.family === 'flop') hand.act(p.id, sanitizeFlopAction(action));
      else hand.act(p.id, sanitizeTPAction(action));
    } catch (err) {
      return (err as Error).message;
    }
    p.missed = 0;
    this.touch();
    this.process();
    return null;
  }

  discard(p: SPlayer, handId: number, cards: unknown): string | null {
    const e = this.checkHand(handId);
    if (e) return e;
    const hand = this.hand!;
    if (hand.family !== 'flop') return 'No discards in this game';
    if (!Array.isArray(cards) || !cards.every(isCard)) return 'Invalid cards';
    try {
      hand.discard(p.id, cards);
    } catch (err) {
      return (err as Error).message;
    }
    p.missed = 0;
    this.process();
    return null;
  }

  see(p: SPlayer, handId: number): string | null {
    const e = this.checkHand(handId);
    if (e) return e;
    const hand = this.hand!;
    if (hand.family !== 'teenpatti') return 'Not Teen Patti';
    hand.see(p.id);
    // Looking at cards must not restart anyone's clock: only push events and state.
    this.flushEvents();
    this.broadcast();
    return null;
  }

  private flushEvents() {
    const hand = this.hand;
    if (!hand) return;
    const events = hand.drainEvents();
    if (events.length) this.io.to(this.channel).emit('room:fx', { handId: hand.handId, events });
  }

  sideshowAnswer(p: SPlayer, handId: number, accept: boolean): string | null {
    const e = this.checkHand(handId);
    if (e) return e;
    const hand = this.hand!;
    if (hand.family !== 'teenpatti') return 'Not Teen Patti';
    try {
      hand.respondSideshow(p.id, !!accept);
    } catch (err) {
      return (err as Error).message;
    }
    p.missed = 0;
    this.process();
    return null;
  }

  showCards(p: SPlayer, handId: number): string | null {
    const e = this.checkHand(handId);
    if (e) return e;
    if (!this.handOver) return 'Wait for the hand to finish';
    try {
      this.hand!.showCards(p.id);
    } catch (err) {
      return (err as Error).message;
    }
    this.flushEvents();
    this.broadcast();
    return null;
  }

  choose(p: SPlayer, gameIn: GameConfig): string | null {
    if (!this.chooser || this.chooser.playerId !== p.id) return "It's not your pick";
    const game = normalizeGame(gameIn);
    const cap = capacity(game);
    if (this.eligible().length > cap) return `Too many players for ${gameLabel(game)} (max ${cap})`;
    this.resolveChoice(game);
    return null;
  }

  sendChat(p: SPlayer, input: ChatInput): string | null {
    const now = Date.now();
    p.chatTimes = p.chatTimes.filter((t) => now - t < 10_000);
    if (p.chatTimes.length >= 12) return 'Slow down a little!';
    if (p.chatTimes.length && now - p.chatTimes[p.chatTimes.length - 1] < 250) return 'Slow down a little!';
    const i = (input ?? {}) as Partial<ChatInput>;
    const str = (v: unknown, max: number) => (typeof v === 'string' ? v.replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, '').trim().slice(0, max) : '');
    const media = (v: unknown) => (typeof v === 'string' && MEDIA_ID_RE.test(v) && this.media.has(v) ? v : undefined);
    const m: ChatMessage = { id: newId(6), at: now, from: p.id, name: p.name, kind: 'text' };
    switch (i.kind) {
      case 'text': {
        const text = str(i.text, 300);
        if (!text) return 'Empty message';
        m.text = text;
        break;
      }
      case 'emoji':
      case 'sticker': {
        m.kind = i.kind;
        m.emoji = str(i.emoji, 16) || undefined;
        m.mediaId = media(i.mediaId);
        m.audioId = media(i.audioId);
        m.text = str(i.text, 40) || undefined;
        m.sound = typeof i.sound === 'string' && FUN_SOUND_KEYS.includes(i.sound) ? i.sound : undefined;
        if (!m.emoji && !m.mediaId) return 'Sticker missing';
        if (i.mediaId && !m.mediaId) return 'Sticker upload expired, try again';
        break;
      }
      case 'voice': {
        m.kind = 'voice';
        m.audioId = media(i.audioId);
        if (!m.audioId) return 'Voice note missing';
        m.durationMs = Math.max(0, Math.min(60_000, Math.floor(Number(i.durationMs) || 0)));
        m.emoji = str(i.emoji, 16) || undefined;
        break;
      }
      case 'phrase': {
        m.kind = 'phrase';
        m.text = str(i.text, 80);
        if (!m.text) return 'Empty phrase';
        m.emoji = str(i.emoji, 16) || undefined;
        m.sound = typeof i.sound === 'string' && FUN_SOUND_KEYS.includes(i.sound) ? i.sound : undefined;
        break;
      }
      case 'face': {
        m.kind = 'face';
        m.mediaId = media(i.mediaId);
        if (!m.mediaId) return 'Photo missing';
        break;
      }
      default:
        return 'Unknown message type';
    }
    p.chatTimes.push(now);
    this.pushChat(m);
    this.touch();
    return null;
  }

  // ------------------------------------------------------------------ hand lifecycle

  private clearTimer() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  private clearNextTimer() {
    if (this.nextTimer) clearTimeout(this.nextTimer);
    this.nextTimer = null;
  }

  private nextButton(el: SPlayer[]): number {
    const seats = el.map((p) => p.seat!).sort((a, b) => a - b);
    if (this.buttonSeat === null) return seats[randomInt(seats.length)];
    return seats.find((s) => s > this.buttonSeat!) ?? seats[0];
  }

  maybeStartHand() {
    if (this.disposed || !this.started || this.paused) return;
    if (this.isRunning() || this.nextTimer || this.chooser) return;
    const el = this.eligible();
    if (el.length < 2) {
      this.notice = 'Waiting for at least 2 players with chips…';
      return;
    }
    const game = this.pendingGame ?? this.settings.game;
    if (this.settings.mode !== 'dealers' && el.length > capacity(game)) {
      this.notice = `Too many players for ${gameLabel(game)} (max ${capacity(game)}). Host: pick another game.`;
      return;
    }
    this.notice = null;
    if (this.settings.mode === 'dealers') this.startChoosing(el);
    else this.startHand(game);
  }

  private startChoosing(el: SPlayer[]) {
    const btn = this.nextButton(el);
    const chooser = el.find((p) => p.seat === btn)!;
    const deadline = Date.now() + CHOOSE_MS;
    this.chooser = { playerId: chooser.id, deadline, buttonSeat: btn };
    this.nextTimer = setTimeout(() => {
      this.nextTimer = null;
      this.resolveChoice(null);
    }, CHOOSE_MS);
    this.broadcast();
  }

  private resolveChoice(game: GameConfig | null) {
    if (!this.chooser) return;
    this.clearNextTimer();
    const btn = this.chooser.buttonSeat;
    this.chooser = null;
    let g = game ?? this.settings.game;
    const el = this.eligible();
    if (el.length > capacity(g)) {
      // Current game cannot seat everyone: fall back to Hold'em, which always fits.
      g = normalizeGame({ variant: 'holdem', structure: 'NL' });
    }
    if (game) {
      const chooser = [...this.players.values()].find((p) => p.seat === btn);
      this.sys(`${chooser?.name ?? 'Dealer'} picked ${gameLabel(g)}`);
    }
    this.settings.game = g;
    this.startHand(g, btn);
  }

  private startHand(game: GameConfig, btnSeat?: number) {
    const el = this.eligible();
    if (el.length < 2) {
      this.notice = 'Waiting for at least 2 players with chips…';
      this.broadcast();
      return;
    }
    const cfg = normalizeGame(game);
    if (el.length > capacity(cfg)) {
      this.notice = `Too many players for ${gameLabel(cfg)} (max ${capacity(cfg)})`;
      this.broadcast();
      return;
    }
    this.pendingGame = null;
    this.settings.game = cfg;
    const s = this.settings;
    this.handNumber += 1;
    this.hand = createHand({
      players: el.map((p) => ({ id: p.id, seat: p.seat!, stack: p.stack })),
      buttonSeat: btnSeat ?? this.nextButton(el),
      game: cfg,
      flopStakes: { sb: s.sb, bb: s.bb, ante: s.ante },
      tpStakes: { boot: s.boot, maxStake: s.boot * s.maxStakeMult, potLimit: s.boot * s.potLimitMult },
      rng: (n) => randomInt(n),
      handId: this.handNumber,
    });
    this.buttonSeat = this.hand.view(null).buttonSeat;
    this.handOver = false;
    this.nextHandAt = null;
    this.notice = null;
    this.process();
  }

  private foldIfActing(p: SPlayer) {
    const hand = this.hand;
    if (!hand || this.handOver) return;
    const aw = hand.awaiting();
    if ((aw.type === 'action' && aw.playerId === p.id) || (aw.type === 'discard' && aw.playerIds.includes(p.id)) || (aw.type === 'sideshow' && aw.playerId === p.id)) {
      this.process();
    }
  }

  private isLeaving(id: string) {
    const p = this.players.get(id);
    return !p || p.left || p.leaveAfterHand || p.standAfterHand;
  }

  /** Drives the hand: schedules timers for whatever it is waiting on. */
  private process() {
    try {
      this.processInner();
    } catch (err) {
      console.error(`[room ${this.code}] hand error`, err);
      this.abortHand();
    }
  }

  /** Last-resort safety net: cancel the hand and give everyone their starting chips back. */
  private abortHand() {
    this.clearTimer();
    if (this.hand) this.hand.drainEvents();
    this.hand = null;
    this.handOver = false;
    this.deadline = null;
    this.discardDeadline = null;
    this.postHandHousekeeping();
    this.sys('Hand cancelled because of an error — all chips were returned.');
    this.clearNextTimer();
    this.nextTimer = setTimeout(() => {
      this.nextTimer = null;
      this.maybeStartHand();
      this.broadcast();
    }, 2000);
    this.broadcast();
  }

  private safely(fn: () => void) {
    return () => {
      try {
        fn();
      } catch (err) {
        console.error(`[room ${this.code}] timer error`, err);
        this.abortHand();
      }
    };
  }

  private processInner(): void {
    const hand = this.hand;
    if (!hand || this.handOver || this.disposed) return;
    this.clearTimer();
    this.flushEvents();
    const aw = hand.awaiting();
    if (aw.type !== 'discard') this.discardDeadline = null;
    switch (aw.type) {
      case 'action': {
        if (this.isLeaving(aw.playerId)) {
          this.deadline = null;
          this.timer = setTimeout(
            this.safely(() => {
              this.timer = null;
              try {
                if (hand.family === 'flop') hand.act(aw.playerId, { type: 'fold' });
                else hand.act(aw.playerId, { type: 'pack' });
              } catch {
                hand.timeout();
              }
              this.process();
            }),
            400,
          );
        } else {
          const ms = this.settings.actionTime * 1000;
          this.deadline = Date.now() + ms;
          this.timer = setTimeout(this.safely(() => this.onTimeout()), ms + 300);
        }
        break;
      }
      case 'discard': {
        if (hand.family === 'flop') {
          const leavers = aw.playerIds.filter((id) => this.isLeaving(id));
          if (leavers.length) {
            for (const id of leavers) hand.discard(id, hand.autoDiscardChoice(id));
            return this.processInner();
          }
        }
        // One clock for the whole discard step (other players discarding must not extend it).
        if (!this.discardDeadline) this.discardDeadline = Date.now() + Math.max(10, Math.min(this.settings.actionTime, 30)) * 1000;
        this.deadline = this.discardDeadline;
        this.timer = setTimeout(this.safely(() => this.onTimeout()), Math.max(0, this.discardDeadline - Date.now()) + 300);
        break;
      }
      case 'sideshow': {
        if (this.isLeaving(aw.playerId) && hand.family === 'teenpatti') {
          hand.respondSideshow(aw.playerId, false);
          return this.processInner();
        }
        this.deadline = Date.now() + SIDESHOW_MS;
        this.timer = setTimeout(this.safely(() => this.onTimeout()), SIDESHOW_MS + 300);
        break;
      }
      case 'advance': {
        this.deadline = null;
        this.timer = setTimeout(
          this.safely(() => {
            this.timer = null;
            hand.advance();
            this.process();
          }),
          ADVANCE_DELAY[aw.delay] ?? 800,
        );
        break;
      }
      case 'complete':
        this.deadline = null;
        this.finishHand();
        break;
    }
    this.broadcast();
  }

  private onTimeout() {
    this.timer = null;
    const hand = this.hand;
    if (!hand || this.handOver) return;
    const aw = hand.awaiting();
    if (aw.type === 'action' || aw.type === 'sideshow') {
      const p = this.players.get(aw.playerId);
      if (p) p.missed += 1;
    } else if (aw.type === 'discard') {
      for (const id of aw.playerIds) {
        const p = this.players.get(id);
        if (p) p.missed += 1;
      }
    }
    hand.timeout();
    this.process();
  }

  /** Sit-outs for missed turns, pending rebuys, and players leaving after the hand. */
  private postHandHousekeeping() {
    for (const p of this.players.values()) {
      if (p.missed >= 2 && p.seat !== null && !p.sitOut) {
        p.sitOut = true;
        p.missed = 0;
        this.toast(p, 'You were sat out after missing turns. Tap "I\'m back" to play.');
      }
      if (p.rebuyPending) {
        p.rebuyPending = false;
        this.applyRebuy(p);
      }
      if (p.leaveAfterHand) {
        p.leaveAfterHand = false;
        p.seat = null;
        p.left = true;
      } else if (p.standAfterHand) {
        p.standAfterHand = false;
        p.seat = null;
      }
    }
  }

  private finishHand() {
    const hand = this.hand!;
    const result = hand.result!;
    const stacks = hand.stacks();
    for (const [id, s] of Object.entries(stacks)) {
      const p = this.players.get(id);
      if (p) p.stack = s;
    }
    this.handOver = true;
    this.deadline = null;

    const view = hand.view(null);
    const handNames: Record<string, string> = {};
    for (const h of result.hands) {
      const names = h.boards.map((b) => b.hi?.name).filter(Boolean);
      handNames[h.id] = names[0] ?? '';
    }
    this.history.unshift({
      handNumber: hand.handId,
      game: hand.game,
      potTotal: result.potTotal,
      byFold: result.byFold,
      winners: Object.entries(result.totals)
        .filter(([, amt]) => amt > 0)
        .map(([id, amount]) => ({ id, name: this.players.get(id)?.name ?? '?', amount, hand: handNames[id] || null })),
      boards: view.family === 'flop' ? view.boards : [],
      at: Date.now(),
    });
    if (this.history.length > 30) this.history.length = 30;

    this.postHandHousekeeping();

    const multi = view.family === 'flop' && view.boards.length > 1;
    const delay = result.byFold ? 2600 : 5200 + (multi ? 1800 : 0) + (result.pots.length > 1 ? 1000 : 0);
    this.nextHandAt = Date.now() + delay;
    this.clearNextTimer();
    this.nextTimer = setTimeout(() => {
      this.nextTimer = null;
      this.nextHandAt = null;
      this.maybeStartHand();
      this.broadcast();
    }, delay);
  }

  // ------------------------------------------------------------------ views

  private stackOf(p: SPlayer): number {
    if (this.isRunning()) {
      const s = this.hand!.stacks()[p.id];
      if (s !== undefined) return s;
    }
    return p.stack;
  }

  private publicPlayer(p: SPlayer): PublicPlayer {
    return {
      id: p.id,
      name: p.name,
      avatar: p.avatar,
      seat: p.seat,
      stack: this.stackOf(p),
      banks: p.banks,
      boughtIn: p.boughtIn,
      connected: !!p.socketId,
      sittingOut: p.sitOut,
      isHost: p.id === this.hostId,
      dealt: this.isDealt(p),
      rebuyPending: p.rebuyPending,
      leavingAfterHand: p.leaveAfterHand || p.standAfterHand,
    };
  }

  ledger(): LedgerRow[] {
    return [...this.players.values()]
      .filter((p) => p.banks > 0)
      .map((p) => ({ id: p.id, name: p.name, banks: p.banks, boughtIn: p.boughtIn, stack: p.stack, net: p.stack - p.boughtIn, left: p.left }))
      .sort((a, b) => b.net - a.net);
  }

  viewFor(p: SPlayer): RoomView {
    return {
      code: this.code,
      you: p.id,
      hostId: this.hostId,
      settings: this.settings,
      pendingGame: this.pendingGame,
      started: this.started,
      paused: this.paused,
      players: this.activePlayers().map((x) => this.publicPlayer(x)),
      hand: this.hand ? this.hand.view(p.id) : null,
      handOver: this.handOver,
      handNumber: this.handNumber,
      nextHandAt: this.nextHandAt,
      deadline: this.deadline,
      chooser: this.chooser ? { playerId: this.chooser.playerId, deadline: this.chooser.deadline } : null,
      capacity: this.seatLimit(),
      ledger: this.ledger(),
      history: this.history.slice(0, 15),
      notice: this.notice,
      serverNow: Date.now(),
    };
  }

  broadcast() {
    if (this.broadcastQueued || this.disposed) return;
    this.broadcastQueued = true;
    setImmediate(() => {
      this.broadcastQueued = false;
      if (this.disposed) return;
      for (const p of this.players.values()) {
        if (p.socketId) this.io.to(p.socketId).emit('room:state', this.viewFor(p));
      }
    });
  }

  dispose() {
    this.disposed = true;
    this.clearTimer();
    this.clearNextTimer();
  }
}

function fmt(n: number) {
  return n.toLocaleString('en-US');
}

function sanitizeFlopAction(a: unknown): FlopAction {
  const x = a as { type?: unknown; to?: unknown };
  switch (x?.type) {
    case 'fold':
    case 'check':
    case 'call':
    case 'allin':
      return { type: x.type };
    case 'raise': {
      const to = Number(x.to);
      if (!Number.isFinite(to)) throw new Error('Invalid amount');
      return { type: 'raise', to: Math.floor(to) };
    }
    default:
      throw new Error('Unknown action');
  }
}

function sanitizeTPAction(a: unknown): TPAction {
  const x = a as { type?: unknown };
  switch (x?.type) {
    case 'pack':
    case 'chaal':
    case 'raise':
    case 'show':
    case 'sideshow':
      return { type: x.type };
    // Friendly aliases so a flop-style client action still maps sensibly.
    case 'fold':
      return { type: 'pack' };
    default:
      throw new Error('Unknown action');
  }
}
