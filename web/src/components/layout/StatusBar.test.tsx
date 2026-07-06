/**
 * StatusBar behaviour + hardening tests.
 *
 * StatusBar is the always-on footer that composes six independent status
 * segments and is driven by a persisted preference store. The suite locks the
 * pieces that a silent regression would break for every user:
 *
 *   - Visibility contract: hidden when `prefs.enabled` is false, otherwise a
 *     `role="status"` / `aria-live="polite"` landmark that announces updates.
 *   - Icon-only propagation: forced by the `compact` prop, by `prefs.iconOnly`,
 *     and by a narrow (`<lg`) viewport — each independently collapses every
 *     segment to its icon variant.
 *   - matchMedia safety: rendering must NOT throw in environments where
 *     `window.matchMedia` is absent (SSR / older embedded webviews / jsdom).
 *     This is the regression the source hardening fixed — an unguarded
 *     `window.matchMedia(...)` used to crash the whole shell.
 *   - The `useStatusBarPrefs` / `setStatusBarPrefs` external store: reactive
 *     reads, partial merges, localStorage persistence (and graceful failure),
 *     and cross-tab `storage`-event sync including malformed-JSON fallback.
 *
 * The six segments are mocked to tiny probes that echo the `iconOnly` prop, so
 * the suite exercises StatusBar's own orchestration without booting the whole
 * telemetry / query dependency tree.
 */

import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
  vi,
} from 'vitest';
import {
  render,
  screen,
  renderHook,
  act,
  cleanup,
} from '@testing-library/react';

// ── Mocks ────────────────────────────────────────────────────────────────────

// react-i18next → fallback-aware `t` so we can assert the English defaults
// without booting the i18n runtime. Mirrors the pattern in PageContainer.test.
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback: string, opts?: Record<string, unknown>) => {
      if (!opts) return fallback;
      return Object.entries(opts).reduce(
        (out, [k, v]) => out.replace(`{{${k}}}`, String(v)),
        fallback,
      );
    },
  }),
}));

// Each segment becomes a probe echoing the `iconOnly` prop it received. The
// specifiers match StatusBar's own relative imports (same directory), so the
// mocks resolve to the identical module ids.
vi.mock('./status-bar/ConnectionSegment', () => ({
  ConnectionSegment: ({ iconOnly }: { iconOnly?: boolean }) => (
    <div data-testid="seg-connection" data-icon-only={String(!!iconOnly)} />
  ),
}));
vi.mock('./status-bar/LiveTelemetrySegment', () => ({
  LiveTelemetrySegment: ({ iconOnly }: { iconOnly?: boolean }) => (
    <div data-testid="seg-live" data-icon-only={String(!!iconOnly)} />
  ),
}));
vi.mock('./status-bar/ActiveVehicleSegment', () => ({
  ActiveVehicleSegment: ({ iconOnly }: { iconOnly?: boolean }) => (
    <div data-testid="seg-vehicle" data-icon-only={String(!!iconOnly)} />
  ),
}));
vi.mock('./status-bar/BackgroundWorkSegment', () => ({
  BackgroundWorkSegment: ({ iconOnly }: { iconOnly?: boolean }) => (
    <div data-testid="seg-background" data-icon-only={String(!!iconOnly)} />
  ),
}));
vi.mock('./status-bar/VersionSegment', () => ({
  VersionSegment: ({ iconOnly }: { iconOnly?: boolean }) => (
    <div data-testid="seg-version" data-icon-only={String(!!iconOnly)} />
  ),
}));
vi.mock('./status-bar/HelpSegment', () => ({
  HelpSegment: ({ iconOnly }: { iconOnly?: boolean }) => (
    <div data-testid="seg-help" data-icon-only={String(!!iconOnly)} />
  ),
}));

// Imported AFTER the mock blocks so the mocked segments are wired before the
// StatusBar module evaluates its imports.
import {
  StatusBar,
  useStatusBarPrefs,
  setStatusBarPrefs,
  type StatusBarPrefs,
} from './StatusBar';

// ── Helpers ──────────────────────────────────────────────────────────────────

const STORAGE_KEY = 'teslasync-status-bar-prefs';
const SEGMENT_TESTIDS = [
  'seg-connection',
  'seg-live',
  'seg-vehicle',
  'seg-background',
  'seg-version',
  'seg-help',
] as const;

/** Install a deterministic `window.matchMedia` returning `matches(query)`. */
function patchMatchMedia(matches: (query: string) => boolean) {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    writable: true,
    value: vi.fn(
      (query: string): MediaQueryList =>
        ({
          matches: matches(query),
          media: query,
          onchange: null,
          addEventListener: () => {},
          removeEventListener: () => {},
          addListener: () => {},
          removeListener: () => {},
          dispatchEvent: () => true,
        }) as MediaQueryList,
    ),
  });
}

/** Restore jsdom's default (no `matchMedia` implementation). */
function removeMatchMedia() {
  Reflect.deleteProperty(window, 'matchMedia');
}

/** Dispatch a `storage` event carrying only the `key` the handler inspects. */
function fireStorage(key: string | null) {
  const evt = new Event('storage') as StorageEvent;
  Object.defineProperty(evt, 'key', { configurable: true, value: key });
  window.dispatchEvent(evt);
}

function iconOnlyOf(testId: string): string | null {
  return screen.getByTestId(testId).getAttribute('data-icon-only');
}

beforeEach(() => {
  // Reset the module-scoped preference store + storage to a known baseline.
  window.localStorage.clear();
  setStatusBarPrefs({ enabled: true, iconOnly: false });
  removeMatchMedia();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  removeMatchMedia();
});

// ── StatusBar: visibility + a11y ─────────────────────────────────────────────

describe('StatusBar :: visibility & accessibility', () => {
  it('renders a role="status" landmark that announces updates politely', () => {
    render(<StatusBar />);
    const bar = screen.getByRole('status');
    expect(bar.tagName.toLowerCase()).toBe('footer');
    expect(bar).toHaveAttribute('aria-live', 'polite');
    expect(bar).toHaveAttribute('aria-label', 'Application status');
    // Print + layout hooks the surrounding shell / stylesheet depend on.
    expect(bar).toHaveAttribute('data-role', 'status-bar');
    expect(bar).toHaveAttribute('data-print-hide');
  });

  it('renders all six status segments', () => {
    render(<StatusBar />);
    for (const id of SEGMENT_TESTIDS) {
      expect(screen.getByTestId(id)).toBeInTheDocument();
    }
  });

  it('renders exactly three non-semantic dividers, hidden from a11y', () => {
    const { container } = render(<StatusBar />);
    const dividers = container.querySelectorAll('span.w-px');
    expect(dividers.length).toBe(3);
    dividers.forEach((d) => expect(d).toHaveAttribute('aria-hidden'));
  });

  it('renders nothing when the bar is disabled via preferences', () => {
    act(() => setStatusBarPrefs({ enabled: false }));
    const { container } = render(<StatusBar />);
    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByRole('status')).toBeNull();
    expect(screen.queryByTestId('seg-connection')).toBeNull();
  });

  it('merges a custom className onto the footer without dropping the base classes', () => {
    render(<StatusBar className="custom-marker-xyz" />);
    const bar = screen.getByRole('status');
    expect(bar.className).toContain('custom-marker-xyz');
    // A representative base class survives the merge.
    expect(bar.className).toContain('fixed');
  });
});

// ── StatusBar: icon-only propagation ─────────────────────────────────────────

describe('StatusBar :: icon-only propagation', () => {
  it('renders full (non-icon-only) segments by default on a wide viewport', () => {
    render(<StatusBar />);
    for (const id of SEGMENT_TESTIDS) {
      expect(iconOnlyOf(id)).toBe('false');
    }
  });

  it('forces every segment to icon-only when compact is set', () => {
    render(<StatusBar compact />);
    for (const id of SEGMENT_TESTIDS) {
      expect(iconOnlyOf(id)).toBe('true');
    }
  });

  it('forces icon-only when the persisted iconOnly preference is set', () => {
    act(() => setStatusBarPrefs({ iconOnly: true }));
    render(<StatusBar />);
    expect(iconOnlyOf('seg-connection')).toBe('true');
    expect(iconOnlyOf('seg-version')).toBe('true');
  });

  it('forces icon-only when the viewport is narrower than lg (max-width: 1023px)', () => {
    patchMatchMedia((q) => q.includes('1023'));
    render(<StatusBar />);
    for (const id of SEGMENT_TESTIDS) {
      expect(iconOnlyOf(id)).toBe('true');
    }
  });

  it('stays expanded on a wide viewport even when matchMedia is present', () => {
    patchMatchMedia(() => false);
    render(<StatusBar />);
    expect(iconOnlyOf('seg-connection')).toBe('false');
  });
});

// ── StatusBar: matchMedia safety (the hardened branch) ───────────────────────

describe('StatusBar :: matchMedia safety', () => {
  it('renders without throwing when window.matchMedia is unavailable', () => {
    // jsdom has no matchMedia by default; removeMatchMedia() in beforeEach
    // guarantees it. The pre-hardening code called it unguarded and threw.
    expect(() => render(<StatusBar />)).not.toThrow();
    expect(screen.getByRole('status')).toBeInTheDocument();
    // No matchMedia ⇒ treated as "not narrow" ⇒ expanded segments.
    expect(iconOnlyOf('seg-connection')).toBe('false');
  });
});

// ── useStatusBarPrefs + setStatusBarPrefs ────────────────────────────────────

describe('useStatusBarPrefs / setStatusBarPrefs', () => {
  it('exposes the default preferences before any override', () => {
    const { result } = renderHook(() => useStatusBarPrefs());
    expect(result.current).toEqual<StatusBarPrefs>({
      enabled: true,
      iconOnly: false,
    });
  });

  it('reactively reflects a setStatusBarPrefs update in subscribed readers', () => {
    const { result } = renderHook(() => useStatusBarPrefs());
    expect(result.current.iconOnly).toBe(false);
    act(() => setStatusBarPrefs({ iconOnly: true }));
    expect(result.current.iconOnly).toBe(true);
    // Untouched keys are preserved.
    expect(result.current.enabled).toBe(true);
  });

  it('applies partial updates as a shallow merge across successive calls', () => {
    const { result } = renderHook(() => useStatusBarPrefs());
    act(() => setStatusBarPrefs({ iconOnly: true }));
    act(() => setStatusBarPrefs({ enabled: false }));
    expect(result.current).toEqual<StatusBarPrefs>({
      enabled: false,
      iconOnly: true,
    });
  });

  it('persists the merged preferences to localStorage under the stable key', () => {
    act(() => setStatusBarPrefs({ iconOnly: true }));
    const raw = window.localStorage.getItem(STORAGE_KEY);
    expect(raw).not.toBeNull();
    expect(JSON.parse(raw as string)).toEqual({ enabled: true, iconOnly: true });
  });

  it('still updates in-memory state when localStorage.setItem throws', () => {
    const setItem = vi
      .spyOn(Storage.prototype, 'setItem')
      .mockImplementation(() => {
        throw new Error('QuotaExceeded');
      });
    const { result } = renderHook(() => useStatusBarPrefs());
    expect(() => act(() => setStatusBarPrefs({ iconOnly: true }))).not.toThrow();
    expect(setItem).toHaveBeenCalled();
    expect(result.current.iconOnly).toBe(true);
  });
});

// ── Cross-tab storage sync + readPrefs parsing branches ──────────────────────

describe('cross-tab storage sync', () => {
  it('mirrors another tab\'s valid preference write on a matching storage event', () => {
    const { result } = renderHook(() => useStatusBarPrefs());
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ enabled: false, iconOnly: true }),
    );
    act(() => fireStorage(STORAGE_KEY));
    expect(result.current).toEqual<StatusBarPrefs>({
      enabled: false,
      iconOnly: true,
    });
  });

  it('falls back to defaults when the persisted JSON is malformed', () => {
    const { result } = renderHook(() => useStatusBarPrefs());
    act(() => setStatusBarPrefs({ enabled: false, iconOnly: true }));
    expect(result.current.enabled).toBe(false);
    // Corrupt the stored blob, then simulate the cross-tab notification.
    window.localStorage.setItem(STORAGE_KEY, '{ this is not json');
    act(() => fireStorage(STORAGE_KEY));
    expect(result.current).toEqual<StatusBarPrefs>({
      enabled: true,
      iconOnly: false,
    });
  });

  it('ignores non-boolean fields and keeps defaults for them', () => {
    const { result } = renderHook(() => useStatusBarPrefs());
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ enabled: 'yes', iconOnly: 1 }),
    );
    act(() => fireStorage(STORAGE_KEY));
    expect(result.current).toEqual<StatusBarPrefs>({
      enabled: true,
      iconOnly: false,
    });
  });

  it('ignores storage events for unrelated keys', () => {
    const { result } = renderHook(() => useStatusBarPrefs());
    act(() => setStatusBarPrefs({ iconOnly: true }));
    // A write under a different key must not disturb our prefs.
    window.localStorage.setItem('some-other-key', 'whatever');
    act(() => fireStorage('some-other-key'));
    expect(result.current.iconOnly).toBe(true);
    expect(result.current.enabled).toBe(true);
  });
});
