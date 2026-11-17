import { useEffect, useState } from 'react';
import { Table } from '../components/Table';
import { ActionArea } from '../components/ActionArea';
import { ChatSheet, QuickTray } from '../components/ChatSheet';
import { RoomSheets } from '../components/RoomSheets';
import { GamePicker } from '../components/GamePicker';
import { IconChat, IconMenu } from '../components/Icons';
import { request, socket } from '../lib/socket';
import { useStore } from '../lib/store';
import { forgetRoom, getRoomToken, setRoomToken, toServerProfile } from '../lib/profile';
import { bus } from '../lib/bus';
import { mediaUrl } from '../lib/media';
import { playClip, playFunSound, sfx, speak } from '../lib/sound';
import { chipsShort, seconds } from '../lib/format';
import { useNow } from '../lib/hooks';
import { gameShortLabel, normalizeGame, VARIANTS } from '../../shared/variants';
import type { Card } from '../../shared/cards';
import { navigate } from '../App';

function useFxSounds() {
  useEffect(() => {
    const offFx = bus.on('fx', ({ events }) => {
      events.forEach((e, i) => {
        const later = (fn: () => void) => setTimeout(fn, i * 40);
        if (e.t === 'deal') for (let k = 0; k < 6; k++) setTimeout(() => sfx.deal(), k * 70);
        else if (e.t === 'street' || e.t === 'reveal' || e.t === 'show') later(() => sfx.flip());
        else if (e.t === 'win') setTimeout(() => sfx.win(), 300);
        else if (e.t === 'sideshow') later(() => sfx.whoosh());
        else if (e.t === 'act') {
          const k = e.kind;
          if (k === 'fold' || k === 'pack') later(() => sfx.fold());
          else if (k === 'check') later(() => sfx.check());
          else if (k === 'allin') later(() => sfx.allin());
          else if (k === 'bet' || k === 'raise') later(() => sfx.chips(4));
          else if (k === 'show') later(() => sfx.flip());
          else if (e.amount > 0) later(() => sfx.chips(2));
        }
      });
    });
    const offChat = bus.on('chat', (m) => {
      const { settings } = useStore.getState();
      if (m.kind === 'system') return;
      if (m.audioId && settings.voiceAutoplay) void playClip(mediaUrl(m.audioId));
      else if (m.sound) playFunSound(m.sound);
      else if (m.kind === 'phrase' && m.text) speak(m.text);
      else sfx.pop();
    });
    return () => {
      offFx();
      offChat();
    };
  }, []);
}

export function RoomScreen({ code }: { code: string }) {
  const view = useStore((s) => s.view);
  const profile = useStore((s) => s.profile);
  const connected = useStore((s) => s.connected);
  const unread = useStore((s) => s.unread);
  const openSheet = useStore((s) => s.openSheet);
  const theme = useStore((s) => s.settings.theme);
  const toast = useStore((s) => s.toast);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<Card>>(new Set());
  const [tray, setTray] = useState(false);
  useFxSounds();

  // join (and re-join after every reconnect)
  useEffect(() => {
    if (!profile) return navigate('/');
    let alive = true;
    const join = async () => {
      const saved = getRoomToken(code);
      const r = await request<{ code: string; token: string; playerId: string }>('room:join', { code, profile: await toServerProfile(profile), token: saved?.token });
      if (!alive) return;
      if (!r.ok || !r.data) {
        if (/not found|removed/i.test(r.error ?? '')) forgetRoom(code);
        setError(r.error ?? 'Could not join');
        return;
      }
      setRoomToken(code, { token: r.data.token, playerId: r.data.playerId, name: saved?.name ?? code });
      setError(null);
    };
    if (socket.connected) void join();
    socket.on('connect', join);
    return () => {
      alive = false;
      socket.off('connect', join);
      useStore.getState().setView(null);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code]);

  const handKey = view?.hand ? `${view.hand.handId}-${view.hand.awaiting.type}` : '';
  useEffect(() => setSelected(new Set()), [handKey]);

  const now = useNow(!!view?.nextHandAt || !!view?.chooser, 500);

  if (error)
    return (
      <div className="screen loading">
        <div>
          <div style={{ fontSize: 48 }}>🃏</div>
          <h2>{error}</h2>
          <button className="btn btn-gold" onClick={() => navigate('/')}>
            Back home
          </button>
        </div>
      </div>
    );
  if (!view || view.code !== code)
    return (
      <div className="screen loading">
        <div>
          <div className="spinner" style={{ margin: '0 auto 14px' }} />
          <div className="muted">{connected ? 'Joining table…' : 'Connecting…'}</div>
        </div>
      </div>
    );

  const leave = async () => {
    await request('room:leave');
    forgetRoom(code);
    openSheet(null);
    navigate('/');
  };
  const s = view.settings;
  const game = view.hand?.game ?? s.game;
  const tp = VARIANTS[game.variant].family === 'teenpatti';
  const stakes = tp ? `Boot ${chipsShort(s.boot)}` : `${chipsShort(s.sb)}/${chipsShort(s.bb)}${s.ante ? ` · ante ${chipsShort(s.ante)}` : ''}`;
  const me = view.players.find((p) => p.id === view.you);
  const choosing = view.chooser?.playerId === view.you;

  return (
    <div className="room" data-theme={theme}>
      <div className="topbar">
        <button className="icon-btn" onClick={() => openSheet('menu')} aria-label="Menu">
          <IconMenu />
        </button>
        <button className="room-title" onClick={() => openSheet('invite')}>
          <div className="t1">
            <span className={`conn-dot ${connected ? '' : 'off'}`} />
            {s.name}
            <span className="code-pill">{view.code}</span>
          </div>
          <div className="t2">
            {gameShortLabel(game)} · {stakes}
            {view.pendingGame && <span className="gold"> · next: {gameShortLabel(view.pendingGame)}</span>}
            {me && me.banks > 0 && ` · bank #${me.banks}`}
          </div>
        </button>
        <button className="icon-btn" onClick={() => openSheet('chat')} aria-label="Chat">
          <IconChat />
          {unread > 0 && <span className="badge">{unread > 9 ? '9+' : unread}</span>}
        </button>
      </div>

      <div style={{ position: 'relative', flex: '1 1 auto', minHeight: 0, display: 'flex' }}>
        <Table view={view} selected={selected} onToggleCard={(c) => {
          const need = view.hand?.family === 'flop' ? view.hand.discardCount : 0;
          setSelected((cur) => {
            const n = new Set(cur);
            if (n.has(c)) n.delete(c);
            else if (n.size < need) n.add(c);
            else toast(`Pick exactly ${need}`);
            return n;
          });
        }} />
        {view.nextHandAt && view.handOver && <div className="countdown">Next hand {seconds(view.nextHandAt - now)}s</div>}
        <button className="fab" style={{ right: 10, bottom: 6 }} onClick={() => setTray(true)} aria-label="Reactions">
          😀
        </button>
        {tray && <QuickTray onClose={() => setTray(false)} />}
      </div>

      <ActionArea view={view} selected={selected} clearSelected={() => setSelected(new Set())} />
      <ChatSheet view={view} />
      <RoomSheets view={view} onLeave={leave} />
      {choosing && <ChooserModal deadline={view.chooser!.deadline} now={now} current={s.game} players={view.players.filter((p) => p.seat !== null && !p.sittingOut && p.stack > 0).length} />}
    </div>
  );
}

function ChooserModal({ deadline, now, current, players }: { deadline: number; now: number; current: ReturnType<typeof normalizeGame>; players: number }) {
  const [g, setG] = useState(current);
  const toast = useStore((s) => s.toast);
  return (
    <>
      <div className="sheet-backdrop" />
      <div className="sheet" style={{ height: '86dvh' }}>
        <div className="sheet-head">
          <h2>🎲 Your deal — pick the game</h2>
          <div className="spacer" />
          <span className="chooser-timer">{seconds(deadline - now)}s</span>
        </div>
        <div className="sheet-body">
          <GamePicker value={g} onChange={setG} players={players} />
          <button
            className="btn btn-gold btn-block"
            style={{ marginTop: 14 }}
            onClick={async () => {
              const r = await request('game:choose', { game: g });
              if (!r.ok) toast(r.error ?? 'Failed', 'error');
            }}
          >
            Deal it!
          </button>
        </div>
      </div>
    </>
  );
}
