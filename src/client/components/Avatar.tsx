import type { Avatar as AvatarT } from '../../shared/protocol';
import type { LocalAvatar } from '../lib/profile';
import { mediaUrl } from '../lib/media';

export function Avatar({ avatar, size = 48, className }: { avatar: AvatarT | LocalAvatar | undefined; size?: number; className?: string }) {
  const style = { ['--size' as string]: `${size}px` } as React.CSSProperties;
  if (avatar?.kind === 'photo') {
    const src = 'mediaId' in avatar ? mediaUrl(avatar.mediaId) : avatar.dataUrl;
    return (
      <div className={`avatar ${className ?? ''}`} style={style}>
        <img src={src} alt="" draggable={false} />
      </div>
    );
  }
  const a = avatar?.kind === 'emoji' ? avatar : { emoji: '🙂', color: '#7c3aed' };
  return (
    <div className={`avatar ${className ?? ''}`} style={{ ...style, ['--av' as string]: a.color }}>
      <span>{a.emoji}</span>
    </div>
  );
}
