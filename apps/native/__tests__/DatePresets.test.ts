import {
  DATE_PRESETS,
  DEFAULT_PRESET_IDS,
  getDatePreset,
  matchPresetId,
  resolveAllTimeStart,
} from '../src/web-parity/lib/datePresets';

// Local-calendar anchor (noon avoids DST/midnight edges for setDate math).
// June index = 5. Mid-month so the rolling windows don't clamp at a boundary.
const ANCHOR = new Date(2024, 5, 15, 12, 0, 0);

function isoLocal(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

describe('web-parity datePresets', () => {
  it('exposes the full preset set in display order', () => {
    expect(DATE_PRESETS.map(p => p.id)).toEqual([
      'today',
      'yesterday',
      '7d',
      '30d',
      '90d',
      'mtd',
      'qtd',
      'ytd',
      'lastMonth',
      '1y',
      'all',
    ]);
  });

  it('keeps i18n keys and fallbacks intact', () => {
    expect(getDatePreset('today')).toMatchObject({
      i18nKey: 'date.preset.today',
      fallback: 'Today',
    });
    expect(getDatePreset('all')).toMatchObject({
      i18nKey: 'date.preset.all',
      fallback: 'All time',
    });
  });

  it('resolves calendar-anchored presets to exact local YYYY-MM-DD ranges', () => {
    const ranges = Object.fromEntries(
      DATE_PRESETS.map(p => [p.id, p.resolve(ANCHOR)]),
    );
    expect(ranges.today).toEqual({start: '2024-06-15', end: '2024-06-15'});
    expect(ranges.yesterday).toEqual({
      start: '2024-06-14',
      end: '2024-06-14',
    });
    expect(ranges.mtd).toEqual({start: '2024-06-01', end: '2024-06-15'});
    expect(ranges.qtd).toEqual({start: '2024-04-01', end: '2024-06-15'});
    expect(ranges.ytd).toEqual({start: '2024-01-01', end: '2024-06-15'});
    expect(ranges.lastMonth).toEqual({
      start: '2024-05-01',
      end: '2024-05-31',
    });
    expect(ranges['1y']).toEqual({start: '2023-06-15', end: '2024-06-15'});
    expect(ranges.all).toEqual({start: '2015-01-01', end: '2024-06-15'});
  });

  it('resolves rolling N-day windows with an inclusive end', () => {
    const get = (id: string) => DATE_PRESETS.find(p => p.id === id)!;
    expect(get('7d').resolve(ANCHOR)).toEqual({
      start: '2024-06-09',
      end: '2024-06-15',
    });
    expect(get('30d').resolve(ANCHOR)).toEqual({
      start: '2024-05-17',
      end: '2024-06-15',
    });
    expect(get('90d').resolve(ANCHOR)).toEqual({
      start: '2024-03-18',
      end: '2024-06-15',
    });
  });

  it('zero-pads single-digit month and day via iso()', () => {
    const early = new Date(2024, 0, 5, 12, 0, 0); // Jan 5
    expect(getDatePreset('today')!.resolve(early)).toEqual({
      start: '2024-01-05',
      end: '2024-01-05',
    });
  });

  it('defaults `now` to the current local wall-clock day', () => {
    const todayIso = isoLocal(new Date());
    expect(getDatePreset('today')!.resolve()).toEqual({
      start: todayIso,
      end: todayIso,
    });
  });

  it('looks up presets by id and returns undefined for unknown ids', () => {
    expect(getDatePreset('30d')?.id).toBe('30d');
    expect(getDatePreset('does-not-exist')).toBeUndefined();
  });

  it('keeps the default chip set stable', () => {
    expect([...DEFAULT_PRESET_IDS]).toEqual([
      'today',
      '7d',
      '30d',
      'mtd',
      'ytd',
      'all',
    ]);
  });

  describe('resolveAllTimeStart', () => {
    it('returns the 2015 baseline when no floor is supplied', () => {
      expect(resolveAllTimeStart()).toBe('2015-01-01');
      expect(resolveAllTimeStart(undefined)).toBe('2015-01-01');
    });

    it('clamps up to a later first-data-point floor', () => {
      expect(resolveAllTimeStart('2024-01-01')).toBe('2024-01-01');
    });

    it('keeps the baseline when the floor predates it', () => {
      expect(resolveAllTimeStart('2010-01-01')).toBe('2015-01-01');
      expect(resolveAllTimeStart('2015-01-01')).toBe('2015-01-01');
    });
  });

  describe('matchPresetId', () => {
    it('round-trips every preset against its own resolved range', () => {
      for (const preset of DATE_PRESETS) {
        const r = preset.resolve(ANCHOR);
        expect(matchPresetId(r.start, r.end, ANCHOR)).toBe(preset.id);
      }
    });

    it('returns undefined when no preset matches', () => {
      expect(matchPresetId('1999-01-01', '1999-01-02', ANCHOR)).toBeUndefined();
    });
  });
});
