import { create } from 'zustand';
import type { ChatMessage, RoomView } from '../../shared/protocol';
import { loadProfile, loadSettings, LocalProfile, LocalSettings, saveProfile, saveSettings } from './profile';

export interface Toast {
  id: number;
  text: string;
  tone?: 'info' | 'error' | 'success';
}

export type Sheet = null | 'chat' | 'menu' | 'ledger' | 'host' | 'history' | 'settings' | 'profile' | 'invite' | 'game';

interface Store {
  connected: boolean;
  view: RoomView | null;
  clockOffset: number;
  chat: ChatMessage[];
  unread: number;
  sheet: Sheet;
  toasts: Toast[];
  profile: LocalProfile | null;
  settings: LocalSettings;
  setConnected(v: boolean): void;
  setView(v: RoomView | null): void;
  setChat(m: ChatMessage[]): void;
  addChat(m: ChatMessage): void;
  openSheet(s: Sheet): void;
  toast(text: string, tone?: Toast['tone']): void;
  dismissToast(id: number): void;
  setProfile(p: LocalProfile): void;
  updateSettings(p: Partial<LocalSettings>): void;
}

let toastId = 1;

export const useStore = create<Store>((set, get) => ({
  connected: false,
  view: null,
  clockOffset: 0,
  chat: [],
  unread: 0,
  sheet: null,
  toasts: [],
  profile: loadProfile(),
  settings: loadSettings(),
  setConnected: (connected) => set({ connected }),
  setView: (view) => set({ view, clockOffset: view ? view.serverNow - Date.now() : 0 }),
  setChat: (chat) => set({ chat, unread: 0 }),
  addChat: (m) =>
    set((s) => ({
      chat: [...s.chat.slice(-119), m],
      unread: s.sheet === 'chat' || m.kind === 'system' || m.from === s.view?.you ? s.unread : s.unread + 1,
    })),
  openSheet: (sheet) => set((s) => ({ sheet, unread: sheet === 'chat' ? 0 : s.unread })),
  toast: (text, tone = 'info') => {
    const id = toastId++;
    set((s) => ({ toasts: [...s.toasts.slice(-2), { id, text, tone }] }));
    setTimeout(() => get().dismissToast(id), 3200);
  },
  dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
  setProfile: (profile) => {
    saveProfile(profile);
    set({ profile });
  },
  updateSettings: (p) => {
    const settings = { ...get().settings, ...p };
    saveSettings(settings);
    set({ settings });
  },
}));

/** Server time now (ms), corrected for clock skew. */
export function serverNow() {
  return Date.now() + useStore.getState().clockOffset;
}
