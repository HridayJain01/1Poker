import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Home } from './screens/Home';
import { CreateRoom } from './screens/CreateRoom';
import { RoomScreen } from './screens/RoomScreen';
import { useStore } from './lib/store';
import { socket } from './lib/socket';
import { bus } from './lib/bus';

const listeners = new Set<() => void>();
export function navigate(path: string) {
  if (location.pathname !== path) history.pushState({}, '', path);
  listeners.forEach((l) => l());
}

function usePath() {
  const [path, setPath] = useState(location.pathname);
  useEffect(() => {
    const up = () => setPath(location.pathname);
    listeners.add(up);
    window.addEventListener('popstate', up);
    return () => {
      listeners.delete(up);
      window.removeEventListener('popstate', up);
    };
  }, []);
  return path;
}

let wired = false;
function wireSocket() {
  if (wired) return;
  wired = true;
  const st = useStore.getState;
  socket.on('connect', () => st().setConnected(true));
  socket.on('disconnect', () => st().setConnected(false));
  socket.on('room:state', (v) => st().setView(v));
  socket.on('room:fx', (e) => bus.emit('fx', e));
  socket.on('chat:history', (m) => st().setChat(m));
  socket.on('chat:msg', (m) => {
    st().addChat(m);
    bus.emit('chat', m);
  });
  socket.on('toast', (t) => st().toast(t.text));
  socket.on('room:kicked', () => {
    st().toast('The host removed you from the room', 'error');
    navigate('/');
  });
  if (socket.connected) st().setConnected(true);
}

function Toasts() {
  const toasts = useStore((s) => s.toasts);
  return (
    <div className="toasts">
      <AnimatePresence>
        {toasts.map((t) => (
          <motion.div key={t.id} className={`toast ${t.tone ?? ''}`} initial={{ opacity: 0, y: -12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
            {t.text}
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}

export function App() {
  wireSocket();
  const path = usePath();
  const m = /^\/r\/([A-Za-z0-9]{4,8})\/?$/.exec(path);
  return (
    <>
      <div className="app-bg" />
      {m ? <RoomScreen key={m[1].toUpperCase()} code={m[1].toUpperCase()} /> : path === '/create' ? <CreateRoom /> : <Home />}
      <Toasts />
    </>
  );
}
