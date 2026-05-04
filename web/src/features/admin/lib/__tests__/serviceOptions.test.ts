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

  it('sorts the tail alphabetically by label (case-insensitive), with All pinned first', () => {
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
    // Counts are intentionally ignored — pure alphabetical scan order
    // (chip row above shows counts; dropdown is for finding services).
    expect(out.map((o) => o.value)).toEqual([
      '',
      'geocoder-google',
      'github-releases',
      'notify-generic',
      'system-dns-check',
      'tesla-api',       // labelFor → "Tesla API" (space before hyphen)
      'teslasync-api',   // labelFor → "TeslaSync API"
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
    // Both present, sorted alphabetically. labelFor doesn't translate
    // 'tesla-auth' so its label is the raw key — under base-sensitivity
    // localeCompare the hyphen sorts before 'S'/'s', so tesla-auth
    // lands before TeslaSync API.
    expect(out.map((o) => o.value)).toEqual(['', 'tesla-auth', 'teslasync-api']);
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

  /* -------------------------------------------------------------- */
  /*  knownServices union (regression guard for dropdown shrinking) */
  /* -------------------------------------------------------------- */

  it('includes knownServices that are absent from byService, sorted alphabetically with the rest', () => {
    const out = deriveServiceOptions({
      byService: { 'teslasync-api': 5 },
      activeService: '',
      labelFor,
      allLabel: 'All Services',
      knownServices: ['teslasync-api', 'github-releases', 'eia'],
    });
    // Pure alphabetical: eia, github-releases, TeslaSync API
    expect(out.map((o) => o.value)).toEqual([
      '',
      'eia',
      'github-releases',
      'teslasync-api',
    ]);
  });

  it('produces no duplicates when a service appears in both byService and knownServices', () => {
    const out = deriveServiceOptions({
      byService: { 'teslasync-api': 100, 'github-releases': 3 },
      activeService: '',
      labelFor,
      allLabel: 'All Services',
      knownServices: ['teslasync-api', 'github-releases', 'eia'],
    });
    expect(out.map((o) => o.value)).toEqual([
      '',
      'eia',
      'github-releases',
      'teslasync-api',
    ]);
    // No duplicate keys.
    expect(out.filter((o) => o.value === 'teslasync-api')).toHaveLength(1);
    expect(out.filter((o) => o.value === 'github-releases')).toHaveLength(1);
  });

  it('still works when byService is undefined but knownServices is present', () => {
    const out = deriveServiceOptions({
      byService: undefined,
      activeService: '',
      labelFor,
      allLabel: 'All Services',
      knownServices: ['teslasync-api', 'tesla-api', 'eia'],
    });
    expect(out.map((o) => o.value)).toEqual([
      '',
      'eia',
      'tesla-api',
      'teslasync-api',
    ]);
  });

  it('deduplicates duplicate entries inside knownServices', () => {
    const out = deriveServiceOptions({
      byService: {},
      activeService: '',
      labelFor,
      allLabel: 'All Services',
      knownServices: ['eia', 'eia', 'github-releases'],
    });
    expect(out.map((o) => o.value)).toEqual(['', 'eia', 'github-releases']);
  });

  it('does not duplicate the active service when it is already in knownServices', () => {
    const out = deriveServiceOptions({
      byService: { 'teslasync-api': 5 },
      activeService: 'tesla-auth',
      labelFor,
      allLabel: 'All Services',
      knownServices: ['teslasync-api', 'tesla-auth'],
    });
    expect(out.filter((o) => o.value === 'tesla-auth')).toHaveLength(1);
    // Alphabetical: tesla-auth (hyphen before 's' under base sensitivity)
    // sorts before TeslaSync API.
    expect(out.map((o) => o.value)).toEqual(['', 'tesla-auth', 'teslasync-api']);
  });

  it('still appends an active service that is in neither byService nor knownServices', () => {
    const out = deriveServiceOptions({
      byService: { 'teslasync-api': 5 },
      activeService: 'mystery-service',
      labelFor,
      allLabel: 'All Services',
      knownServices: ['teslasync-api', 'eia'],
    });
    expect(out.filter((o) => o.value === 'mystery-service')).toHaveLength(1);
  });
});
