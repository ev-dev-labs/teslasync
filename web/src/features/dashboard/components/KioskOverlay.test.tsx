/**
 * KioskOverlay tests.
 *
 * KioskOverlay is the full-screen chrome that sits above a dashboard while
 * kiosk mode is active. It is pure presentation over its props (no network,
 * no Router, no QueryClient) so the tests drive every branch of its render
 * tree plus the two window-level effects:
 *
 *   - Dim wallpaper: only mounts when `isDimmed`, and paints a black layer at
 *     `1 - dimLevel` opacity. The hardened source clamps that into [0,1] and
 *     falls back to the default brightness for a NaN/out-of-range `dimLevel`
 *     so it can never emit invalid CSS opacity (regression covered below).
 *   - Cursor-hide layer: only mounts when `isCursorHidden`; injects a
 *     `cursor: none` <style> scoped to `.kiosk-root`, marked aria-hidden.
 *   - Clock: only mounts when `config.showClock`; renders the locale time +
 *     date and re-renders once per second; honours `clockPosition`.
 *   - Rotation dots: only mount when there is >1 dashboard AND rotation is on;
 *     one dot per dashboard with the active index widened; the group is
 *     labelled "Dashboard X of Y" for assistive tech.
 *   - Exit control: always mounted + accessibly named; fires `onExit` on
 *     click; the hint fades in on mouse/touch interaction and back out after
 *     3s; keyboard focus reveals it via `focus-within` (WCAG 2.4.7).
 *
 * i18n is stubbed with a passthrough `t(key, default, opts)` that also
 * interpolates `{{…}}` placeholders, matching the sibling DataFreshness /
 * DashboardSettingsModal convention. `useDateFormat` is mocked with
 * deterministic formatters so clock assertions don't depend on Intl output.
 * Fake timers (with a pinned system clock) mirror the DataFreshness test so
 * the clock tick and the exit-hint timeout are fully controlled.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react';

import { KioskOverlay } from './KioskOverlay';
import { DEFAULT_KIOSK_CONFIG, type KioskConfig } from '../hooks/useKioskMode';

// Passthrough i18n — returns the English default and interpolates any
// `{{name}}` tokens from the options bag so accessible-name assertions are
// deterministic without the i18n bootstrap.
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback?: string, opts?: Record<string, unknown>) => {
      const base = typeof fallback === 'string' ? fallback : _key;
      if (!opts) return base;
      return Object.entries(opts).reduce(
        (out, [k, v]) => out.replace(`{{${k}}}`, String(v)),
        base,
      );
    },
    i18n: { language: 'en', changeLanguage: () => Promise.resolve() },
  }),
}));

// Deterministic date formatters — the clock prints `T:<iso>` / `D:<iso>` so a
// one-second tick produces an observably different string, and there is no
// dependency on the environment locale/timezone.
vi.mock('@/hooks/useDateFormat', () => ({
  useDateFormat: () => ({
    formatTime: (d: string | Date | null | undefined) =>
      `T:${d instanceof Date ? d.toISOString() : String(d)}`,
    formatDateWithDay: (d: string | Date | null | undefined) =>
      `D:${d instanceof Date ? d.toISOString() : String(d)}`,
  }),
}));

function makeConfig(overrides: Partial<KioskConfig> = {}): KioskConfig {
  return { ...DEFAULT_KIOSK_CONFIG, ...overrides };
}

type Props = React.ComponentProps<typeof KioskOverlay>;

function renderOverlay(overrides: Partial<Props> = {}) {
  const onExit = vi.fn();
  const utils = render(
    <KioskOverlay
      config={makeConfig()}
      isDimmed={false}
      isCursorHidden={false}
      dashboardCount={1}
      currentIndex={0}
      onExit={onExit}
      {...overrides}
    />,
  );
  return { ...utils, onExit };
}

function exitButton() {
  return screen.getByRole('button', { name: 'Exit kiosk mode' });
}
function exitWrapper() {
  return exitButton().parentElement as HTMLElement;
}

describe('KioskOverlay', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2024-01-01T00:00:00.000Z'));
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  describe('exit control', () => {
    it('always renders an accessibly named exit button that calls onExit on click', () => {
      const { onExit } = renderOverlay();

      const btn = exitButton();
      expect(btn).toBeInTheDocument();
      expect(screen.getByText('Exit Kiosk')).toBeInTheDocument();

      fireEvent.click(btn);
      expect(onExit).toHaveBeenCalledTimes(1);
    });

    it('hides the exit hint initially, reveals it on pointer/touch interaction, and auto-hides after 3s', () => {
      renderOverlay();
      expect(exitWrapper()).toHaveClass('opacity-0');

      // Mouse movement anywhere on the window reveals the affordance.
      act(() => {
        window.dispatchEvent(new MouseEvent('mousemove'));
      });
      expect(exitWrapper()).toHaveClass('opacity-100');
      expect(exitWrapper()).not.toHaveClass('opacity-0');

      // …and it fades back out after the 3s idle timeout.
      act(() => {
        vi.advanceTimersByTime(3000);
      });
      expect(exitWrapper()).toHaveClass('opacity-0');

      // Touch interaction reveals it again (second listener branch).
      act(() => {
        window.dispatchEvent(new Event('touchstart'));
      });
      expect(exitWrapper()).toHaveClass('opacity-100');
    });

    it('is keyboard operable and reveals itself on focus (focus-within)', () => {
      renderOverlay();

      // Keyboard reveal is wired declaratively so tabbing to the control
      // brings it above the fold with a visible focus ring.
      expect(exitWrapper()).toHaveClass('focus-within:opacity-100');

      const btn = exitButton();
      btn.focus();
      expect(document.activeElement).toBe(btn);
    });
  });

  describe('dim wallpaper', () => {
    it('is not rendered when the screen is not dimmed', () => {
      renderOverlay({ isDimmed: false });
      expect(screen.queryByTestId('kiosk-dim-overlay')).toBeNull();
    });

    it('paints a black layer at (1 - dimLevel) opacity, hidden from assistive tech', () => {
      renderOverlay({ isDimmed: true, config: makeConfig({ dimLevel: 0.25 }) });

      const overlay = screen.getByTestId('kiosk-dim-overlay');
      expect(overlay).toHaveAttribute('aria-hidden', 'true');
      expect(overlay.style.opacity).toBe('0.75');
    });

    // Regression: a legacy/partial config could carry a NaN or out-of-range
    // dimLevel; without the clamp/fallback the overlay would emit invalid CSS
    // opacity ('NaN' / '-1' / '2') and the dimming would break.
    it.each([
      ['NaN falls back to the default brightness', Number.NaN, '0.5'],
      ['over-bright (>1) clamps the darkness to 0', 2, '0'],
      ['negative (<0) clamps the darkness to 1', -1, '1'],
    ])('null-safes a malformed dimLevel: %s', (_label, dimLevel, expected) => {
      renderOverlay({ isDimmed: true, config: makeConfig({ dimLevel }) });
      expect(screen.getByTestId('kiosk-dim-overlay').style.opacity).toBe(expected);
    });
  });

  describe('cursor hiding', () => {
    it('is not rendered when the cursor is not hidden', () => {
      renderOverlay({ isCursorHidden: false });
      expect(screen.queryByTestId('kiosk-cursor-style')).toBeNull();
    });

    it('injects a cursor:none style scoped to kiosk presentation, marked aria-hidden', () => {
      renderOverlay({ isCursorHidden: true });

      const layer = screen.getByTestId('kiosk-cursor-style');
      expect(layer).toHaveAttribute('aria-hidden', 'true');

      const style = layer.querySelector('style');
      expect(style?.textContent).toContain('[data-presentation-mode="kiosk"]');
      expect(style?.textContent).toContain('cursor: none');
    });
  });

  describe('clock', () => {
    it('is not rendered when showClock is off, and ticking the timer surfaces nothing', () => {
      renderOverlay({ config: makeConfig({ showClock: false }) });
      expect(screen.queryByTestId('kiosk-clock')).toBeNull();

      act(() => {
        vi.advanceTimersByTime(5000);
      });
      expect(screen.queryByTestId('kiosk-clock')).toBeNull();
    });

    it('renders the formatted time and date when showClock is on', () => {
      renderOverlay({ config: makeConfig({ showClock: true }) });

      const clock = screen.getByTestId('kiosk-clock');
      expect(clock).toHaveTextContent('T:2024-01-01T00:00:00.000Z');
      expect(clock).toHaveTextContent('D:2024-01-01T00:00:00.000Z');
    });

    it('re-renders the current time once per second', () => {
      renderOverlay({ config: makeConfig({ showClock: true }) });
      const before = screen.getByTestId('kiosk-clock').textContent;

      act(() => {
        vi.advanceTimersByTime(1000);
      });

      const after = screen.getByTestId('kiosk-clock').textContent;
      expect(after).not.toBe(before);
      expect(after).toContain('T:2024-01-01T00:00:01.000Z');
    });

    it.each([
      ['top-left', 'top-4', 'left-4'],
      ['top-right', 'top-4', 'right-4'],
      ['bottom-left', 'bottom-4', 'left-4'],
      ['bottom-right', 'bottom-4', 'right-4'],
    ] as const)('anchors the clock to the %s corner', (clockPosition, v, h) => {
      renderOverlay({ config: makeConfig({ showClock: true, clockPosition }) });
      const clock = screen.getByTestId('kiosk-clock');
      expect(clock).toHaveClass(v);
      expect(clock).toHaveClass(h);
    });
  });

  describe('rotation indicator', () => {
    it('renders one dot per dashboard with the active index widened and a labelled group', () => {
      renderOverlay({
        dashboardCount: 4,
        currentIndex: 2,
        config: makeConfig({ rotateInterval: 30 }),
      });

      const group = screen.getByRole('group', { name: 'Dashboard 3 of 4' });
      expect(group).toBe(screen.getByTestId('kiosk-rotation-dots'));
      expect(group.children).toHaveLength(4);

      // Active dot is the wide pill; the rest are small.
      expect(group.children[2]).toHaveClass('w-6');
      expect(group.children[0]).toHaveClass('w-1.5');
      expect(group.children[2]).not.toHaveClass('w-1.5');
    });

    it('is hidden when there is only a single dashboard', () => {
      renderOverlay({ dashboardCount: 1, config: makeConfig({ rotateInterval: 30 }) });
      expect(screen.queryByTestId('kiosk-rotation-dots')).toBeNull();
    });

    it('is hidden when rotation is disabled even with multiple dashboards', () => {
      renderOverlay({ dashboardCount: 5, config: makeConfig({ rotateInterval: 0 }) });
      expect(screen.queryByTestId('kiosk-rotation-dots')).toBeNull();
    });
  });
});
