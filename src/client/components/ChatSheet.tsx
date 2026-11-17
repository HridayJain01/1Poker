import { useEffect, useRef, useState } from 'react';
import type { ChatMessage, RoomView } from '../../shared/protocol';
import { Sheet } from './Sheet';
import { Avatar } from './Avatar';
import { Wave } from './BubbleLayer';
import { CameraCapture } from './CameraCapture';
import { SoundStickerMaker } from './SoundStickerMaker';
import { IconCamera, IconMic, IconSend } from './Icons';
import { useStore } from '../lib/store';
import { mediaUrl, prepareStickerImage, uploadBlob } from '../lib/media';
import { PHRASES, QUICK_EMOJIS, SOUND_EMOJIS, sendChat, sendStoredSticker } from '../lib/chat';
import { deleteSticker, listStickers, saveFromUrls, saveSticker, StoredSticker } from '../lib/stickers';
import { ActiveRecorder, canRecord, startRecording } from '../lib/recorder';
import { playClip, playFunSound, speak } from '../lib/sound';
import { cls } from '../lib/format';

export function useStickers() {
  const [list, setList] = useState<StoredSticker[]>([]);
  const reload = () => void listStickers().then(setList);
  useEffect(reload, []);
  return { list, reload };
}

function StickerThumb({ s }: { s: StoredSticker }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!s.image) return;
    const u = URL.createObjectURL(s.image);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [s.image]);
  return (
    <>
      {url ? <img src={url} alt="" /> : <span className="se">{s.emoji}</span>}
      {(s.audio || s.funSound) && <span className="snd">🔊</span>}
      {s.label && <span className="slbl">{s.label}</span>}
    </>
  );
}

function replay(m: ChatMessage) {
  if (m.audioId) void playClip(mediaUrl(m.audioId), { force: true });
  else if (m.sound) playFunSound(m.sound);
  else if (m.kind === 'phrase' && m.text) speak(m.text);
}

function Message({ m, view }: { m: ChatMessage; view: RoomView }) {
  const toast = useStore((s) => s.toast);
  if (m.kind === 'system') return <div className="msg-sys">{m.text}</div>;
  const mine = m.from === view.you;
  const p = view.players.find((x) => x.id === m.from);
  const save = async () => {
    await saveFromUrls(m.mediaId ? mediaUrl(m.mediaId) : undefined, m.audioId ? mediaUrl(m.audioId) : undefined, m.emoji ?? (m.kind === 'voice' ? '🔊' : undefined), m.text ?? (m.kind === 'voice' ? m.name : undefined));
    toast('Saved to your stickers', 'success');
  };
  let body: React.ReactNode;
  if (m.kind === 'text') body = <div className="bubble">{m.text}</div>;
  else if (m.kind === 'phrase')
    body = (
      <div className="bubble" onClick={() => replay(m)}>
        {m.emoji} {m.text} 🔊
      </div>
    );
  else if (m.kind === 'voice')
    body = (
      <div className="voice-msg">
        <button className="play-btn" onClick={() => replay(m)}>
          ▶
        </button>
        <Wave />
        <span className="muted num" style={{ fontSize: 12 }}>
          {Math.max(1, Math.round((m.durationMs ?? 0) / 1000))}s
        </span>
        {!mine && (
          <button className="mini-btn" onClick={save}>
            Save
          </button>
        )}
      </div>
    );
  else if (m.kind === 'face')
    body = (
      <div className="face-msg">
        <img src={mediaUrl(m.mediaId!)} alt="" />
      </div>
    );
  else
    body = (
      <div className="sticker-msg">
        {m.mediaId ? <img src={mediaUrl(m.mediaId)} alt="" /> : <span className="big-emoji">{m.emoji}</span>}
        {m.text && <span className="lbl">{m.text}</span>}
        <div className="sticker-actions">
          {(m.audioId || m.sound) && (
            <button className="mini-btn" onClick={() => replay(m)}>
              🔊 Play
            </button>
          )}
          {!mine && (m.mediaId || m.audioId) && (
            <button className="mini-btn" onClick={save}>
              Save
            </button>
          )}
        </div>
      </div>
    );
  return (
    <div className={cls('msg', mine && 'me')}>
      {!mine && <Avatar avatar={p?.avatar} size={28} />}
      <div className="msg-body">
        {!mine && <span className="msg-name">{m.name}</span>}
        {body}
      </div>
    </div>
  );
}

export function ChatSheet({ view }: { view: RoomView }) {
  const open = useStore((s) => s.sheet === 'chat');
  const openSheet = useStore((s) => s.openSheet);
  const chat = useStore((s) => s.chat);
  const toast = useStore((s) => s.toast);
  const [tab, setTab] = useState<'chat' | 'stickers' | 'sounds'>('chat');
  const [text, setText] = useState('');
  const [rec, setRec] = useState<ActiveRecorder | null>(null);
  const [recMs, setRecMs] = useState(0);
  const [mode, setMode] = useState<'none' | 'camera' | 'maker'>('none');
  const [editing, setEditing] = useState(false);
  const { list, reload } = useStickers();
  const listRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) reload();
  }, [open]);
  useEffect(() => {
    listRef.current?.scrollTo({ top: 1e9 });
  }, [chat.length, open, tab]);
  useEffect(() => {
    if (!rec) return;
    const t = setInterval(() => setRecMs(Date.now() - rec.startedAt), 200);
    return () => clearInterval(t);
  }, [rec]);

  const close = () => {
    rec?.cancel();
    setRec(null);
    setMode('none');
    openSheet(null);
  };

  const sendText = async () => {
    const t = text.trim();
    if (!t) return;
    if (await sendChat({ kind: 'text', text: t })) setText('');
  };

  const mic = async () => {
    if (rec) {
      try {
        const r = await rec.stop();
        setRec(null);
        const id = await uploadBlob(r.blob);
        await sendChat({ kind: 'voice', audioId: id, durationMs: r.durationMs });
      } catch (e) {
        setRec(null);
        toast((e as Error).message, 'error');
      }
      return;
    }
    try {
      setRecMs(0);
      setRec(await startRecording(30000));
    } catch (e) {
      toast((e as Error).message || 'Microphone unavailable', 'error');
    }
  };

  const addImages = async (files: FileList | null) => {
    if (!files) return;
    for (const f of Array.from(files).slice(0, 20)) {
      try {
        const { blob, note } = await prepareStickerImage(f);
        if (note) toast(note);
        await saveSticker({ image: blob });
      } catch (e) {
        toast((e as Error).message, 'error');
      }
    }
    reload();
  };

  const tapSticker = async (s: StoredSticker) => {
    if (editing) {
      await deleteSticker(s.id);
      reload();
      return;
    }
    if (await sendStoredSticker(s)) close();
  };

  const imageStickers = list.filter((s) => !s.audio && !s.funSound);
  const soundStickers = list.filter((s) => s.audio || s.funSound);

  return (
    <Sheet open={open} onClose={close} title="Table talk" tall>
      <div className="chat-tabs">
        {(['chat', 'stickers', 'sounds'] as const).map((t) => (
          <button key={t} className={cls(tab === t && 'on')} onClick={() => { setTab(t); setMode('none'); }}>
            {t === 'chat' ? '💬 Chat' : t === 'stickers' ? '🖼️ Stickers' : '🔊 Sounds'}
          </button>
        ))}
      </div>

      {mode === 'camera' && (
        <div className="sheet-body">
          <p className="muted center">Your face pops up on your seat for a few seconds</p>
          <CameraCapture
            confirmLabel="Send face"
            onCancel={() => setMode('none')}
            onCapture={async (b) => {
              try {
                const id = await uploadBlob(b);
                if (await sendChat({ kind: 'face', mediaId: id })) close();
              } catch (e) {
                toast((e as Error).message, 'error');
              }
            }}
          />
        </div>
      )}

      {mode === 'maker' && (
        <div className="sheet-body">
          <SoundStickerMaker
            onCancel={() => setMode('none')}
            onDone={() => {
              setMode('none');
              reload();
              toast('Sound sticker saved', 'success');
            }}
          />
        </div>
      )}

      {mode === 'none' && tab === 'chat' && (
        <>
          <div className="messages" ref={listRef}>
            {chat.length === 0 && <div className="msg-sys">Say hi 👋 — send stickers, voice notes and sounds</div>}
            {chat.map((m) => (
              <Message key={m.id} m={m} view={view} />
            ))}
          </div>
          <div className="composer">
            {rec ? (
              <>
                <button className="round-btn" onClick={() => { rec.cancel(); setRec(null); }}>
                  ✕
                </button>
                <div className="spacer center" style={{ fontWeight: 800, color: 'var(--red)' }}>
                  ● Recording {(recMs / 1000).toFixed(1)}s
                </div>
                <button className="round-btn gold" onClick={mic} aria-label="Send voice note">
                  <IconSend />
                </button>
              </>
            ) : (
              <>
                <button className="round-btn" onClick={() => setMode('camera')} aria-label="Face snap">
                  <IconCamera />
                </button>
                <input
                  className="input"
                  placeholder="Message"
                  value={text}
                  maxLength={300}
                  onChange={(e) => setText(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && sendText()}
                />
                {text.trim() ? (
                  <button className="round-btn gold" onClick={sendText} aria-label="Send">
                    <IconSend />
                  </button>
                ) : (
                  <button className="round-btn" onClick={mic} disabled={!canRecord()} aria-label="Record voice note">
                    <IconMic />
                  </button>
                )}
              </>
            )}
          </div>
        </>
      )}

      {mode === 'none' && tab === 'stickers' && (
        <div className="sheet-body">
          <div className="row">
            <div className="section-label">My stickers</div>
            <div className="spacer" />
            {imageStickers.length > 0 && (
              <button className="mini-btn" onClick={() => setEditing(!editing)}>
                {editing ? 'Done' : 'Edit'}
              </button>
            )}
          </div>
          <div className="sticker-grid">
            <button className="sticker-cell add" onClick={() => fileRef.current?.click()}>
              <span style={{ fontSize: 22 }}>＋</span>Add
            </button>
            {imageStickers.map((s) => (
              <button key={s.id} className="sticker-cell" onClick={() => tapSticker(s)}>
                <StickerThumb s={s} />
                {editing && <span className="del">✕</span>}
              </button>
            ))}
          </div>
          <input ref={fileRef} type="file" accept="image/*" multiple hidden onChange={(e) => addImages(e.target.files)} />
          <p className="muted" style={{ fontSize: 12 }}>
            Add WhatsApp stickers (.webp) or any images/GIFs saved on your phone.
          </p>
          <div className="section-label">Emoji</div>
          <div className="quick-emojis">
            {QUICK_EMOJIS.map((e) => (
              <button key={e} onClick={() => sendChat({ kind: 'emoji', emoji: e }).then((ok) => ok && close())}>
                {e}
              </button>
            ))}
          </div>
        </div>
      )}

      {mode === 'none' && tab === 'sounds' && (
        <div className="sheet-body">
          <div className="row">
            <div className="section-label">My sound stickers</div>
            <div className="spacer" />
            {soundStickers.length > 0 && (
              <button className="mini-btn" onClick={() => setEditing(!editing)}>
                {editing ? 'Done' : 'Edit'}
              </button>
            )}
          </div>
          <div className="sticker-grid">
            <button className="sticker-cell add" onClick={() => setMode('maker')}>
              <span style={{ fontSize: 22 }}>🎙️</span>Create
            </button>
            {soundStickers.map((s) => (
              <button key={s.id} className="sticker-cell" onClick={() => tapSticker(s)}>
                <StickerThumb s={s} />
                {editing && <span className="del">✕</span>}
              </button>
            ))}
          </div>
          <div className="section-label">Built-in sounds</div>
          <div className="sticker-grid">
            {SOUND_EMOJIS.map((s) => (
              <button key={s.sound} className="sticker-cell" onClick={() => sendChat({ kind: 'emoji', emoji: s.emoji, sound: s.sound, text: s.label }).then((ok) => ok && close())}>
                <span className="se">{s.emoji}</span>
                <span className="slbl">{s.label}</span>
              </button>
            ))}
          </div>
          <div className="section-label">Say it out loud</div>
          <div className="phrase-grid">
            {PHRASES.map((p) => (
              <button key={p.text} className="phrase-btn" onClick={() => sendChat({ kind: 'phrase', emoji: p.emoji, text: p.text }).then((ok) => ok && close())}>
                <span className="pe">{p.emoji}</span>
                {p.text}
              </button>
            ))}
          </div>
        </div>
      )}
    </Sheet>
  );
}

/** One-tap reactions without leaving the table. */
export function QuickTray({ onClose }: { onClose: () => void }) {
  const { list } = useStickers();
  const send = (p: Promise<boolean>) => p.then((ok) => ok && onClose());
  return (
    <>
      <div style={{ position: 'fixed', inset: 0, zIndex: 12 }} onClick={onClose} />
      <div className="quick-tray">
        <div className="quick-emojis">
          {QUICK_EMOJIS.slice(0, 12).map((e) => (
            <button key={e} onClick={() => send(sendChat({ kind: 'emoji', emoji: e }))}>
              {e}
            </button>
          ))}
        </div>
        <div className="quick-row">
          {SOUND_EMOJIS.map((s) => (
            <button key={s.sound} className="chip-btn" onClick={() => send(sendChat({ kind: 'emoji', emoji: s.emoji, sound: s.sound, text: s.label }))}>
              {s.emoji} {s.label}
            </button>
          ))}
        </div>
        <div className="quick-row">
          {PHRASES.slice(0, 10).map((p) => (
            <button key={p.text} className="chip-btn" onClick={() => send(sendChat({ kind: 'phrase', emoji: p.emoji, text: p.text }))}>
              {p.emoji} {p.text}
            </button>
          ))}
        </div>
        {list.length > 0 && (
          <div className="quick-stickers">
            {list.slice(0, 20).map((s) => (
              <button key={s.id} className="sticker-cell" onClick={() => send(sendStoredSticker(s))}>
                <StickerThumb s={s} />
              </button>
            ))}
          </div>
        )}
      </div>
    </>
  );
}
