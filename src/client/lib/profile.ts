import type { Avatar, Profile } from '../../shared/protocol';
import { dataUrlToBlob, uploadBlob } from './media';

export type LocalAvatar = { kind: 'emoji'; emoji: string; color: string } | { kind: 'photo'; dataUrl: string };

export interface LocalProfile {
  name: string;
  avatar: LocalAvatar;
}

export interface LocalSettings {
  fourColor: boolean;
  sound: boolean;
  voiceAutoplay: boolean;
  speech: boolean;
  haptics: boolean;
  theme: TableTheme;
}

export type TableTheme = 'emerald' | 'royal' | 'crimson' | 'midnight';

export const AVATAR_EMOJIS = ['🦊', '🐯', '🦁', '🐼', '🐸', '🐵', '🦄', '🐲', '🦅', '🐺', '🐙', '🦈', '🐻', '🐨', '🦉', '👽', '🤖', '👻', '🤠', '😎', '🥷', '🧛', '🧙', '🦸'];
export const AVATAR_COLORS = ['#7c3aed', '#db2777', '#ea580c', '#ca8a04', '#16a34a', '#0891b2', '#2563eb', '#4f46e5', '#be123c', '#0f766e'];

const PROFILE_KEY = '1poker.profile';
const SETTINGS_KEY = '1poker.settings';
const TOKENS_KEY = '1poker.tokens';

function read<T>(key: string): T | null {
  try {
    const s = localStorage.getItem(key);
    return s ? (JSON.parse(s) as T) : null;
  } catch {
    return null;
  }
}

function write(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage full or blocked: ignore */
  }
}

export function randomAvatar(): LocalAvatar {
  return {
    kind: 'emoji',
    emoji: AVATAR_EMOJIS[Math.floor(Math.random() * AVATAR_EMOJIS.length)],
    color: AVATAR_COLORS[Math.floor(Math.random() * AVATAR_COLORS.length)],
  };
}

export function loadProfile(): LocalProfile | null {
  const p = read<LocalProfile>(PROFILE_KEY);
  if (!p || typeof p.name !== 'string' || !p.avatar) return null;
  return p;
}

export function saveProfile(p: LocalProfile) {
  write(PROFILE_KEY, p);
}

export const DEFAULT_LOCAL_SETTINGS: LocalSettings = {
  fourColor: false,
  sound: true,
  voiceAutoplay: true,
  speech: true,
  haptics: true,
  theme: 'emerald',
};

export function loadSettings(): LocalSettings {
  return { ...DEFAULT_LOCAL_SETTINGS, ...(read<Partial<LocalSettings>>(SETTINGS_KEY) ?? {}) };
}

export function saveSettings(s: LocalSettings) {
  write(SETTINGS_KEY, s);
}

interface TokenEntry {
  token: string;
  playerId: string;
  name: string;
  at: number;
}

export function getRoomToken(code: string): TokenEntry | null {
  const all = read<Record<string, TokenEntry>>(TOKENS_KEY) ?? {};
  return all[code] ?? null;
}

export function setRoomToken(code: string, entry: Omit<TokenEntry, 'at'>) {
  const all = read<Record<string, TokenEntry>>(TOKENS_KEY) ?? {};
  all[code] = { ...entry, at: Date.now() };
  // keep the 12 most recent rooms
  const keep = Object.entries(all)
    .sort((a, b) => b[1].at - a[1].at)
    .slice(0, 12);
  write(TOKENS_KEY, Object.fromEntries(keep));
}

export function forgetRoom(code: string) {
  const all = read<Record<string, TokenEntry>>(TOKENS_KEY) ?? {};
  delete all[code];
  write(TOKENS_KEY, all);
}

export function recentRooms(): { code: string; name: string; at: number }[] {
  const all = read<Record<string, TokenEntry>>(TOKENS_KEY) ?? {};
  return Object.entries(all)
    .map(([code, e]) => ({ code, name: e.name, at: e.at }))
    .sort((a, b) => b.at - a.at);
}

/** Converts the local profile into what the server expects (uploads the photo if needed). */
export async function toServerProfile(p: LocalProfile): Promise<Profile> {
  let avatar: Avatar;
  if (p.avatar.kind === 'photo') {
    try {
      const id = await uploadBlob(dataUrlToBlob(p.avatar.dataUrl));
      avatar = { kind: 'photo', mediaId: id };
    } catch {
      avatar = { kind: 'emoji', emoji: '🙂', color: '#7c3aed' };
    }
  } else avatar = p.avatar;
  return { name: p.name, avatar };
}
