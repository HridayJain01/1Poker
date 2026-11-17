import { io, Socket } from 'socket.io-client';
import type { Ack, ClientToServer, ServerToClient } from '../../shared/protocol';

export const socket: Socket<ServerToClient, ClientToServer> = io({
  transports: ['websocket', 'polling'],
  reconnectionDelay: 500,
  reconnectionDelayMax: 3000,
});

/** Emits an event and resolves with the server's ack (or a timeout error). */
export function request<T = unknown>(event: keyof ClientToServer, payload?: unknown, timeoutMs = 8000): Promise<Ack<T>> {
  return new Promise((resolve) => {
    let done = false;
    const t = setTimeout(() => {
      if (done) return;
      done = true;
      resolve({ ok: false, error: socket.connected ? 'Server did not respond' : 'Connection lost — reconnecting…' });
    }, timeoutMs);
    const cb = (r: Ack<T>) => {
      if (done) return;
      done = true;
      clearTimeout(t);
      resolve(r ?? { ok: false, error: 'No response' });
    };
    const emit = socket.emit as unknown as (...a: unknown[]) => void;
    if (payload === undefined) emit.call(socket, event, cb);
    else emit.call(socket, event, payload, cb);
  });
}
