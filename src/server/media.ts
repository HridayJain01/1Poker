import { createHash } from 'node:crypto';

/**
 * Content-addressed, in-memory media store for stickers, voice notes and avatar photos.
 * Identical uploads share one entry. Least-recently-used entries are evicted past the cap.
 */
export const ALLOWED_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
  'audio/wav',
  'audio/x-wav',
  'audio/wave',
  'audio/webm',
  'audio/ogg',
  'audio/mpeg',
  'audio/mp4',
  'audio/aac',
]);

export const MAX_MEDIA_BYTES = 2 * 1024 * 1024;

interface Entry {
  buf: Buffer;
  type: string;
  at: number;
}

export class MediaStore {
  private map = new Map<string, Entry>();
  private total = 0;

  constructor(private maxBytes = 300 * 1024 * 1024) {}

  static normalizeType(raw: string | undefined): string | null {
    if (!raw) return null;
    const t = raw.split(';')[0].trim().toLowerCase();
    return ALLOWED_TYPES.has(t) ? t : null;
  }

  put(buf: Buffer, type: string): string {
    const id = createHash('sha256').update(type).update('\0').update(buf).digest('hex').slice(0, 32);
    const existing = this.map.get(id);
    if (existing) {
      this.map.delete(id);
      existing.at = Date.now();
      this.map.set(id, existing);
      return id;
    }
    this.map.set(id, { buf, type, at: Date.now() });
    this.total += buf.length;
    while (this.total > this.maxBytes && this.map.size > 1) {
      const oldest = this.map.keys().next().value as string;
      const e = this.map.get(oldest)!;
      this.map.delete(oldest);
      this.total -= e.buf.length;
    }
    return id;
  }

  get(id: string): Entry | undefined {
    const e = this.map.get(id);
    if (e) {
      // refresh LRU position
      this.map.delete(id);
      this.map.set(id, e);
    }
    return e;
  }

  has(id: string) {
    return this.map.has(id);
  }

  stats() {
    return { entries: this.map.size, bytes: this.total };
  }
}

/** Checks the first bytes so a file really is the image/audio type it claims to be. */
export function sniffMatches(buf: Buffer, type: string): boolean {
  const b = (i: number) => buf[i];
  const ascii = (start: number, s: string) => buf.length >= start + s.length && buf.toString('latin1', start, start + s.length) === s;
  switch (type) {
    case 'image/png':
      return b(0) === 0x89 && ascii(1, 'PNG');
    case 'image/jpeg':
      return b(0) === 0xff && b(1) === 0xd8;
    case 'image/gif':
      return ascii(0, 'GIF8');
    case 'image/webp':
      return ascii(0, 'RIFF') && ascii(8, 'WEBP');
    case 'audio/wav':
    case 'audio/x-wav':
    case 'audio/wave':
      return ascii(0, 'RIFF') && ascii(8, 'WAVE');
    case 'audio/webm':
      return b(0) === 0x1a && b(1) === 0x45 && b(2) === 0xdf && b(3) === 0xa3;
    case 'audio/ogg':
      return ascii(0, 'OggS');
    case 'audio/mpeg':
      return ascii(0, 'ID3') || (b(0) === 0xff && (b(1) & 0xe0) === 0xe0);
    case 'audio/mp4':
    case 'audio/aac':
      return ascii(4, 'ftyp') || (b(0) === 0xff && (b(1) & 0xf6) === 0xf0);
    default:
      return false;
  }
}
