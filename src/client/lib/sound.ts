import { useStore } from './store';

/* All game sounds are synthesized with Web Audio — no audio files needed. */

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let noiseBuffer: AudioBuffer | null = null;
let speechUnlocked = false;

function ac(): AudioContext | null {
  if (ctx) return ctx;
  const C = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!C) return null;
  ctx = new C();
  master = ctx.createGain();
  master.gain.value = 0.9;
  master.connect(ctx.destination);
  return ctx;
}

/** Must run inside a user gesture at least once (iOS/Safari autoplay rules). */
export function unlockAudio() {
  const c = ac();
  if (!c) return;
  if (c.state === 'suspended') void c.resume();
  try {
    const b = c.createBuffer(1, 1, 22050);
    const s = c.createBufferSource();
    s.buffer = b;
    s.connect(c.destination);
    s.start(0);
  } catch {
    /* ignore */
  }
  if (!speechUnlocked && 'speechSynthesis' in window) {
    try {
      const u = new SpeechSynthesisUtterance(' ');
      u.volume = 0;
      window.speechSynthesis.speak(u);
      speechUnlocked = true;
    } catch {
      /* ignore */
    }
  }
}

if (typeof window !== 'undefined') {
  window.addEventListener('pointerdown', unlockAudio, { passive: true });
  window.addEventListener('keydown', unlockAudio, { passive: true });
}

const enabled = () => useStore.getState().settings.sound;

function noise(c: AudioContext) {
  if (!noiseBuffer) {
    noiseBuffer = c.createBuffer(1, c.sampleRate, c.sampleRate);
    const d = noiseBuffer.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  return noiseBuffer;
}

interface ToneOpts {
  type?: OscillatorType;
  gain?: number;
  attack?: number;
  freqEnd?: number;
  vibrato?: number;
  filter?: number;
}

function tone(freq: number, at: number, dur: number, o: ToneOpts = {}) {
  const c = ac();
  if (!c || !master) return;
  const t = c.currentTime + at;
  const osc = c.createOscillator();
  const g = c.createGain();
  osc.type = o.type ?? 'sine';
  osc.frequency.setValueAtTime(freq, t);
  if (o.freqEnd) osc.frequency.exponentialRampToValueAtTime(Math.max(20, o.freqEnd), t + dur);
  if (o.vibrato) {
    const lfo = c.createOscillator();
    const lg = c.createGain();
    lfo.frequency.value = 6;
    lg.gain.value = o.vibrato;
    lfo.connect(lg).connect(osc.frequency);
    lfo.start(t);
    lfo.stop(t + dur + 0.05);
  }
  const peak = o.gain ?? 0.2;
  const attack = o.attack ?? 0.005;
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(peak, t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  let node: AudioNode = osc;
  if (o.filter) {
    const f = c.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = o.filter;
    osc.connect(f);
    node = f;
  }
  node.connect(g).connect(master);
  osc.start(t);
  osc.stop(t + dur + 0.05);
}

interface NoiseOpts {
  type?: BiquadFilterType;
  freq?: number;
  freqEnd?: number;
  q?: number;
  gain?: number;
}

function burst(at: number, dur: number, o: NoiseOpts = {}) {
  const c = ac();
  if (!c || !master) return;
  const t = c.currentTime + at;
  const src = c.createBufferSource();
  src.buffer = noise(c);
  const f = c.createBiquadFilter();
  f.type = o.type ?? 'bandpass';
  f.frequency.setValueAtTime(o.freq ?? 3000, t);
  if (o.freqEnd) f.frequency.exponentialRampToValueAtTime(o.freqEnd, t + dur);
  f.Q.value = o.q ?? 1;
  const g = c.createGain();
  const peak = o.gain ?? 0.2;
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(peak, t + 0.004);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(f).connect(g).connect(master);
  src.start(t, Math.random() * 0.5);
  src.stop(t + dur + 0.05);
}

function chipClinks(n: number, at = 0, spacing = 0.05) {
  for (let i = 0; i < n; i++) {
    const t = at + i * spacing + Math.random() * 0.012;
    const f = 2900 + Math.random() * 700;
    tone(f, t, 0.07, { type: 'triangle', gain: 0.09 });
    tone(f * 1.52, t, 0.05, { type: 'sine', gain: 0.045 });
    burst(t, 0.02, { type: 'highpass', freq: 6000, gain: 0.08 });
  }
}

export const sfx = {
  deal() {
    if (!enabled()) return;
    burst(0, 0.07, { type: 'bandpass', freq: 2200, freqEnd: 4200, q: 0.8, gain: 0.22 });
  },
  flip() {
    if (!enabled()) return;
    burst(0, 0.045, { type: 'highpass', freq: 2500, gain: 0.18 });
    tone(900, 0, 0.03, { type: 'triangle', gain: 0.03 });
  },
  chips(n = 2) {
    if (!enabled()) return;
    chipClinks(Math.max(1, Math.min(8, n)));
  },
  check() {
    if (!enabled()) return;
    for (const at of [0, 0.12]) {
      tone(150, at, 0.09, { freqEnd: 70, gain: 0.45 });
      burst(at, 0.03, { type: 'lowpass', freq: 700, gain: 0.12 });
    }
  },
  fold() {
    if (!enabled()) return;
    burst(0, 0.28, { type: 'lowpass', freq: 1600, freqEnd: 280, gain: 0.16 });
  },
  turn() {
    if (!enabled()) return;
    tone(659.25, 0, 0.3, { gain: 0.16, attack: 0.01 });
    tone(987.77, 0.11, 0.45, { gain: 0.14, attack: 0.01 });
  },
  tick() {
    if (!enabled()) return;
    tone(1750, 0, 0.035, { type: 'square', gain: 0.025 });
  },
  allin() {
    if (!enabled()) return;
    tone(95, 0, 0.7, { freqEnd: 38, gain: 0.55 });
    burst(0, 0.5, { type: 'lowpass', freq: 500, gain: 0.18 });
    tone(320, 0.05, 0.55, { type: 'sawtooth', freqEnd: 960, gain: 0.04, filter: 2200 });
    chipClinks(6, 0.25, 0.04);
  },
  win() {
    if (!enabled()) return;
    [1046.5, 1318.5, 1568, 2093].forEach((f, i) => tone(f, i * 0.09, 0.35, { type: 'triangle', gain: 0.1 }));
    chipClinks(7, 0.2, 0.06);
  },
  pop() {
    if (!enabled()) return;
    tone(520, 0, 0.09, { freqEnd: 1250, gain: 0.12 });
  },
  whoosh() {
    if (!enabled()) return;
    burst(0, 0.35, { type: 'bandpass', freq: 300, freqEnd: 2600, q: 1.4, gain: 0.2 });
  },
};

/** Built-in fun sounds that can be attached to stickers. */
export const FUN_SOUNDS: Record<string, { label: string; play: () => void }> = {
  horn: {
    label: 'Air horn',
    play: () => {
      for (const at of [0, 0.32, 0.64]) for (const f of [415, 523, 622]) tone(f, at, at === 0.64 ? 0.7 : 0.26, { type: 'sawtooth', gain: 0.05, filter: 3000, vibrato: 4 });
    },
  },
  drum: {
    label: 'Ba-dum-tss',
    play: () => {
      tone(160, 0, 0.18, { freqEnd: 50, gain: 0.6 });
      burst(0.16, 0.12, { type: 'bandpass', freq: 1800, gain: 0.3 });
      tone(160, 0.32, 0.18, { freqEnd: 50, gain: 0.6 });
      burst(0.5, 0.7, { type: 'highpass', freq: 7000, gain: 0.25 });
    },
  },
  sad: {
    label: 'Sad trombone',
    play: () => {
      [392, 370, 349].forEach((f, i) => tone(f, i * 0.42, 0.4, { type: 'sawtooth', gain: 0.08, filter: 1200, attack: 0.03 }));
      tone(330, 1.26, 1.1, { type: 'sawtooth', gain: 0.08, filter: 1200, attack: 0.03, vibrato: 7 });
    },
  },
  tada: {
    label: 'Ta-da!',
    play: () => {
      tone(523, 0, 0.12, { type: 'triangle', gain: 0.14 });
      tone(659, 0.1, 0.12, { type: 'triangle', gain: 0.14 });
      for (const f of [523, 659, 784, 1046]) tone(f, 0.22, 0.8, { type: 'triangle', gain: 0.09 });
    },
  },
  cash: {
    label: 'Cha-ching',
    play: () => {
      burst(0, 0.08, { type: 'highpass', freq: 3000, gain: 0.25 });
      tone(2093, 0.08, 0.6, { type: 'sine', gain: 0.14 });
      tone(2637, 0.14, 0.7, { type: 'sine', gain: 0.12 });
      chipClinks(4, 0.2, 0.05);
    },
  },
  boing: {
    label: 'Boing',
    play: () => {
      tone(180, 0, 0.18, { freqEnd: 620, gain: 0.25 });
      tone(620, 0.18, 0.35, { freqEnd: 140, gain: 0.22, vibrato: 30 });
    },
  },
  buzz: {
    label: 'Wrong buzzer',
    play: () => tone(110, 0, 0.6, { type: 'square', gain: 0.08, filter: 1500 }),
  },
  clock: {
    label: 'Tick tock',
    play: () => {
      for (let i = 0; i < 4; i++) tone(i % 2 ? 1300 : 1700, i * 0.4, 0.05, { type: 'square', gain: 0.05 });
    },
  },
  boom: {
    label: 'Boom',
    play: () => {
      tone(80, 0, 1.0, { freqEnd: 30, gain: 0.7 });
      burst(0, 0.9, { type: 'lowpass', freq: 600, freqEnd: 80, gain: 0.4 });
    },
  },
};

export function playFunSound(key: string) {
  if (!enabled()) return;
  FUN_SOUNDS[key]?.play();
}

// ---------------------------------------------------------------------------- clips

const decoded = new Map<string, Promise<AudioBuffer | null>>();

function decode(url: string): Promise<AudioBuffer | null> {
  let p = decoded.get(url);
  if (!p) {
    p = (async () => {
      const c = ac();
      if (!c) return null;
      const res = await fetch(url);
      if (!res.ok) return null;
      const buf = await res.arrayBuffer();
      return await new Promise<AudioBuffer | null>((resolve) => {
        // Callback form for older Safari.
        c.decodeAudioData(buf, (b) => resolve(b), () => resolve(null));
      });
    })().catch(() => null);
    decoded.set(url, p);
  }
  return p;
}

let current: { stop: () => void } | null = null;

/** Plays a voice note / sound sticker. Resolves with its duration in ms (0 if it failed). */
export async function playClip(url: string, opts: { force?: boolean } = {}): Promise<number> {
  if (!opts.force && !enabled()) return 0;
  const c = ac();
  const buf = await decode(url);
  if (c && buf && master) {
    if (c.state === 'suspended') await c.resume().catch(() => undefined);
    current?.stop();
    const src = c.createBufferSource();
    src.buffer = buf;
    src.connect(master);
    src.start();
    current = { stop: () => src.stop() };
    return buf.duration * 1000;
  }
  // Fallback: let the media element try.
  try {
    const a = new Audio(url);
    await a.play();
    current = { stop: () => a.pause() };
    return (a.duration || 2) * 1000;
  } catch {
    return 0;
  }
}

export function stopClip() {
  try {
    current?.stop();
  } catch {
    /* already stopped */
  }
  current = null;
}

export function speak(text: string) {
  const s = useStore.getState().settings;
  if (!s.sound || !s.speech || !('speechSynthesis' in window)) return;
  try {
    const u = new SpeechSynthesisUtterance(text);
    u.rate = 1.05;
    u.pitch = 1;
    u.volume = 1;
    window.speechSynthesis.speak(u);
  } catch {
    /* ignore */
  }
}

export function vibrate(pattern: number | number[]) {
  if (!useStore.getState().settings.haptics) return;
  // browsers refuse vibration until the user has interacted with the page
  const ua = (navigator as Navigator & { userActivation?: { hasBeenActive: boolean } }).userActivation;
  if (ua && !ua.hasBeenActive) return;
  try {
    navigator.vibrate?.(pattern);
  } catch {
    /* ignore */
  }
}
