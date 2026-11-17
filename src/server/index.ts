import express from 'express';
import { createServer } from 'node:http';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomInt } from 'node:crypto';
import { Server, Socket } from 'socket.io';
import { MediaStore, MAX_MEDIA_BYTES, sniffMatches } from './media';
import { Room, SPlayer } from './room';
import {
  Ack,
  ClientToServer,
  MEDIA_ID_RE,
  Profile,
  ROOM_CODE_CHARS,
  ROOM_CODE_LEN,
  ServerToClient,
} from '../shared/protocol';

const PORT = Number(process.env.PORT ?? 3001);
const MAX_ROOMS = 2000;

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', true);
const http = createServer(app);
const io = new Server<ClientToServer, ServerToClient>(http, {
  maxHttpBufferSize: 64 * 1024,
  pingInterval: 10_000,
  pingTimeout: 20_000,
  cors: process.env.CORS_ORIGIN ? { origin: process.env.CORS_ORIGIN.split(',') } : undefined,
});

const media = new MediaStore();
const rooms = new Map<string, Room>();

// ---------------------------------------------------------------------------- HTTP

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, rooms: rooms.size, media: media.stats() });
});

const uploadLog = new Map<string, number[]>();
function uploadAllowed(ip: string) {
  const now = Date.now();
  const list = (uploadLog.get(ip) ?? []).filter((t) => now - t < 10 * 60_000);
  if (list.length >= 150) return false;
  list.push(now);
  uploadLog.set(ip, list);
  return true;
}

app.post('/api/media', express.raw({ type: () => true, limit: MAX_MEDIA_BYTES }), (req, res) => {
  const ip = req.ip ?? 'unknown';
  if (!uploadAllowed(ip)) {
    res.status(429).json({ ok: false, error: 'Too many uploads, try again in a bit' });
    return;
  }
  const type = MediaStore.normalizeType(req.headers['content-type']);
  const body = req.body;
  if (!type) {
    res.status(415).json({ ok: false, error: 'Unsupported file type' });
    return;
  }
  if (!Buffer.isBuffer(body) || body.length === 0) {
    res.status(400).json({ ok: false, error: 'Empty upload' });
    return;
  }
  if (!sniffMatches(body, type)) {
    res.status(415).json({ ok: false, error: 'File content does not match its type' });
    return;
  }
  const id = media.put(body, type);
  res.json({ ok: true, id });
});

app.get('/api/media/:id', (req, res) => {
  const id = String(req.params.id);
  const entry = MEDIA_ID_RE.test(id) ? media.get(id) : undefined;
  if (!entry) {
    res.status(404).end();
    return;
  }
  res.setHeader('Content-Type', entry.type);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
  res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
  res.setHeader('Content-Length', String(entry.buf.length));
  res.end(entry.buf);
});

app.use('/api', (_req, res) => {
  res.status(404).json({ ok: false, error: 'Not found' });
});

// Serve the built client (production). In development Vite serves it instead.
const here = dirname(fileURLToPath(import.meta.url));
const clientDir = [resolve(here, '../client'), resolve(process.cwd(), 'dist/client')].find((d) => existsSync(resolve(d, 'index.html')));
if (clientDir) {
  app.use(
    express.static(clientDir, {
      index: false,
      setHeaders(res, path) {
        if (path.includes(`${'/'}assets${'/'}`)) res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
        else res.setHeader('Cache-Control', 'no-cache');
      },
    }),
  );
  app.use((req, res, next) => {
    if (req.method !== 'GET' || req.path.startsWith('/socket.io')) return next();
    res.setHeader('Cache-Control', 'no-cache');
    res.sendFile(resolve(clientDir, 'index.html'));
  });
}

// ---------------------------------------------------------------------------- rooms

function newCode(): string {
  for (let attempt = 0; attempt < 50; attempt++) {
    let c = '';
    for (let i = 0; i < ROOM_CODE_LEN; i++) c += ROOM_CODE_CHARS[randomInt(ROOM_CODE_CHARS.length)];
    if (!rooms.has(c)) return c;
  }
  throw new Error('Could not allocate a room code');
}

function cleanupRooms() {
  const now = Date.now();
  for (const [code, room] of rooms) {
    const idle = now - room.lastActivity;
    const empty = room.connectedCount() === 0;
    if ((empty && idle > 2 * 60 * 60_000) || idle > 24 * 60 * 60_000) {
      room.dispose();
      rooms.delete(code);
    }
  }
}
setInterval(cleanupRooms, 5 * 60_000).unref();

// ---------------------------------------------------------------------------- sockets

type Ctx = { room: Room; player: SPlayer };

io.on('connection', (socket: Socket<ClientToServer, ServerToClient>) => {
  // simple per-socket flood guard
  let tokens = 40;
  const refill = setInterval(() => (tokens = Math.min(40, tokens + 20)), 1000);
  socket.on('disconnect', () => clearInterval(refill));

  const ctx = (): Ctx | null => {
    const code = socket.data.roomCode as string | undefined;
    const pid = socket.data.playerId as string | undefined;
    if (!code || !pid) return null;
    const room = rooms.get(code);
    const player = room?.players.get(pid);
    if (!room || !player || player.socketId !== socket.id) return null;
    return { room, player };
  };

  const leaveCurrent = () => {
    const code = socket.data.roomCode as string | undefined;
    if (code) rooms.get(code)?.detach(socket.id);
    if (code) socket.leave(`room:${code}`);
    socket.data.roomCode = undefined;
    socket.data.playerId = undefined;
  };

  const bind = (room: Room, player: SPlayer) => {
    leaveCurrent();
    socket.data.roomCode = room.code;
    socket.data.playerId = player.id;
    room.attach(player, socket.id);
  };

  /** Registers a handler that needs a room; returns an Ack built from an error string (or null). */
  function on<A extends unknown[]>(event: keyof ClientToServer, fn: (c: Ctx, ...args: A) => string | null) {
    socket.on(event, ((...raw: unknown[]) => {
      const ack = typeof raw[raw.length - 1] === 'function' ? (raw.pop() as (r: Ack) => void) : undefined;
      if (--tokens < 0) {
        ack?.({ ok: false, error: 'Too many requests' });
        return;
      }
      const c = ctx();
      if (!c) {
        ack?.({ ok: false, error: 'Not in a room' });
        return;
      }
      try {
        const err = fn(c, ...(raw as A));
        ack?.(err ? { ok: false, error: err } : { ok: true });
      } catch (e) {
        console.error(`[${String(event)}]`, e);
        ack?.({ ok: false, error: 'Something went wrong' });
      }
    }) as never);
  }

  socket.on('room:create', (payload, ack) => {
    if (typeof ack !== 'function') return;
    if (--tokens < 0) return ack({ ok: false, error: 'Too many requests' });
    try {
      if (rooms.size >= MAX_ROOMS) return ack({ ok: false, error: 'Server is full, try again later' });
      const code = newCode();
      const room = new Room(io, code, payload?.settings ?? {}, media);
      rooms.set(code, room);
      const player = room.addPlayer(payload?.profile as Profile);
      room.hostId = player.id;
      bind(room, player);
      room.takeSeat(player, 0);
      ack({ ok: true, data: { code, token: player.token, playerId: player.id } });
    } catch (e) {
      console.error('[room:create]', e);
      ack({ ok: false, error: 'Could not create room' });
    }
  });

  socket.on('room:join', (payload, ack) => {
    if (typeof ack !== 'function') return;
    if (--tokens < 0) return ack({ ok: false, error: 'Too many requests' });
    try {
      const code = String(payload?.code ?? '')
        .toUpperCase()
        .replace(/[^A-Z0-9]/g, '');
      const room = rooms.get(code);
      if (!room) return ack({ ok: false, error: 'Room not found. Check the code.' });
      let player = room.findByToken(typeof payload?.token === 'string' ? payload.token : undefined);
      if (player?.kicked) return ack({ ok: false, error: 'You were removed from this room by the host.' });
      if (player) room.rejoin(player, payload.profile);
      else {
        if (!room.canAcceptNewPlayer()) return ack({ ok: false, error: 'This room is full.' });
        player = room.addPlayer(payload?.profile as Profile);
      }
      bind(room, player);
      ack({ ok: true, data: { code, token: player.token, playerId: player.id } });
    } catch (e) {
      console.error('[room:join]', e);
      ack({ ok: false, error: 'Could not join room' });
    }
  });

  on('room:leave', ({ room, player }) => {
    room.leave(player);
    socket.data.roomCode = undefined;
    socket.data.playerId = undefined;
    return null;
  });
  on('seat:take', ({ room, player }, p: { seat: number }) => room.takeSeat(player, Number(p?.seat)));
  on('seat:leave', ({ room, player }) => room.standUp(player));
  on('player:sitout', ({ room, player }, p: { value: boolean }) => room.setSitOut(player, !!p?.value));
  on('player:rebuy', ({ room, player }) => room.rebuy(player));
  on('player:profile', ({ room, player }, p: Profile) => room.updateProfile(player, p));
  on('host:start', ({ room, player }) => room.hostStart(player));
  on('host:pause', ({ room, player }) => room.hostPause(player));
  on('host:settings', ({ room, player }, p) => room.hostSettings(player, (p ?? {}) as never));
  on('host:game', ({ room, player }, p: { game: never }) => room.hostGame(player, p?.game));
  on('host:kick', ({ room, player }, p: { playerId: string }) => room.kick(player, String(p?.playerId)));
  on('host:transfer', ({ room, player }, p: { playerId: string }) => room.transferHost(player, String(p?.playerId)));
  on('game:act', ({ room, player }, p: { handId: number; action: never }) => room.act(player, Number(p?.handId), p?.action));
  on('game:discard', ({ room, player }, p: { handId: number; cards: unknown }) => room.discard(player, Number(p?.handId), p?.cards));
  on('game:see', ({ room, player }, p: { handId: number }) => room.see(player, Number(p?.handId)));
  on('game:sideshow', ({ room, player }, p: { handId: number; accept: boolean }) => room.sideshowAnswer(player, Number(p?.handId), !!p?.accept));
  on('game:show', ({ room, player }, p: { handId: number }) => room.showCards(player, Number(p?.handId)));
  on('game:choose', ({ room, player }, p: { game: never }) => room.choose(player, p?.game));
  on('chat:send', ({ room, player }, p) => room.sendChat(player, p as never));

  socket.on('disconnect', () => {
    const code = socket.data.roomCode as string | undefined;
    if (code) rooms.get(code)?.detach(socket.id);
  });
});

http.listen(PORT, () => {
  console.log(`1Poker server listening on http://localhost:${PORT}${clientDir ? '' : ' (API only — run Vite for the client)'}`);
});

export { app, http, io, rooms };
