import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { serverNow } from './store';

export function useSize<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => setSize({ w: el.clientWidth, h: el.clientHeight });
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, size] as const;
}

/** Re-renders every `ms` while `active`, returning server time. */
export function useNow(active: boolean, ms = 250) {
  const [now, setNow] = useState(() => serverNow());
  useEffect(() => {
    if (!active) return;
    setNow(serverNow());
    const t = setInterval(() => setNow(serverNow()), ms);
    return () => clearInterval(t);
  }, [active, ms]);
  return now;
}

export function usePrevious<T>(value: T) {
  const ref = useRef<T | undefined>(undefined);
  useEffect(() => {
    ref.current = value;
  });
  return ref.current;
}
