import { useEffect, useRef, useState } from 'react';
import { squareJpeg } from '../lib/media';

export function CameraCapture({ onCapture, onCancel, confirmLabel = 'Use photo', size = 320 }: { onCapture: (b: Blob) => void; onCancel: () => void; confirmLabel?: string; size?: number }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [shot, setShot] = useState<{ blob: Blob; url: string } | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!window.isSecureContext) return setError('The camera needs a secure (https) connection.');
      if (!navigator.mediaDevices?.getUserMedia) return setError('This browser cannot use the camera.');
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 640 } }, audio: false });
        if (cancelled) return stream.getTracks().forEach((t) => t.stop());
        streamRef.current = stream;
        const v = videoRef.current;
        if (v) {
          v.srcObject = stream;
          await v.play().catch(() => undefined);
        }
      } catch (e) {
        const name = (e as DOMException)?.name;
        setError(name === 'NotAllowedError' ? 'Camera permission was denied. Allow it in your browser settings.' : 'Could not open the camera.');
      }
    })();
    return () => {
      cancelled = true;
      streamRef.current?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  useEffect(() => () => {
    if (shot) URL.revokeObjectURL(shot.url);
  }, [shot]);

  const capture = async () => {
    const v = videoRef.current;
    if (!v || !v.videoWidth) return;
    const blob = await squareJpeg(v, v.videoWidth, v.videoHeight, size, true);
    setShot({ blob, url: URL.createObjectURL(blob) });
  };

  if (error)
    return (
      <div className="rec-panel">
        <div style={{ fontSize: 44 }}>📷</div>
        <p className="muted center" style={{ margin: 0 }}>
          {error}
        </p>
        <button className="btn btn-glass" onClick={onCancel}>
          Back
        </button>
      </div>
    );

  return (
    <div className="rec-panel">
      <div className="camera">
        {shot ? <img src={shot.url} alt="Your photo" /> : <video ref={videoRef} className="mirror" playsInline muted autoPlay onLoadedData={() => setReady(true)} />}
      </div>
      <div className="row" style={{ width: '100%' }}>
        {shot ? (
          <>
            <button className="btn btn-glass" style={{ flex: 1 }} onClick={() => setShot(null)}>
              Retake
            </button>
            <button className="btn btn-gold" style={{ flex: 1 }} onClick={() => onCapture(shot.blob)}>
              {confirmLabel}
            </button>
          </>
        ) : (
          <>
            <button className="btn btn-glass" style={{ flex: 1 }} onClick={onCancel}>
              Cancel
            </button>
            <button className="btn btn-gold" style={{ flex: 1 }} disabled={!ready} onClick={capture}>
              📸 Snap
            </button>
          </>
        )}
      </div>
    </div>
  );
}
