import {
  act,
  cleanup,
  renderHook,
} from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import {
  BrowserRouter,
  useLocation,
  useSearchParams,
} from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  copyPresentationLink,
  getPresentationMode,
  setPresentationRotation,
  usePresentationMode,
} from './usePresentationMode';

let fullscreenElement: Element | null;
let requestFullscreen: ReturnType<typeof vi.fn>;
let exitFullscreen: ReturnType<typeof vi.fn>;

function browserRouterWrapper({ children }: { children: ReactNode }) {
  return createElement(BrowserRouter, null, children);
}

beforeEach(() => {
  vi.useRealTimers();
  window.localStorage.clear();
  window.history.replaceState({}, '', '/battery');
  fullscreenElement = null;
  requestFullscreen = vi.fn().mockResolvedValue(undefined);
  exitFullscreen = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(document, 'fullscreenElement', {
    configurable: true,
    get: () => fullscreenElement,
  });
  Object.defineProperty(document.documentElement, 'requestFullscreen', {
    configurable: true,
    value: requestFullscreen,
  });
  Object.defineProperty(document, 'exitFullscreen', {
    configurable: true,
    value: exitFullscreen,
  });
  setPresentationRotation(null);
});

afterEach(() => {
  cleanup();
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
  setPresentationRotation(null);
});

describe('usePresentationMode', () => {
  it('uses canonical, shareable URL state for report mode', () => {
    window.history.replaceState({}, '', '/battery?vehicle_id=7');
    const { result } = renderHook(() => usePresentationMode(), {
      wrapper: browserRouterWrapper,
    });

    act(() => result.current.enterReport());

    expect(result.current.mode).toBe('report');
    const params = new URLSearchParams(window.location.search);
    expect(params.get('presentation')).toBe('report');
    expect(params.get('vehicle_id')).toBe('7');
  });

  it('keeps presentation state synchronized with later Router search updates', () => {
    window.history.replaceState({}, '', '/battery?vehicle_id=7');
    const { result } = renderHook(
      () => {
        const presentation = usePresentationMode();
        const location = useLocation();
        const [params, setParams] = useSearchParams();
        const setRange = (range: string) => {
          const next = new URLSearchParams(params);
          next.set('range', range);
          setParams(next, { replace: true });
        };
        return { presentation, location, setRange };
      },
      { wrapper: browserRouterWrapper },
    );

    act(() => result.current.presentation.enterReport());
    expect(
      new URLSearchParams(result.current.location.search).get('presentation'),
    ).toBe('report');

    act(() => result.current.setRange('30d'));
    let params = new URLSearchParams(result.current.location.search);
    expect(params.get('presentation')).toBe('report');
    expect(params.get('range')).toBe('30d');

    act(() => result.current.presentation.exitPresentation());
    expect(
      new URLSearchParams(result.current.location.search).get('presentation'),
    ).toBeNull();

    act(() => result.current.setRange('90d'));
    params = new URLSearchParams(result.current.location.search);
    expect(params.get('presentation')).toBeNull();
    expect(params.get('range')).toBe('90d');
  });

  it('enters kiosk even when fullscreen permission is denied', async () => {
    requestFullscreen.mockRejectedValueOnce(new Error('Not allowed'));
    const { result } = renderHook(() => usePresentationMode(), {
      wrapper: browserRouterWrapper,
    });

    await act(async () => {
      await result.current.enterKiosk();
    });

    expect(result.current.mode).toBe('kiosk');
    expect(requestFullscreen).toHaveBeenCalledTimes(1);
    expect(new URLSearchParams(window.location.search).get('presentation')).toBe(
      'kiosk',
    );
  });

  it('exits kiosk when the browser leaves fullscreen', async () => {
    fullscreenElement = document.documentElement;
    const { result } = renderHook(() => usePresentationMode(), {
      wrapper: browserRouterWrapper,
    });
    await act(async () => {
      await result.current.enterKiosk();
    });
    expect(result.current.isKiosk).toBe(true);

    fullscreenElement = null;
    act(() => document.dispatchEvent(new Event('fullscreenchange')));

    expect(result.current.mode).toBe('standard');
    expect(
      new URLSearchParams(window.location.search).get('presentation'),
    ).toBeNull();
  });

  it('applies persisted idle cursor and dimming settings', () => {
    vi.useFakeTimers();
    window.localStorage.setItem(
      'teslasync-kiosk-config',
      JSON.stringify({
        hideCursor: true,
        cursorTimeout: 1,
        dimAfter: 0.01,
        dimLevel: 0.2,
        showClock: false,
        clockPosition: 'top-left',
      }),
    );
    window.history.replaceState({}, '', '/battery?presentation=kiosk');
    const { result } = renderHook(() => usePresentationMode(), {
      wrapper: browserRouterWrapper,
    });

    expect(result.current.config.showClock).toBe(false);
    expect(result.current.config.clockPosition).toBe('top-left');
    act(() => vi.advanceTimersByTime(600));
    expect(result.current.isDimmed).toBe(true);
    act(() => vi.advanceTimersByTime(400));
    expect(result.current.isCursorHidden).toBe(true);

    act(() => window.dispatchEvent(new MouseEvent('mousemove')));
    expect(result.current.isDimmed).toBe(false);
    expect(result.current.isCursorHidden).toBe(false);
  });

  it('publishes dashboard rotation metadata to the shell', () => {
    const { result } = renderHook(() => usePresentationMode(), {
      wrapper: browserRouterWrapper,
    });

    act(() =>
      setPresentationRotation({
        dashboardCount: 3,
        currentIndex: 1,
        enabled: true,
      }),
    );

    expect(result.current.rotation).toEqual({
      dashboardCount: 3,
      currentIndex: 1,
      enabled: true,
    });
  });
});

describe('presentation URL compatibility', () => {
  it('recognizes the legacy kiosk query while emitting canonical report links', async () => {
    window.history.replaceState(
      {},
      '',
      '/battery?kiosk=true&vehicle_id=9',
    );
    expect(getPresentationMode()).toBe('kiosk');
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });

    await copyPresentationLink('report');

    const copied = new URL(writeText.mock.calls[0][0] as string);
    expect(copied.searchParams.get('presentation')).toBe('report');
    expect(copied.searchParams.get('kiosk')).toBeNull();
    expect(copied.searchParams.get('vehicle_id')).toBe('9');
  });
});
