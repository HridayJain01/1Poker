import type { HandEvent } from '../../shared/engine';
import type { ChatMessage } from '../../shared/protocol';

type Events = {
  fx: { handId: number; events: HandEvent[] };
  chat: ChatMessage;
};

type Handler<T> = (payload: T) => void;
const handlers: { [K in keyof Events]?: Set<Handler<Events[K]>> } = {};

export const bus = {
  on<K extends keyof Events>(k: K, fn: Handler<Events[K]>) {
    (handlers[k] ??= new Set() as never).add(fn as never);
    return () => {
      handlers[k]!.delete(fn as never);
    };
  },
  emit<K extends keyof Events>(k: K, payload: Events[K]) {
    handlers[k]?.forEach((fn) => (fn as Handler<Events[K]>)(payload));
  },
};
