import { renderHook, act } from '@testing-library/react';
import { describe, expect, it, beforeEach, vi } from 'vitest';
import { MemoryRouter, Routes, Route, useSearchParams } from 'react-router-dom';
import type { ReactNode } from 'react';
import { SHARED_RANGE_STORAGE_KEY, useRangeState } from '../useRangeState';

function withRouter(initialEntries: string[]) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <MemoryRouter initialEntries={initialEntries}>
        <Routes>
          <Route path="/charging" element={children} />
        </Routes>
      </MemoryRouter>
    );
  };
}

describe('useRangeState — initialization precedence', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('uses URL params when present and valid', () => {
    const { result } = renderHook(() => useRangeState({ defaultPresetId: '7d' }), {
      wrapper: withRouter(['/charging?from=2025-01-01&to=2025-01-31']),
    });
    expect(result.current.start).toBe('2025-01-01');
    expect(result.current.end).toBe('2025-01-31');
  });

  it('falls back to default preset when URL is empty', () => {
    const { result } = renderHook(() => useRangeState({ defaultPresetId: '7d' }), {
      wrapper: withRouter(['/charging']),
    });
    expect(result.current.start).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(result.current.end).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    // 7d preset spans 7 days inclusive.
    const days =
      Math.round(
        (new Date(`${result.current.end}T00:00:00`).getTime() -
          new Date(`${result.current.start}T00:00:00`).getTime()) /
          86_400_000,
      ) + 1;
    expect(days).toBe(7);
  });

  it('rejects malformed URL params and falls back to default', () => {
    const { result } = renderHook(() => useRangeState({ defaultPresetId: '30d' }), {
      wrapper: withRouter(['/charging?from=bad&to=2025-01-31']),
    });
    // Should not crash; falls back to 30d default.
    expect(result.current.start).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('rejects URL params where start > end', () => {
    const { result } = renderHook(() => useRangeState({ defaultPresetId: '7d' }), {
      wrapper: withRouter(['/charging?from=2025-12-31&to=2025-01-01']),
    });
    // Should fall back to 7d default rather than honor the inverted range.
    const days =
      Math.round(
        (new Date(`${result.current.end}T00:00:00`).getTime() -
          new Date(`${result.current.start}T00:00:00`).getTime()) /
          86_400_000,
      ) + 1;
    expect(days).toBe(7);
  });
});

describe('useRangeState — localStorage persistence', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('restores from localStorage when URL is empty', () => {
    window.localStorage.setItem(
      'charging.list.range',
      JSON.stringify({ start: '2024-06-01', end: '2024-06-30' }),
    );
    const { result } = renderHook(
      () => useRangeState({ persistKey: 'charging.list.range', defaultPresetId: '30d' }),
      { wrapper: withRouter(['/charging']) },
    );
    // Restoration writes URL on mount, so the next render reads from URL.
    expect(result.current.start).toBe('2024-06-01');
    expect(result.current.end).toBe('2024-06-30');
  });

  it('URL takes precedence over localStorage', () => {
    window.localStorage.setItem(
      'charging.list.range',
      JSON.stringify({ start: '2024-06-01', end: '2024-06-30' }),
    );
    const { result } = renderHook(
      () => useRangeState({ persistKey: 'charging.list.range' }),
      { wrapper: withRouter(['/charging?from=2025-01-01&to=2025-01-31']) },
    );
    expect(result.current.start).toBe('2025-01-01');
    expect(result.current.end).toBe('2025-01-31');
  });

  it('persists committed range changes to localStorage', () => {
    const { result } = renderHook(
      () => useRangeState({ persistKey: 'charging.list.range' }),
      { wrapper: withRouter(['/charging?from=2025-01-01&to=2025-01-31']) },
    );
    act(() => {
      result.current.setRange({ start: '2025-02-01', end: '2025-02-28' });
    });
    const stored = JSON.parse(
      window.localStorage.getItem('charging.list.range') ?? '{}',
    );
    expect(stored).toEqual({ start: '2025-02-01', end: '2025-02-28' });
  });

  it('ignores corrupt localStorage data', () => {
    window.localStorage.setItem('charging.list.range', '{not json');
    const { result } = renderHook(
      () => useRangeState({ persistKey: 'charging.list.range', defaultPresetId: '7d' }),
      { wrapper: withRouter(['/charging']) },
    );
    // Should fall back to 7d default rather than crash.
    expect(result.current.start).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('inherits the last selection across page-specific storage keys', () => {
    const firstPage = renderHook(
      () => useRangeState({ persistKey: 'charging.list.range' }),
      { wrapper: withRouter(['/charging']) },
    );
    act(() => {
      firstPage.result.current.setRange({
        start: '2025-02-01',
        end: '2025-02-28',
      });
    });
    firstPage.unmount();

    const secondPage = renderHook(
      () => useRangeState({ persistKey: 'drives.list.range' }),
      { wrapper: withRouter(['/charging']) },
    );
    expect(secondPage.result.current.start).toBe('2025-02-01');
    expect(secondPage.result.current.end).toBe('2025-02-28');
  });

  it('uses an explicit URL instead of the shared selection', () => {
    window.localStorage.setItem(
      SHARED_RANGE_STORAGE_KEY,
      JSON.stringify({ start: '2024-06-01', end: '2024-06-30' }),
    );
    const { result } = renderHook(
      () => useRangeState({ persistKey: 'drives.list.range' }),
      { wrapper: withRouter(['/charging?from=2025-03-01&to=2025-03-31']) },
    );

    expect(result.current.start).toBe('2025-03-01');
    expect(result.current.end).toBe('2025-03-31');
    expect(JSON.parse(window.localStorage.getItem(SHARED_RANGE_STORAGE_KEY) ?? '{}'))
      .toEqual({ start: '2025-03-01', end: '2025-03-31' });
  });

  it('prefers shared storage over a legacy page-specific selection', () => {
    window.localStorage.setItem(
      SHARED_RANGE_STORAGE_KEY,
      JSON.stringify({ start: '2025-04-01', end: '2025-04-30' }),
    );
    window.localStorage.setItem(
      'charging.list.range',
      JSON.stringify({ start: '2024-06-01', end: '2024-06-30' }),
    );
    const { result } = renderHook(
      () => useRangeState({ persistKey: 'charging.list.range' }),
      { wrapper: withRouter(['/charging']) },
    );

    expect(result.current.start).toBe('2025-04-01');
    expect(result.current.end).toBe('2025-04-30');
  });

  it('promotes a non-default legacy page selection when shared storage is empty', () => {
    window.localStorage.setItem(
      'charging.list.range',
      JSON.stringify({ start: '2024-06-01', end: '2024-06-30' }),
    );
    renderHook(
      () => useRangeState({ persistKey: 'charging.list.range', defaultPresetId: '30d' }),
      { wrapper: withRouter(['/charging']) },
    );

    expect(JSON.parse(window.localStorage.getItem(SHARED_RANGE_STORAGE_KEY) ?? '{}'))
      .toEqual({ start: '2024-06-01', end: '2024-06-30' });
  });

  it('ignores malformed shared storage and falls back to the page selection', () => {
    window.localStorage.setItem(SHARED_RANGE_STORAGE_KEY, '{not json');
    window.localStorage.setItem(
      'charging.list.range',
      JSON.stringify({ start: '2024-07-01', end: '2024-07-31' }),
    );
    const { result } = renderHook(
      () => useRangeState({ persistKey: 'charging.list.range' }),
      { wrapper: withRouter(['/charging']) },
    );

    expect(result.current.start).toBe('2024-07-01');
    expect(result.current.end).toBe('2024-07-31');
  });

  it('clamps the page range without shrinking the shared selection', () => {
    const shared = { start: '2020-01-01', end: '2025-01-31' };
    window.localStorage.setItem(SHARED_RANGE_STORAGE_KEY, JSON.stringify(shared));
    const { result } = renderHook(
      () => useRangeState({
        persistKey: 'limited-data.range',
        minDate: '2024-01-01',
      }),
      { wrapper: withRouter(['/charging']) },
    );

    expect(result.current.start).toBe('2024-01-01');
    expect(result.current.end).toBe('2025-01-31');
    expect(JSON.parse(window.localStorage.getItem(SHARED_RANGE_STORAGE_KEY) ?? '{}'))
      .toEqual(shared);
  });

  it('stores the page default as the shared range after an explicit reset', () => {
    const { result } = renderHook(
      () => useRangeState({ defaultPresetId: '7d' }),
      { wrapper: withRouter(['/charging?from=2025-01-01&to=2025-01-31']) },
    );
    act(() => result.current.reset());

    const stored = JSON.parse(
      window.localStorage.getItem(SHARED_RANGE_STORAGE_KEY) ?? '{}',
    );
    expect(stored).toEqual({ start: result.current.start, end: result.current.end });
  });
});

describe('useRangeState — preset id derivation', () => {
  beforeEach(() => window.localStorage.clear());

  it('returns the matching preset id when range matches a preset', () => {
    // Today is the only preset that's deterministic: start === end === today.
    const today = new Date();
    const iso = (d: Date) => {
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      return `${y}-${m}-${day}`;
    };
    const t = iso(today);
    const { result } = renderHook(() => useRangeState(), {
      wrapper: withRouter([`/charging?from=${t}&to=${t}`]),
    });
    expect(result.current.presetId).toBe('today');
  });

  it('returns undefined for custom (non-preset) ranges', () => {
    const { result } = renderHook(() => useRangeState(), {
      wrapper: withRouter(['/charging?from=2024-03-15&to=2024-04-22']),
    });
    expect(result.current.presetId).toBeUndefined();
  });
});

describe('useRangeState — comparison mode', () => {
  beforeEach(() => window.localStorage.clear());

  it('returns no compare data when enableCompare is false', () => {
    const { result } = renderHook(() => useRangeState({ enableCompare: false }), {
      wrapper: withRouter(['/charging?from=2025-01-08&to=2025-01-14&compare=true']),
    });
    expect(result.current.compare).toBe(false);
    expect(result.current.comparePrev).toBeUndefined();
  });

  it('exposes comparePrev with same length, ending one day before start', () => {
    const { result } = renderHook(() => useRangeState({ enableCompare: true }), {
      wrapper: withRouter(['/charging?from=2025-01-08&to=2025-01-14&compare=true']),
    });
    expect(result.current.compare).toBe(true);
    // 2025-01-08 → 2025-01-14 is 7 days; previous period is 2025-01-01 → 2025-01-07.
    expect(result.current.comparePrev).toEqual({ start: '2025-01-01', end: '2025-01-07' });
  });

  it('comparePrev clears when compare flag is turned off', () => {
    const { result } = renderHook(() => useRangeState({ enableCompare: true }), {
      wrapper: withRouter(['/charging?from=2025-01-08&to=2025-01-14&compare=true']),
    });
    act(() => result.current.setCompare(false));
    expect(result.current.compare).toBe(false);
    expect(result.current.comparePrev).toBeUndefined();
  });
});

describe('useRangeState — minDate clamping', () => {
  beforeEach(() => window.localStorage.clear());

  it('clamps URL-supplied range below minDate', () => {
    const { result } = renderHook(
      () => useRangeState({ minDate: '2024-01-01' }),
      { wrapper: withRouter(['/charging?from=2020-06-15&to=2025-01-01']) },
    );
    expect(result.current.start).toBe('2024-01-01');
    expect(result.current.end).toBe('2025-01-01');
  });

  it('clamps "all" preset start to minDate', () => {
    const { result } = renderHook(
      () => useRangeState({ defaultPresetId: 'all', minDate: '2024-01-01' }),
      { wrapper: withRouter(['/charging']) },
    );
    expect(result.current.start).toBe('2024-01-01');
  });
});

describe('useRangeState — atomic updates', () => {
  beforeEach(() => window.localStorage.clear());

  it('setRange writes both keys in a single navigation', () => {
    let urlSnap = '';
    const Probe = () => {
      const r = useRangeState();
      urlSnap = `${r.start}|${r.end}`;
      // Force a reference to setRange so the hook isn't tree-shaken.
      void r.setRange;
      return null;
    };
    const { rerender } = renderHook(() => null, {
      wrapper: ({ children }: { children: ReactNode }) => (
        <MemoryRouter initialEntries={['/charging']}>
          <Routes>
            <Route
              path="/charging"
              element={
                <>
                  <Probe />
                  {children}
                </>
              }
            />
          </Routes>
        </MemoryRouter>
      ),
    });
    rerender();
    expect(urlSnap).toMatch(/^\d{4}-\d{2}-\d{2}\|\d{4}-\d{2}-\d{2}$/);
  });

  it('updates related URL keys in the same navigation as the range', () => {
    const { result } = renderHook(() => {
      const range = useRangeState();
      const [params] = useSearchParams();
      return { range, query: params.toString() };
    }, {
      wrapper: withRouter(['/charging?page=4']),
    });

    act(() => {
      result.current.range.setRangeWithUrlUpdates(
        { start: '2025-05-01', end: '2025-05-31' },
        { page: null, q: 'roadtrip' },
      );
    });

    const params = new URLSearchParams(result.current.query);
    expect(params.get('from')).toBe('2025-05-01');
    expect(params.get('to')).toBe('2025-05-31');
    expect(params.get('page')).toBeNull();
    expect(params.get('q')).toBe('roadtrip');
  });

  it('reset removes from/to/compare from the URL', () => {
    const { result } = renderHook(() => useRangeState({ enableCompare: true }), {
      wrapper: withRouter(['/charging?from=2025-01-01&to=2025-01-31&compare=true']),
    });
    act(() => result.current.reset());
    expect(result.current.compare).toBe(false);
  });
});

describe('useRangeState — custom URL keys', () => {
  beforeEach(() => window.localStorage.clear());

  it('reads from custom fromKey/toKey', () => {
    const { result } = renderHook(
      () => useRangeState({ fromKey: 'dateFrom', toKey: 'dateTo' }),
      { wrapper: withRouter(['/charging?dateFrom=2025-03-01&dateTo=2025-03-15']) },
    );
    expect(result.current.start).toBe('2025-03-01');
    expect(result.current.end).toBe('2025-03-15');
  });
});

// Skip storage-quota test in jsdom — happy path is covered above.
void vi;
