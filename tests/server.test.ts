import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { spawn, ChildProcess } from 'node:child_process';
import { io as connect, Socket } from 'socket.io-client';
import type { ChatMessage, ClientToServer, RoomView, ServerToClient } from '../src/shared/protocol';
import type { FlopAction, TPAction } from '../src/shared/engine';

const PORT = 3999 + Math.floor(Math.random() * 500);
const URL = `http://localhost:${PORT}`;
let server: ChildProcess;

type C = Socket<ServerToClient, ClientToServer>;

beforeAll(async () => {
  server = spawn(process.execPath, ['--import', 'tsx', 'src/server/index.ts'], {
    env: { ...process.env, PORT: String(PORT) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  await new Promise<void>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('server did not start')), 20000);
    server.stdout!.on('data', (d) => {
      if (String(d).includes('listening')) {
        clearTimeout(t);
        resolve();
      }
    });
    server.stderr!.on('data', (d) => process.stderr.write(d));
  });
});

afterAll(() => {
  server?.kill();
});

interface Bot {
  s: C;
  view: RoomView | null;
  chat: ChatMessage[];
  token?: string;
  id?: string;
  packer?: boolean;
  allIn?: boolean;
}

function makeBot(): Bot {
  const s: C = connect(URL, { transports: ['websocket'], forceNew: true });
  const bot: Bot = { s, view: null, chat: [] };
  s.on('room:state', (v) => {
    bot.view = v;
    autoplay(bot);
  });
  s.on('chat:msg', (m) => bot.chat.push(m));
  return bot;
}

function autoplay(bot: Bot) {
  const v = bot.view!;
  const h = v.hand;
  if (!h || v.handOver) return;
  const aw = h.awaiting;
  if (h.family === 'flop') {
    if (aw.type === 'action' && aw.playerId === v.you && h.legal) {
      const l = h.legal;
      const action: FlopAction = bot.allIn && l.canRaise && l.maxRaiseTo === l.allInTo ? { type: 'allin' } : l.canCheck ? { type: 'check' } : { type: 'call' };
      bot.s.emit('game:act', { handId: h.handId, action });
    } else if (aw.type === 'discard' && h.discardCount > 0) {
      const mine = h.players.find((p) => p.id === v.you)!.hole!;
      bot.s.emit('game:discard', { handId: h.handId, cards: mine.slice(0, h.discardCount) });
    }
  } else {
    if (aw.type === 'action' && aw.playerId === v.you && h.legal) {
      const l = h.legal;
      // bots marked "packer" fold in Teen Patti so hands end without draining stacks
      const action: TPAction = l.canShow ? { type: 'show' } : bot.packer ? { type: 'pack' } : { type: 'chaal' };
      bot.s.emit('game:act', { handId: h.handId, action });
    } else if (aw.type === 'sideshow' && aw.playerId === v.you) {
      bot.s.emit('game:sideshow', { handId: h.handId, accept: true });
    }
  }
}

const call = <T = unknown>(s: C, ev: keyof ClientToServer, ...args: unknown[]) =>
  new Promise<{ ok: boolean; error?: string; data?: T }>((resolve) => (s.emit as (...a: unknown[]) => void)(ev, ...args, resolve));

async function waitFor(pred: () => boolean, ms = 30000, label = 'condition') {
  const start = Date.now();
  while (!pred()) {
    if (Date.now() - start > ms) throw new Error(`timeout waiting for ${label}`);
    await new Promise((r) => setTimeout(r, 50));
  }
}

const profile = (name: string) => ({ name, avatar: { kind: 'emoji' as const, emoji: '🐯', color: '#ff0066' } });

describe('server end-to-end', () => {
  const host = makeBot();
  const b = makeBot();
  const c = makeBot();
  c.packer = true;
  let code = '';

  it('creates a room and lets friends join and sit', async () => {
    const r = await call<{ code: string; token: string; playerId: string }>(host.s, 'room:create', {
      profile: profile('Hriday'),
      settings: { name: 'Test', mode: 'custom', sb: 5, bb: 10, startingStack: 1000, actionTime: 10, maxSeats: 9 },
    });
    expect(r.ok).toBe(true);
    code = r.data!.code;
    expect(code).toMatch(/^[A-Z2-9]{5}$/);
    await waitFor(() => !!host.view, 5000, 'host view');
    expect(host.view!.players[0].seat).toBe(0);
    expect(host.view!.players[0].banks).toBe(1);

    const bad = await call(b.s, 'room:join', { code: 'ZZZZZ', profile: profile('Amit') });
    expect(bad.ok).toBe(false);

    const rb = await call<{ token: string; playerId: string }>(b.s, 'room:join', { code: code.toLowerCase(), profile: profile('Amit') });
    expect(rb.ok).toBe(true);
    b.token = rb.data!.token;
    b.id = rb.data!.playerId;
    const rc = await call<{ token: string; playerId: string }>(c.s, 'room:join', { code, profile: profile('Amit') });
    expect(rc.ok).toBe(true);
    await waitFor(() => (c.view?.players.length ?? 0) === 3, 5000, '3 players');
    // duplicate names get disambiguated
    expect(c.view!.players.map((p) => p.name).sort()).toEqual(['Amit', 'Amit 2', 'Hriday']);

    expect((await call(b.s, 'seat:take', { seat: 0 })).ok).toBe(false); // taken
    expect((await call(b.s, 'seat:take', { seat: 3 })).ok).toBe(true);
    expect((await call(c.s, 'seat:take', { seat: 6 })).ok).toBe(true);
    expect((await call(b.s, 'host:start')).ok).toBe(false); // not host
  });

  it('plays hands and keeps every chip accounted for', async () => {
    expect((await call(host.s, 'host:start')).ok).toBe(true);
    await waitFor(() => (host.view?.history.length ?? 0) >= 3, 60000, 'three hands');
    await waitFor(() => !!host.view?.handOver || !host.view?.hand, 20000, 'between hands');
    const total = host.view!.ledger.reduce((s, r) => s + r.stack, 0);
    expect(total).toBe(3000);
  }, 90000);

  it('switches to Omaha then Teen Patti between hands (custom room)', async () => {
    expect((await call(host.s, 'host:game', { game: { variant: 'omaha', structure: 'PL', omahaCards: 5, hiLo: true, boards: 2 } })).ok).toBe(true);
    await waitFor(() => host.view?.hand?.game.variant === 'omaha', 30000, 'omaha hand');
    const omahaHand = host.view!.hand!.handId;
    expect(host.view!.hand!.players.find((p) => p.id === host.view!.you)!.hole).toHaveLength(5);
    await waitFor(() => (host.view?.history ?? []).some((h) => h.handNumber === omahaHand), 60000, 'omaha hand done');

    expect((await call(host.s, 'host:game', { game: { variant: 'teenpatti' } })).ok).toBe(true);
    await waitFor(() => host.view?.hand?.family === 'teenpatti', 30000, 'teen patti hand');
    const tp = host.view!.hand!.handId;
    await waitFor(() => (host.view?.history ?? []).some((h) => h.handNumber === tp), 60000, 'teen patti done');
    await waitFor(() => !!host.view?.handOver, 20000, 'between hands');
    expect(host.view!.ledger.reduce((s, r) => s + r.stack, 0)).toBe(3000);
  }, 150000);

  it('refuses a new bank while you still have chips', async () => {
    const r = await call(b.s, 'player:rebuy');
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/out of chips/);
  });

  it('counts a new bank when a busted player rebuys', async () => {
    const x = makeBot();
    const y = makeBot();
    x.allIn = true;
    y.allIn = true;
    const r = await call<{ code: string }>(x.s, 'room:create', {
      profile: profile('Bust'),
      settings: { mode: 'fixed', sb: 5, bb: 10, startingStack: 40, actionTime: 10, maxSeats: 2 },
    });
    expect(r.ok).toBe(true);
    expect((await call(y.s, 'room:join', { code: r.data!.code, profile: profile('Lucky') })).ok).toBe(true);
    expect((await call(y.s, 'seat:take', { seat: 1 })).ok).toBe(true);
    expect((await call(x.s, 'host:pause')).ok).toBe(false); // not started yet
    expect((await call(x.s, 'host:start')).ok).toBe(true);
    // everyone shoves every hand until someone is out of chips
    await waitFor(() => !!x.view && x.view.handOver && x.view.players.some((p) => p.stack === 0), 60000, 'someone busts');
    expect((await call(x.s, 'host:pause')).ok).toBe(true);
    const busted = [x, y].find((bot) => bot.view!.players.find((p) => p.id === bot.view!.you)!.stack === 0)!;
    const winner = busted === x ? y : x;
    expect((await call(winner.s, 'player:rebuy')).ok).toBe(false);
    expect((await call(busted.s, 'player:rebuy')).ok).toBe(true);
    await waitFor(() => busted.view!.players.find((p) => p.id === busted.view!.you)!.banks === 2, 5000, 'bank #2');
    const row = busted.view!.ledger.find((l) => l.id === busted.view!.you)!;
    expect(row.banks).toBe(2);
    expect(row.boughtIn).toBe(80);
    expect(row.stack).toBe(40);
    expect(busted.view!.ledger.reduce((s, l) => s + l.stack, 0)).toBe(120);
    x.s.disconnect();
    y.s.disconnect();
  }, 90000);

  it('reconnects to the same seat with the saved token', async () => {
    b.s.disconnect();
    await waitFor(() => host.view!.players.find((p) => p.id === b.id)!.connected === false, 5000, 'disconnect seen');
    const b2 = makeBot();
    const r = await call<{ playerId: string }>(b2.s, 'room:join', { code, profile: profile('Amit'), token: b.token });
    expect(r.ok).toBe(true);
    expect(r.data!.playerId).toBe(b.id);
    await waitFor(() => !!b2.view, 5000, 'b2 view');
    expect(b2.view!.players.find((p) => p.id === b.id)!.seat).toBe(3);
    b.s = b2.s;
    b.view = b2.view;
  });

  it('relays chat and validates media uploads', async () => {
    expect((await call(c.s, 'chat:send', { kind: 'text', text: 'nice hand 😂' })).ok).toBe(true);
    await waitFor(() => host.chat.some((m) => m.text === 'nice hand 😂'), 5000, 'chat');

    const png = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000a49444154789c6300010000050001', 'hex');
    const up = await fetch(`${URL}/api/media`, { method: 'POST', headers: { 'Content-Type': 'image/png' }, body: png });
    const j = (await up.json()) as { ok: boolean; id: string };
    expect(j.ok).toBe(true);
    const got = await fetch(`${URL}/api/media/${j.id}`);
    expect(got.headers.get('content-type')).toBe('image/png');
    expect(Buffer.from(await got.arrayBuffer()).equals(png)).toBe(true);

    const html = await fetch(`${URL}/api/media`, { method: 'POST', headers: { 'Content-Type': 'text/html' }, body: '<script>alert(1)</script>' });
    expect(html.status).toBe(415);
    const fake = await fetch(`${URL}/api/media`, { method: 'POST', headers: { 'Content-Type': 'image/png' }, body: '<script>alert(1)</script>' });
    expect(fake.status).toBe(415);

    // first a message sent too fast is rejected by the flood guard
    const tooFast = await call(c.s, 'chat:send', { kind: 'sticker', mediaId: j.id, emoji: '🔥', text: 'all in' });
    expect(tooFast.error).toMatch(/Slow down/);
    await new Promise((r) => setTimeout(r, 300));
    expect((await call(c.s, 'chat:send', { kind: 'sticker', mediaId: j.id, emoji: '🔥', text: 'all in' })).ok).toBe(true);
    await new Promise((r) => setTimeout(r, 300));
    await waitFor(() => host.chat.some((m) => m.kind === 'sticker' && m.mediaId === j.id), 5000, 'sticker');
    expect((await call(c.s, 'chat:send', { kind: 'sticker', mediaId: 'f'.repeat(32) })).ok).toBe(false);
  });

  it('lets the host remove a player', async () => {
    const kicked = new Promise<void>((resolve) => c.s.once('room:kicked', () => resolve()));
    const cid = c.view!.you;
    expect((await call(host.s, 'host:kick', { playerId: cid })).ok).toBe(true);
    await kicked;
    await waitFor(() => !host.view!.players.some((p) => p.id === cid && !p.leavingAfterHand), 20000, 'kicked player gone');
    // still in the ledger so the settlement stays correct
    expect(host.view!.ledger.some((r) => r.id === cid)).toBe(true);
    host.s.disconnect();
    b.s.disconnect();
    c.s.disconnect();
  }, 30000);
});
