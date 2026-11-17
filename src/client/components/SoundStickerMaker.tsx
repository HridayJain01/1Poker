import { useEffect, useRef, useState } from 'react';
import { canRecord, startRecording, toWav, ActiveRecorder } from '../lib/recorder';
import { saveSticker, StoredSticker } from '../lib/stickers';
import { prepareStickerImage } from '../lib/media';
import { playClip } from '../lib/sound';
import { useStore } from '../lib/store';
import { cls } from '../lib/format';
import { QUICK_EMOJIS } from '../lib/chat';

const MAKER_EMOJIS = ['😂', '🔥', '😭', '🤣', '😱', '🤯', '💀', '🤡', '👑', '💸', '🚀', '🙏', '😈', '🐐', '🥶', '😤', '🫡', '🎉', '🃏', '💩', ...QUICK_EMOJIS.slice(0, 4)];

/** Build a sticker: an emoji or image, plus a recorded or uploaded sound (e.g. "FAAAH"). */
export function SoundStickerMaker({ onDone, onCancel }: { onDone: (s: StoredSticker) => void; onCancel: () => void }) {
  const [emoji, setEmoji] = useState('😂');
  const [image, setImage] = useState<Blob | null>(null);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [audio, setAudio] = useState<Blob | null>(null);
  const [label, setLabel] = useState('');
  const [rec, setRec] = useState<ActiveRecorder | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [level, setLevel] = useState(0);
  const imgRef = useRef<HTMLInputElement>(null);
  const audRef = useRef<HTMLInputElement>(null);
  const toast = useStore((s) => s.toast);

  useEffect(() => {
    if (!rec) return;
    const t = setInterval(() => {
      setElapsed(Date.now() - rec.startedAt);
      setLevel(rec.level());
    }, 80);
    return () => clearInterval(t);
  }, [rec]);

  useEffect(() => () => {
    if (imageUrl) URL.revokeObjectURL(imageUrl);
  }, [imageUrl]);

  const toggleRec = async () => {
    if (rec) {
      try {
        const r = await rec.stop();
        setAudio(r.blob);
      } catch (e) {
        toast((e as Error).message, 'error');
      }
      setRec(null);
      return;
    }
    try {
      setElapsed(0);
      setRec(await startRecording(10000));
    } catch (e) {
      toast((e as Error).message || 'Microphone unavailable', 'error');
    }
  };

  const onAudioFile = async (f?: File) => {
    if (!f) return;
    try {
      const { blob } = await toWav(f, 10, 22050);
      setAudio(blob);
    } catch {
      toast("That audio format can't be read on this device", 'error');
    }
  };

  const onImageFile = async (f?: File) => {
    if (!f) return;
    try {
      const { blob, note } = await prepareStickerImage(f);
      if (note) toast(note);
      setImage(blob);
      setImageUrl(URL.createObjectURL(blob));
    } catch (e) {
      toast((e as Error).message, 'error');
    }
  };

  const preview = async () => {
    if (!audio) return;
    const url = URL.createObjectURL(audio);
    await playClip(url, { force: true });
    setTimeout(() => URL.revokeObjectURL(url), 15000);
  };

  const save = async () => {
    const s = await saveSticker({ emoji: image ? undefined : emoji, image: image ?? undefined, audio: audio ?? undefined, label: label.trim() || undefined });
    onDone(s);
  };

  return (
    <div className="field" style={{ gap: 14 }}>
      <div className="row" style={{ justifyContent: 'center' }}>
        <div className="sticker-cell" style={{ width: 110, fontSize: 60 }}>
          {imageUrl ? <img src={imageUrl} alt="" /> : <span style={{ fontSize: 64 }}>{emoji}</span>}
          {audio && <span className="snd">🔊</span>}
        </div>
      </div>
      <div className="label">1 · Pick an emoji or image</div>
      <div className="emoji-grid">
        {MAKER_EMOJIS.map((e, i) => (
          <button key={e + i} className={cls(!image && emoji === e && 'on')} onClick={() => { setImage(null); setImageUrl(null); setEmoji(e); }}>
            {e}
          </button>
        ))}
      </div>
      <button className="btn btn-glass btn-sm" onClick={() => imgRef.current?.click()}>
        🖼️ Use a sticker image instead (WebP, PNG, GIF)
      </button>
      <input ref={imgRef} type="file" accept="image/*" hidden onChange={(e) => onImageFile(e.target.files?.[0])} />

      <div className="label">2 · Add a sound (up to 10s)</div>
      <div className="row">
        {canRecord() && (
          <button className={cls('btn btn-sm', rec ? 'btn-danger' : 'btn-glass')} style={{ flex: 1 }} onClick={toggleRec}>
            {rec ? `■ Stop ${(elapsed / 1000).toFixed(1)}s` : audio ? '🎙️ Re-record' : '🎙️ Record'}
          </button>
        )}
        <button className="btn btn-glass btn-sm" style={{ flex: 1 }} onClick={() => audRef.current?.click()} disabled={!!rec}>
          📁 Audio file
        </button>
        <input ref={audRef} type="file" accept="audio/*,.opus,.ogg,.m4a,.mp3,.wav" hidden onChange={(e) => onAudioFile(e.target.files?.[0])} />
      </div>
      {rec && (
        <div className="level" style={{ justifyContent: 'center' }}>
          {Array.from({ length: 16 }, (_, i) => (
            <i key={i} style={{ height: `${10 + Math.max(0, level * 100 - Math.abs(i - 8) * 9)}%` }} />
          ))}
        </div>
      )}
      {audio && !rec && (
        <div className="row">
          <button className="btn btn-glass btn-sm" style={{ flex: 1 }} onClick={preview}>
            ▶ Play sound
          </button>
          <button className="btn btn-ghost btn-sm" onClick={() => setAudio(null)}>
            Remove
          </button>
        </div>
      )}

      <div className="field">
        <label>3 · Name (optional)</label>
        <input className="input" placeholder='e.g. "FAAAH" or "All in baby"' maxLength={40} value={label} onChange={(e) => setLabel(e.target.value)} />
      </div>
      <div className="row">
        <button className="btn btn-glass" style={{ flex: 1 }} onClick={onCancel}>
          Cancel
        </button>
        <button className="btn btn-gold" style={{ flex: 2 }} onClick={save} disabled={!!rec}>
          Save sticker
        </button>
      </div>
    </div>
  );
}
