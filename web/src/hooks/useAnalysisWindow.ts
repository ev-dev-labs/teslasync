import { useCallback, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';

export function useAnalysisWindow(key: 'hours' | 'days', presets: readonly number[], defaultValue: number) {
  const [params, setParams] = useSearchParams();
  const [anchor] = useState(() => Date.now());
  const raw = Number(params.get(key));
  const selected = presets.includes(raw) ? raw : defaultValue;
  const scale = (key === 'days' ? 24 : 1) * 3600 * 1000;
  const start = params.get('start');
  const end = params.get('end');
  const window = useMemo(() => {
    const from = start ? Date.parse(start) : NaN;
    const to = end ? Date.parse(end) : NaN;
    if (Number.isFinite(from) && Number.isFinite(to) && to > from && to - from <= Math.max(...presets) * scale) {
      return { start: new Date(from).toISOString(), end: new Date(to).toISOString() };
    }
    return { start: new Date(anchor - selected * scale).toISOString(), end: new Date(anchor).toISOString() };
  }, [start, end, selected, scale, presets, anchor]);
  const pickWindow = useCallback((value: number) => {
    const now = Date.now();
    setParams(previous => {
      const next = new URLSearchParams(previous);
      next.set(key, String(value));
      next.set('start', new Date(now - value * scale).toISOString());
      next.set('end', new Date(now).toISOString());
      return next;
    });
  }, [key, scale, setParams]);
  return { selected, window, pickWindow };
}
