export function mediaUrl(id: string) {
  return `/api/media/${id}`;
}

export async function uploadBlob(blob: Blob, type?: string): Promise<string> {
  const res = await fetch('/api/media', {
    method: 'POST',
    headers: { 'Content-Type': type || blob.type || 'application/octet-stream' },
    body: blob,
  });
  let json: { ok?: boolean; id?: string; error?: string } = {};
  try {
    json = await res.json();
  } catch {
    /* ignore */
  }
  if (!res.ok || !json.ok || !json.id) throw new Error(json.error || (res.status === 413 ? 'File is too large (max 2 MB)' : 'Upload failed'));
  return json.id;
}

export function dataUrlToBlob(dataUrl: string): Blob {
  const [head, body] = dataUrl.split(',');
  const mime = /data:([^;]+)/.exec(head)?.[1] ?? 'application/octet-stream';
  const bin = atob(body);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return new Blob([arr], { type: mime });
}

export function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Could not read that image'));
    img.src = src;
  });
}

function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality?: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob((b) => resolve(b), type, quality));
}

/** Center-crops an image (or video frame) to a square JPEG. */
export async function squareJpeg(source: CanvasImageSource, srcW: number, srcH: number, size = 320, mirror = false): Promise<Blob> {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const s = Math.min(srcW, srcH);
  const sx = (srcW - s) / 2;
  const sy = (srcH - s) / 2;
  if (mirror) {
    ctx.translate(size, 0);
    ctx.scale(-1, 1);
  }
  ctx.drawImage(source, sx, sy, s, s, 0, 0, size, size);
  const blob = await canvasToBlob(canvas, 'image/jpeg', 0.82);
  if (!blob) throw new Error('Could not encode image');
  return blob;
}

export async function fileToSquareJpeg(file: File, size = 320): Promise<Blob> {
  const url = URL.createObjectURL(file);
  try {
    const img = await loadImage(url);
    return await squareJpeg(img, img.naturalWidth, img.naturalHeight, size);
  } finally {
    URL.revokeObjectURL(url);
  }
}

const KEEP_AS_IS = new Set(['image/png', 'image/webp', 'image/gif', 'image/jpeg']);

/**
 * Prepares a sticker image. Small files are kept untouched (animated WebP/GIF keep
 * animating); big ones are downscaled to 512px.
 */
export async function prepareStickerImage(file: Blob): Promise<{ blob: Blob; note?: string }> {
  if (KEEP_AS_IS.has(file.type) && file.size <= 900 * 1024) return { blob: file };
  const url = URL.createObjectURL(file);
  try {
    const img = await loadImage(url);
    const scale = Math.min(1, 512 / Math.max(img.naturalWidth, img.naturalHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
    canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height);
    let blob = await canvasToBlob(canvas, 'image/webp', 0.85);
    if (!blob || blob.type !== 'image/webp') blob = await canvasToBlob(canvas, 'image/png');
    if (!blob) throw new Error('Could not process image');
    const animated = file.type === 'image/gif' || file.type === 'image/webp';
    return { blob, note: animated ? 'Big animated sticker was flattened to keep it under the size limit.' : undefined };
  } finally {
    URL.revokeObjectURL(url);
  }
}
