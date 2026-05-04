import { describe, expect, it } from 'vitest';
import { deriveServiceOptions } from '../serviceOptions';

const labelFor = (svc: string) => {
  if (svc === 'teslasync-api') return 'TeslaSync API';
  if (svc === 'tesla-api') return 'Tesla API';
  return svc;
};

describe('deriveServiceOptions', () => {
  it('returns just the All option when stats are undefined', () => {
    const out = deriveServiceOptions({
      byService: undefined,
      activeService: '',
      labelFor,
      allLabel: 'All Services',
    });
    expect(out).toEqual([{ value: '', label: 'All Services' }]);
  });

  it('returns just the All option when stats are empty', () => {
    const out = deriveServiceOptions({
      byService: {},
      activeService: '',
      labelFor,
      allLabel: 'All Services',
    });
    expect(out).toHaveLength(1);
  });

  it('sorts by count desc, with alphabetical tiebreak', () => {
    const out = deriveServiceOptions({
      byService: {
        'teslasync-api': 3690,
        'notify-generic': 78,
        'geocoder-google': 23,
        'tesla-api': 21,
        'github-releases': 9,
        'system-dns-check': 9,
      },
      activeService: '',
      labelFor,
      allLabel: 'All Services',
    });
    expect(out.map((o) => o.value)).toEqual([
      '',
      'teslasync-api',
      'notify-generic',
      'geocoder-google',
      'tesla-api',
      // 9-tied — alphabetical: github before system
      'github-releases',
      'system-dns-check',
    ]);
  });

  it('uses labelFor for known services and falls through to raw value', () => {
    const out = deriveServiceOptions({
      byService: { 'teslasync-api': 5, 'unknown-thing': 2 },
      activeService: '',
      labelFor,
      allLabel: 'All Services',
    });
    expect(out.find((o) => o.value === 'teslasync-api')?.label).toBe('TeslaSync API');
    expect(out.find((o) => o.value === 'unknown-thing')?.label).toBe('unknown-thing');
  });

  it('retains an active service that is absent from stats (zero-row window)', () => {
    const out = deriveServiceOptions({
      byService: { 'teslasync-api': 5 },
      activeService: 'tesla-auth',
      labelFor,
      allLabel: 'All Services',
    });
    expect(out.map((o) => o.value)).toEqual(['', 'teslasync-api', 'tesla-auth']);
  });

  it('does NOT duplicate the active service when it is also in stats', () => {
    const out = deriveServiceOptions({
      byService: { 'teslasync-api': 5, 'tesla-auth': 1 },
      activeService: 'tesla-auth',
      labelFor,
      allLabel: 'All Services',
    });
    expect(out.filter((o) => o.value === 'tesla-auth')).toHaveLength(1);
  });

  it('does NOT inject the active service when activeService is empty', () => {
    const out = deriveServiceOptions({
      byService: { 'teslasync-api': 5 },
      activeService: '',
      labelFor,
      allLabel: 'All Services',
    });
    expect(out).toHaveLength(2);
    expect(out[0].value).toBe('');
    expect(out[1].value).toBe('teslasync-api');
  });
});
