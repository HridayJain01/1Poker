import { useRef, useState } from 'react';
import { Avatar } from './Avatar';
import { CameraCapture } from './CameraCapture';
import { AVATAR_COLORS, AVATAR_EMOJIS, LocalAvatar, LocalProfile, randomAvatar } from '../lib/profile';
import { blobToDataUrl, fileToSquareJpeg } from '../lib/media';
import { cls } from '../lib/format';
import { useStore } from '../lib/store';

export function ProfileEditor({ initial, onSave, saveLabel = 'Save' }: { initial: LocalProfile | null; onSave: (p: LocalProfile) => void; saveLabel?: string }) {
  const [name, setName] = useState(initial?.name ?? '');
  const [avatar, setAvatar] = useState<LocalAvatar>(initial?.avatar ?? randomAvatar());
  const [mode, setMode] = useState<'emoji' | 'camera'>('emoji');
  const fileRef = useRef<HTMLInputElement>(null);
  const toast = useStore((s) => s.toast);
  const emoji = avatar.kind === 'emoji' ? avatar : { kind: 'emoji' as const, emoji: '🦊', color: AVATAR_COLORS[0] };

  const fromFile = async (f: File | undefined) => {
    if (!f) return;
    try {
      const blob = await fileToSquareJpeg(f, 320);
      setAvatar({ kind: 'photo', dataUrl: await blobToDataUrl(blob) });
    } catch (e) {
      toast((e as Error).message, 'error');
    }
  };

  if (mode === 'camera')
    return (
      <CameraCapture
        onCancel={() => setMode('emoji')}
        onCapture={async (b) => {
          setAvatar({ kind: 'photo', dataUrl: await blobToDataUrl(b) });
          setMode('emoji');
        }}
      />
    );

  const valid = name.trim().length > 0;
  return (
    <div className="avatar-editor">
      <div className="row" style={{ gap: 14 }}>
        <Avatar avatar={avatar} size={72} />
        <div className="field" style={{ flex: 1 }}>
          <label htmlFor="pname">Your name</label>
          <input id="pname" className="input" value={name} maxLength={16} placeholder="e.g. Hriday" autoComplete="nickname" onChange={(e) => setName(e.target.value)} />
        </div>
      </div>
      <div className="row">
        <button className="btn btn-glass btn-sm" style={{ flex: 1 }} onClick={() => setMode('camera')}>
          📸 Take selfie
        </button>
        <button className="btn btn-glass btn-sm" style={{ flex: 1 }} onClick={() => fileRef.current?.click()}>
          🖼️ Upload
        </button>
        <input ref={fileRef} type="file" accept="image/*" hidden onChange={(e) => fromFile(e.target.files?.[0])} />
      </div>
      <div className="label">Or pick an avatar</div>
      <div className="emoji-grid">
        {AVATAR_EMOJIS.map((e) => (
          <button key={e} className={cls(avatar.kind === 'emoji' && avatar.emoji === e && 'on')} onClick={() => setAvatar({ kind: 'emoji', emoji: e, color: emoji.color })}>
            {e}
          </button>
        ))}
      </div>
      <div className="color-row">
        {AVATAR_COLORS.map((c) => (
          <button
            key={c}
            aria-label={`Color ${c}`}
            className={cls(avatar.kind === 'emoji' && avatar.color === c && 'on')}
            style={{ background: c }}
            onClick={() => setAvatar({ kind: 'emoji', emoji: emoji.emoji, color: c })}
          />
        ))}
      </div>
      <button className="btn btn-gold btn-block" disabled={!valid} onClick={() => onSave({ name: name.trim().slice(0, 16), avatar })}>
        {saveLabel}
      </button>
    </div>
  );
}
