import { useState } from 'react';
import { motion } from 'framer-motion';
import { Avatar } from '../components/Avatar';
import { Card } from '../components/Card';
import { Sheet } from '../components/Sheet';
import { ProfileEditor } from '../components/ProfileEditor';
import { useStore } from '../lib/store';
import { recentRooms } from '../lib/profile';
import { ROOM_CODE_LEN } from '../../shared/protocol';
import { navigate } from '../App';

export function Home() {
  const profile = useStore((s) => s.profile);
  const setProfile = useStore((s) => s.setProfile);
  const [code, setCode] = useState('');
  const [editing, setEditing] = useState(!profile);
  const [after, setAfter] = useState<null | (() => void)>(null);
  const recent = recentRooms().slice(0, 5);

  const need = (fn: () => void) => {
    if (!profile) {
      setAfter(() => fn);
      setEditing(true);
    } else fn();
  };
  const clean = code.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, ROOM_CODE_LEN);

  return (
    <div className="screen home">
      <div style={{ textAlign: 'center' }}>
        <div className="logo">
          <span className="one">1</span>POKER
        </div>
        <div className="tagline">Private poker nights with your friends</div>
      </div>
      <div className="home-hero">
        <div className="hero-glow" />
        <div className="hero-cards">
          {['As', 'Kh', 'Qd', 'Jc', 'Ts'].map((c, i) => (
            <motion.div
              key={c}
              style={{ position: 'absolute', left: '50%', top: '50%', marginLeft: -32, marginTop: -45 }}
              initial={{ y: 80, opacity: 0, rotate: 0 }}
              animate={{ y: [0, -6, 0], opacity: 1, rotate: (i - 2) * 12, x: (i - 2) * 30 }}
              transition={{ delay: i * 0.08, y: { repeat: Infinity, duration: 3 + i * 0.3, ease: 'easeInOut' } }}
            >
              <Card card={c} w={64} />
            </motion.div>
          ))}
        </div>
      </div>

      {profile && (
        <button className="card-panel profile-card" onClick={() => setEditing(true)}>
          <Avatar avatar={profile.avatar} size={52} />
          <div style={{ textAlign: 'left', flex: 1 }}>
            <div style={{ fontWeight: 800, fontSize: 17 }}>{profile.name}</div>
            <div className="muted" style={{ fontSize: 13 }}>
              Tap to change name, selfie or avatar
            </div>
          </div>
          <span className="muted">✎</span>
        </button>
      )}

      <button className="btn btn-gold btn-block" style={{ height: 58, fontSize: 18 }} onClick={() => need(() => navigate('/create'))}>
        ♠ Create a room
      </button>

      <div className="card-panel section">
        <h3>Join with a code</h3>
        <div className="code-input">
          <input
            value={clean}
            onChange={(e) => setCode(e.target.value)}
            placeholder="ABCDE"
            autoCapitalize="characters"
            autoComplete="off"
            inputMode="text"
            aria-label="Room code"
            onKeyDown={(e) => e.key === 'Enter' && clean.length === ROOM_CODE_LEN && need(() => navigate(`/r/${clean}`))}
          />
        </div>
        <button className="btn btn-glass btn-block" disabled={clean.length !== ROOM_CODE_LEN} onClick={() => need(() => navigate(`/r/${clean}`))}>
          Join table
        </button>
        {recent.length > 0 && (
          <>
            <div className="label">Recent rooms</div>
            <div className="recent">
              {recent.map((r) => (
                <button key={r.code} className="chip-btn" onClick={() => need(() => navigate(`/r/${r.code}`))}>
                  {r.code}
                </button>
              ))}
            </div>
          </>
        )}
      </div>
      <p className="muted center" style={{ fontSize: 12 }}>
        Hold'em · Omaha 4/5/6 · Hi-Lo · Multi-board · Irish · Pineapple · Short Deck · Teen Patti
      </p>

      <Sheet open={editing} onClose={() => profile && setEditing(false)} title={profile ? 'Your profile' : 'Who are you?'}>
        <div className="sheet-body">
          <ProfileEditor
            initial={profile}
            saveLabel={profile ? 'Save' : "Let's play"}
            onSave={(p) => {
              setProfile(p);
              setEditing(false);
              after?.();
              setAfter(null);
            }}
          />
        </div>
      </Sheet>
    </div>
  );
}
