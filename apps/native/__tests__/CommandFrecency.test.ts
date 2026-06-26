import {
  _resetFrecency,
  getAllCommandScores,
  getCommandScore,
  recordCommandUse,
} from '../src/web-parity/lib/commandFrecency';
import {getNativeStorage} from '../src/web-parity/lib/nativeWebStorage';

const STORAGE_KEY = 'teslasync:cmd-frecency:v1';
const MS_PER_DAY = 86_400_000;

describe('web-parity commandFrecency', () => {
  let nowSpy: jest.SpyInstance<number, []>;

  beforeEach(() => {
    // The native store is a process-scoped singleton; clear our slot only.
    _resetFrecency();
    nowSpy = jest.spyOn(Date, 'now');
  });

  afterEach(() => {
    nowSpy.mockRestore();
    _resetFrecency();
  });

  it('returns 0 for a command that was never recorded', () => {
    expect(getCommandScore('never')).toBe(0);
  });

  it('ignores an empty command id', () => {
    nowSpy.mockReturnValue(1_000);
    recordCommandUse('');
    expect(getAllCommandScores()).toEqual({});
  });

  it('records a use and scores it at full weight when fresh', () => {
    const t0 = 1_700_000_000_000;
    nowSpy.mockReturnValue(t0);
    recordCommandUse('open-vehicle');
    // count = 1, age = 0 => score = 1 * 2^0 = 1
    expect(getCommandScore('open-vehicle')).toBeCloseTo(1, 10);
  });

  it('increments count monotonically across repeated uses', () => {
    const t0 = 1_700_000_000_000;
    nowSpy.mockReturnValue(t0);
    recordCommandUse('refresh');
    recordCommandUse('refresh');
    recordCommandUse('refresh');
    // count = 3, age = 0 => score = 3
    expect(getCommandScore('refresh')).toBeCloseTo(3, 10);
  });

  it('halves the contribution every HALF_LIFE_DAYS (14d)', () => {
    const t0 = 1_700_000_000_000;
    nowSpy.mockReturnValue(t0);
    recordCommandUse('decaying');

    nowSpy.mockReturnValue(t0 + 14 * MS_PER_DAY);
    expect(getCommandScore('decaying')).toBeCloseTo(0.5, 10);

    nowSpy.mockReturnValue(t0 + 28 * MS_PER_DAY);
    expect(getCommandScore('decaying')).toBeCloseTo(0.25, 10);
  });

  it('clamps negative age (clock skew) to a non-decayed score', () => {
    const t0 = 1_700_000_000_000;
    nowSpy.mockReturnValue(t0);
    recordCommandUse('skew');
    // now earlier than lastUsed => Math.max(0, ...) keeps full weight
    nowSpy.mockReturnValue(t0 - 5 * MS_PER_DAY);
    expect(getCommandScore('skew')).toBeCloseTo(1, 10);
  });

  it('snapshots every command score in one pass', () => {
    const t0 = 1_700_000_000_000;
    nowSpy.mockReturnValue(t0);
    recordCommandUse('a');
    recordCommandUse('b');
    recordCommandUse('b');

    nowSpy.mockReturnValue(t0 + 14 * MS_PER_DAY);
    const scores = getAllCommandScores();
    expect(Object.keys(scores).sort()).toEqual(['a', 'b']);
    expect(scores.a).toBeCloseTo(0.5, 10);
    expect(scores.b).toBeCloseTo(1, 10);
  });

  it('wipes all stored frecency data on reset', () => {
    nowSpy.mockReturnValue(1_700_000_000_000);
    recordCommandUse('temp');
    expect(getCommandScore('temp')).toBeGreaterThan(0);
    _resetFrecency();
    expect(getCommandScore('temp')).toBe(0);
    expect(getAllCommandScores()).toEqual({});
  });

  it('filters out malformed rows without poisoning the store', () => {
    const storage = getNativeStorage('local');
    storage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        good: {count: 2, lastUsed: 1_700_000_000_000},
        missingFields: {count: 1},
        notFinite: {count: Number.POSITIVE_INFINITY, lastUsed: 1},
        notAnObject: 5,
      }),
    );
    nowSpy.mockReturnValue(1_700_000_000_000);
    const scores = getAllCommandScores();
    expect(Object.keys(scores)).toEqual(['good']);
    expect(scores.good).toBeCloseTo(2, 10);
  });

  it('returns an empty store when the persisted payload is not an object', () => {
    getNativeStorage('local').setItem(STORAGE_KEY, JSON.stringify([1, 2, 3]));
    expect(getAllCommandScores()).toEqual({});
  });
});
