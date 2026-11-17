/*
 * Voice capture. We record with MediaRecorder (works on Chrome, Safari, Firefox), then
 * re-encode to 16 kHz mono WAV so every browser — including iPhones — can play it back.
 */

export interface Recording {
  blob: Blob;
  durationMs: number;
}

export interface ActiveRecorder {
  stop(): Promise<Recording>;
  cancel(): void;
  /** 0..1 input level for a live meter. */
  level(): number;
  startedAt: number;
}

const TARGET_RATE = 16000;

function pickMime(): string | undefined {
  if (typeof MediaRecorder === 'undefined') return undefined;
  for (const m of ['audio/webm;codecs=opus', 'audio/mp4', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/aac']) {
    try {
      if (MediaRecorder.isTypeSupported(m)) return m;
    } catch {
      /* ignore */
    }
  }
  return undefined;
}

export function canRecord() {
  return !!navigator.mediaDevices?.getUserMedia && typeof MediaRecorder !== 'undefined';
}

export async function startRecording(maxMs = 30000): Promise<ActiveRecorder> {
  if (!canRecord()) throw new Error('Voice recording is not supported on this browser');
  if (!window.isSecureContext) throw new Error('Microphone needs HTTPS');
  const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
  const mime = pickMime();
  const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
  const chunks: Blob[] = [];
  rec.ondataavailable = (e) => {
    if (e.data && e.data.size > 0) chunks.push(e.data);
  };

  // live level meter
  const C = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  const meterCtx = C ? new C() : null;
  let analyser: AnalyserNode | null = null;
  let data: Uint8Array<ArrayBuffer> | null = null;
  if (meterCtx) {
    const src = meterCtx.createMediaStreamSource(stream);
    analyser = meterCtx.createAnalyser();
    analyser.fftSize = 512;
    src.connect(analyser);
    data = new Uint8Array(new ArrayBuffer(analyser.fftSize));
  }

  const startedAt = Date.now();
  rec.start(250);
  let finished = false;
  const cleanup = () => {
    stream.getTracks().forEach((t) => t.stop());
    void meterCtx?.close().catch(() => undefined);
  };
  let autoStop: ReturnType<typeof setTimeout> | null = null;

  const stopPromise = new Promise<Recording>((resolve, reject) => {
    rec.onstop = async () => {
      if (autoStop) clearTimeout(autoStop);
      cleanup();
      const durationMs = Date.now() - startedAt;
      const raw = new Blob(chunks, { type: (rec.mimeType || mime || 'audio/webm').split(';')[0] });
      if (raw.size === 0) return reject(new Error('Nothing was recorded'));
      try {
        const wav = await toWav(raw, maxMs / 1000);
        resolve({ blob: wav.blob, durationMs: Math.round(wav.duration * 1000) });
      } catch {
        resolve({ blob: raw, durationMs });
      }
    };
  });

  autoStop = setTimeout(() => {
    if (!finished && rec.state !== 'inactive') {
      finished = true;
      rec.stop();
    }
  }, maxMs);

  return {
    startedAt,
    stop() {
      if (!finished && rec.state !== 'inactive') {
        finished = true;
        rec.stop();
      }
      return stopPromise;
    },
    cancel() {
      finished = true;
      if (autoStop) clearTimeout(autoStop);
      rec.onstop = null;
      if (rec.state !== 'inactive') rec.stop();
      cleanup();
    },
    level() {
      if (!analyser || !data) return 0;
      analyser.getByteTimeDomainData(data);
      let peak = 0;
      for (let i = 0; i < data.length; i++) peak = Math.max(peak, Math.abs(data[i] - 128));
      return Math.min(1, peak / 90);
    },
  };
}

/** Decodes any audio the browser understands and re-encodes it as mono 16-bit WAV. */
export async function toWav(input: Blob, maxSeconds = 30, rate = TARGET_RATE): Promise<{ blob: Blob; duration: number }> {
  const C = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!C) throw new Error('No audio support');
  const ctx = new C();
  try {
    const arr = await input.arrayBuffer();
    const decoded = await new Promise<AudioBuffer>((resolve, reject) => ctx.decodeAudioData(arr, resolve, reject));
    const duration = Math.min(decoded.duration, maxSeconds);
    const length = Math.max(1, Math.ceil(duration * rate));
    const off = new OfflineAudioContext(1, length, rate);
    const src = off.createBufferSource();
    src.buffer = decoded;
    src.connect(off.destination);
    src.start(0);
    const rendered = await off.startRendering();
    return { blob: encodeWav(rendered.getChannelData(0), rate), duration };
  } finally {
    void ctx.close().catch(() => undefined);
  }
}

function encodeWav(samples: Float32Array, rate: number): Blob {
  // light normalization so quiet phone mics are audible
  let peak = 0;
  for (let i = 0; i < samples.length; i++) peak = Math.max(peak, Math.abs(samples[i]));
  const gain = peak > 0 && peak < 0.5 ? Math.min(3, 0.8 / peak) : 1;
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const v = new DataView(buffer);
  const str = (o: number, s: string) => {
    for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i));
  };
  str(0, 'RIFF');
  v.setUint32(4, 36 + samples.length * 2, true);
  str(8, 'WAVE');
  str(12, 'fmt ');
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true); // PCM
  v.setUint16(22, 1, true); // mono
  v.setUint32(24, rate, true);
  v.setUint32(28, rate * 2, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  str(36, 'data');
  v.setUint32(40, samples.length * 2, true);
  let o = 44;
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i] * gain));
    v.setInt16(o, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    o += 2;
  }
  return new Blob([buffer], { type: 'audio/wav' });
}
