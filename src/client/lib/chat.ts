import type { ChatInput } from '../../shared/protocol';
import { request } from './socket';
import { useStore } from './store';
import { StoredSticker, uploadOnce } from './stickers';

export const QUICK_EMOJIS = ['😂', '🔥', '😭', '🤣', '😎', '🤯', '🙏', '💀', '🤡', '👑', '💸', '😱', '🥶', '😤', '🎉', '🍀', '😈', '🫡', '👀', '🤑', '🐐', '🃏', '💩', '❤️'];

export const SOUND_EMOJIS: { emoji: string; sound: string; label: string }[] = [
  { emoji: '📯', sound: 'horn', label: 'Air horn' },
  { emoji: '🥁', sound: 'drum', label: 'Ba-dum-tss' },
  { emoji: '🎺', sound: 'sad', label: 'Sad trombone' },
  { emoji: '🎉', sound: 'tada', label: 'Ta-da' },
  { emoji: '💰', sound: 'cash', label: 'Cha-ching' },
  { emoji: '🤪', sound: 'boing', label: 'Boing' },
  { emoji: '❌', sound: 'buzz', label: 'Buzzer' },
  { emoji: '⏰', sound: 'clock', label: 'Tick tock' },
  { emoji: '💣', sound: 'boom', label: 'Boom' },
];

export const PHRASES: { emoji: string; text: string }[] = [
  { emoji: '🚀', text: 'All in!' },
  { emoji: '🚢', text: 'Ship it!' },
  { emoji: '👏', text: 'Nice hand!' },
  { emoji: '📞', text: 'I call!' },
  { emoji: '🙈', text: 'I fold.' },
  { emoji: '🤨', text: 'Are you kidding me?' },
  { emoji: '🔥', text: "Let's go!" },
  { emoji: '🎭', text: 'That was a bluff!' },
  { emoji: '😴', text: 'Hurry up!' },
  { emoji: '🍀', text: 'Good luck!' },
  { emoji: '😬', text: 'Unlucky!' },
  { emoji: '😎', text: 'Easy game.' },
  { emoji: '🤝', text: 'Well played.' },
  { emoji: '💸', text: 'Take my money!' },
  { emoji: '🪔', text: 'Chaal!' },
  { emoji: '🙏', text: 'Please fold.' },
];

export async function sendChat(input: ChatInput): Promise<boolean> {
  const r = await request('chat:send', input);
  if (!r.ok) useStore.getState().toast(r.error ?? 'Could not send', 'error');
  return r.ok;
}

export async function sendStoredSticker(s: StoredSticker): Promise<boolean> {
  try {
    const [mediaId, audioId] = await Promise.all([s.image ? uploadOnce(s.image) : undefined, s.audio ? uploadOnce(s.audio) : undefined]);
    return sendChat({ kind: s.image ? 'sticker' : 'emoji', mediaId, audioId, emoji: s.emoji, text: s.label, sound: s.funSound });
  } catch (e) {
    useStore.getState().toast((e as Error).message || 'Upload failed', 'error');
    return false;
  }
}
