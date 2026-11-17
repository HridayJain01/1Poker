import { createStore, del, entries, get, set } from 'idb-keyval';
import { uploadBlob } from './media';

/** A sticker saved on this device: an image and/or emoji, optionally with a sound. */
export interface StoredSticker {
  id: string;
  label?: string;
  emoji?: string;
  image?: Blob;
  audio?: Blob;
  /** Built-in synthesized sound key (see FUN_SOUNDS). */
  funSound?: string;
  createdAt: number;
}

let store: ReturnType<typeof createStore> | null = null;
function db() {
  if (!store) store = createStore('1poker-stickers', 'stickers');
  return store;
}

export async function listStickers(): Promise<StoredSticker[]> {
  try {
    const all = await entries<string, StoredSticker>(db());
    return all.map(([, v]) => v).sort((a, b) => b.createdAt - a.createdAt);
  } catch {
    return [];
  }
}

export async function saveSticker(s: Omit<StoredSticker, 'id' | 'createdAt'> & { id?: string }): Promise<StoredSticker> {
  const full: StoredSticker = { ...s, id: s.id ?? crypto.randomUUID(), createdAt: Date.now() };
  await set(full.id, full, db());
  return full;
}

export async function deleteSticker(id: string) {
  await del(id, db());
}

export async function getSticker(id: string) {
  return get<StoredSticker>(id, db());
}

const uploaded = new WeakMap<Blob, Promise<string>>();

/** Uploads a blob once per session (the server de-duplicates by content anyway). */
export function uploadOnce(blob: Blob): Promise<string> {
  let p = uploaded.get(blob);
  if (!p) {
    p = uploadBlob(blob);
    uploaded.set(blob, p);
    p.catch(() => uploaded.delete(blob));
  }
  return p;
}

/** Downloads a sticker someone sent so it can be re-used. */
export async function saveFromUrls(imageUrl?: string, audioUrl?: string, emoji?: string, label?: string) {
  const image = imageUrl ? await (await fetch(imageUrl)).blob() : undefined;
  const audio = audioUrl ? await (await fetch(audioUrl)).blob() : undefined;
  return saveSticker({ image, audio, emoji, label });
}
