import { describe, expect, it } from 'vitest';
import { createEnglishI18n } from '@/test/createEnglishI18n';
import { computeReplayMarkers } from '../replayMarkers';
import { replayMarkerLabel } from '../replayMarkerLabel';

const fmtInt = (value: number) => new Intl.NumberFormat('en-US').format(value);

describe('replayMarkerLabel', () => {
  it('localizes single markers through the canonical keys', async () => {
    const t = (await createEnglishI18n()).getFixedT('en', 'translation') as unknown as
      (key: string, options: Record<string, unknown>) => string;
    expect(replayMarkerLabel(t, fmtInt, 'start')).toBe('Start');
    expect(replayMarkerLabel(t, fmtInt, 'stop', 1)).toBe('End');
    expect(replayMarkerLabel(t, fmtInt, 'regen-peak')).toBe('Regen peak');
    expect(replayMarkerLabel(t, fmtInt, 'low-soc')).toBe('Low battery');
  });

  it('uses count-aware plurals with the formatted count for clusters', async () => {
    const t = (await createEnglishI18n()).getFixedT('en', 'translation') as unknown as
      (key: string, options: Record<string, unknown>) => string;
    expect(replayMarkerLabel(t, fmtInt, 'fast-segment', 3)).toBe('3 fast segments');
    expect(replayMarkerLabel(t, fmtInt, 'regen-peak', 1200)).toBe('1,200 regen peaks');
  });

  it('keeps the domain model free of presentation strings', () => {
    const markers = computeReplayMarkers([]);
    expect(markers.every((marker) => marker.label === undefined)).toBe(true);
  });
});
