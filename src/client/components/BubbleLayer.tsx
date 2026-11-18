import { AnimatePresence, motion } from 'framer-motion';
import { useEffect, useRef, useState } from 'react';
import type { ChatMessage, RoomView } from '../../shared/protocol';
import { bus } from '../lib/bus';
import type { Pt } from '../lib/layout';
import { mediaUrl } from '../lib/media';

interface Item {
  key: string;
  seat: number;
  msg: ChatMessage;
}

export function Wave({ playing, bars = 14 }: { playing?: boolean; bars?: number }) {
  return (
    <span className={`wave ${playing ? 'playing' : ''}`}>
      {Array.from({ length: bars }, (_, i) => (
        <i key={i} style={{ height: `${30 + ((i * 37) % 70)}%`, animationDelay: `${(i % 5) * 0.12}s` }} />
      ))}
    </span>
  );
}

export function BubbleLayer({ view, positions, size }: { view: RoomView; positions: Pt[]; size: { w: number; h: number } }) {
  const [items, setItems] = useState<Item[]>([]);
  const viewRef = useRef(view);
  viewRef.current = view;

  useEffect(() => {
    const timers = new Set<ReturnType<typeof setTimeout>>();
    const off = bus.on('chat', (m) => {
      if (m.kind === 'system' || !m.from) return;
      const seat = viewRef.current.players.find((p) => p.id === m.from)?.seat;
      if (seat === null || seat === undefined) return;
      const dur =
        m.kind === 'face' ? 6500 : m.kind === 'voice' ? Math.max(2500, (m.durationMs ?? 2000) + 900) : m.kind === 'text' ? 4200 : 3400;
      const key = m.id;
      setItems((all) => [...all.filter((x) => x.seat !== seat || (x.msg.kind === 'face') !== (m.kind === 'face')), { key, seat, msg: m }]);
      const t = setTimeout(() => {
        timers.delete(t);
        setItems((all) => all.filter((x) => x.key !== key));
      }, dur);
      timers.add(t);
    });
    return () => {
      off();
      timers.forEach(clearTimeout);
    };
  }, []);

  return (
    <div className="bubble-layer">
      <AnimatePresence>
        {items.map(({ key, seat, msg }) => {
          const pt = positions[seat];
          if (!pt) return null;
          // keep bubbles fully on screen at edge seats
          const x = Math.min(size.w - 66, Math.max(66, (pt.x / 100) * size.w));
          const y = (pt.y / 100) * size.h;
          const face = msg.kind === 'face';
          const below = !face && pt.y < 24;
          const style: React.CSSProperties = face ? { left: x, top: y + 30 } : below ? { left: x, top: y + 44 } : { left: x, top: y - 36 };
          return (
            <motion.div
              key={key}
              className={`seat-bubble ${below ? 'down' : 'up'}`}
              style={{ ...style, zIndex: face ? 11 : 10 }}
              initial={{ opacity: 0, scale: 0.4, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.7, y: -10 }}
              transition={{ type: 'spring', stiffness: 420, damping: 22 }}
            >
              <div className="sb-inner">
              {msg.kind === 'text' && <div className="sb-text">{msg.text}</div>}
              {msg.kind === 'phrase' && (
                <div className="sb-text">
                  {msg.emoji ? `${msg.emoji} ` : ''}
                  {msg.text}
                </div>
              )}
              {(msg.kind === 'emoji' || msg.kind === 'sticker') &&
                (msg.mediaId ? (
                  <img className="sb-sticker" src={mediaUrl(msg.mediaId)} alt={msg.text ?? 'sticker'} />
                ) : (
                  <motion.div className="sb-emoji" animate={{ rotate: [0, -12, 12, -6, 0], scale: [1, 1.25, 1] }} transition={{ duration: 0.8 }}>
                    {msg.emoji}
                  </motion.div>
                ))}
              {msg.kind === 'voice' && (
                <div className="sb-voice">
                  🔊 <Wave playing bars={8} /> {msg.emoji}
                </div>
              )}
              {face && msg.mediaId && <img className="sb-face" src={mediaUrl(msg.mediaId)} alt="face" />}
              </div>
            </motion.div>
          );
        })}
      </AnimatePresence>
    </div>
  );
}
