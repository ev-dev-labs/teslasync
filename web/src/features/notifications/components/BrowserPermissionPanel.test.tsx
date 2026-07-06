/**
 * BrowserPermissionPanel tests.
 *
 * The panel is a pure presentational control surface for the browser
 * Notification permission lifecycle. It has four mutually-exclusive visual
 * states driven by `notificationsSupported` + `permission`, plus a pair of
 * per-event delivery toggles that only exist once permission is granted.
 *
 * Coverage (behaviour, not smoke):
 *   1. unsupported  → warning callout, no enable button / badge / toggles.
 *   2. default      → "Enable" button; clicking invokes requestPermission().
 *   3. granted      → "Enabled" badge + Alerts/Export toggles reflecting prefs.
 *   4. denied       → "blocked" callout, no interactive controls.
 *   5. toggles      → onChange dispatches a functional prefs updater that
 *                     flips exactly the toggled key and leaves siblings intact.
 *   6. hardening    → a rejected requestPermission() never leaks an unhandled
 *                     rejection; corrupt (null/undefined) prefs render the
 *                     switches as unchecked rather than aria-checked-absent.
 *   7. a11y         → heading, accessible switch names, className passthrough.
 *
 * There is no network here — the component receives its permission state and
 * mutators purely via props — so no MSW/QueryClient scaffolding is needed.
 */
import { describe, expect, it, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import '../../../i18n';

import { BrowserPermissionPanel } from './BrowserPermissionPanel';
import type { WebPushPreferences } from '@/hooks/useNotificationListener';

type PanelProps = React.ComponentProps<typeof BrowserPermissionPanel>;

function renderPanel(overrides: Partial<PanelProps> = {}) {
  const requestPermission =
    overrides.requestPermission ??
    vi.fn<() => Promise<NotificationPermission>>().mockResolvedValue('granted');
  const setPushPrefs = overrides.setPushPrefs ?? vi.fn();
  const props: PanelProps = {
    permission: 'default',
    notificationsSupported: true,
    pushPrefs: { alerts: true, exportStatus: true },
    ...overrides,
    requestPermission,
    setPushPrefs,
  };
  const utils = render(<BrowserPermissionPanel {...props} />);
  return { ...utils, requestPermission, setPushPrefs };
}

afterEach(() => cleanup());

describe('BrowserPermissionPanel', () => {
  // Header renders in every state — the panel must never be a blank surface.
  it('always renders the titled panel header', () => {
    renderPanel({ notificationsSupported: false });
    expect(
      screen.getByRole('heading', { name: /^browser notifications$/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/get notified when the app tab is in the background/i),
    ).toBeInTheDocument();
  });

  // State 1 — unsupported browser: only the warning callout, no affordances.
  it('shows the unsupported callout and hides all controls when notifications are unsupported', () => {
    renderPanel({ notificationsSupported: false, permission: 'granted' });
    expect(
      screen.getByText(/browser notifications are not supported in this browser/i),
    ).toBeInTheDocument();
    // Even though permission is 'granted', an unsupported browser must not
    // expose the delivery toggles or the enabled badge.
    expect(screen.queryByRole('switch')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /enable browser notifications/i })).toBeNull();
    expect(screen.queryByText(/^enabled$/i)).toBeNull();
  });

  // State 2 — default: the enable button is the sole control and wiring it up
  // triggers the injected requestPermission() exactly once.
  it('renders the enable button in the default state and calls requestPermission on click', () => {
    const requestPermission = vi
      .fn<() => Promise<NotificationPermission>>()
      .mockResolvedValue('granted');
    renderPanel({ permission: 'default', requestPermission });
    const btn = screen.getByRole('button', { name: /enable browser notifications/i });
    expect(btn).toBeInTheDocument();
    // No toggles / badge until permission is granted.
    expect(screen.queryByRole('switch')).toBeNull();
    expect(screen.queryByText(/^enabled$/i)).toBeNull();
    fireEvent.click(btn);
    expect(requestPermission).toHaveBeenCalledTimes(1);
  });

  // State 3 — granted: the enabled badge plus both delivery toggles appear,
  // each reflecting the corresponding pushPrefs flag via aria-checked.
  it('shows the enabled badge and toggles reflecting pushPrefs when granted', () => {
    renderPanel({
      permission: 'granted',
      pushPrefs: { alerts: true, exportStatus: false },
    });
    expect(screen.getByText(/^enabled$/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /enable browser notifications/i })).toBeNull();

    const alerts = screen.getByRole('switch', { name: 'Alerts' });
    const exports = screen.getByRole('switch', { name: 'Export completions' });
    expect(alerts).toHaveAttribute('aria-checked', 'true');
    expect(exports).toHaveAttribute('aria-checked', 'false');
  });

  // State 4 — denied: the blocked callout replaces the button; nothing else
  // is interactive so the user is pushed to browser settings.
  it('shows the blocked callout and no controls when permission is denied', () => {
    renderPanel({ permission: 'denied' });
    expect(
      screen.getByText(/notifications are blocked\. enable in your browser settings/i),
    ).toBeInTheDocument();
    expect(screen.queryByRole('switch')).toBeNull();
    expect(screen.queryByRole('button', { name: /enable browser notifications/i })).toBeNull();
    expect(screen.queryByText(/^enabled$/i)).toBeNull();
  });

  // Toggle contract — the Alerts switch dispatches a *functional* updater that
  // flips only `alerts` and preserves `exportStatus`.
  it('dispatches a functional updater that flips alerts and preserves other prefs', () => {
    const setPushPrefs = vi.fn();
    renderPanel({
      permission: 'granted',
      pushPrefs: { alerts: false, exportStatus: true },
      setPushPrefs,
    });
    fireEvent.click(screen.getByRole('switch', { name: 'Alerts' }));
    expect(setPushPrefs).toHaveBeenCalledTimes(1);
    const updater = setPushPrefs.mock.calls[0][0] as (
      prev: WebPushPreferences,
    ) => WebPushPreferences;
    expect(typeof updater).toBe('function');
    expect(updater({ alerts: false, exportStatus: true })).toEqual({
      alerts: true,
      exportStatus: true,
    });
  });

  // Toggle contract — the Export switch is independent of Alerts and flips
  // only its own key.
  it('dispatches a functional updater that flips exportStatus independently', () => {
    const setPushPrefs = vi.fn();
    renderPanel({
      permission: 'granted',
      pushPrefs: { alerts: true, exportStatus: true },
      setPushPrefs,
    });
    fireEvent.click(screen.getByRole('switch', { name: 'Export completions' }));
    expect(setPushPrefs).toHaveBeenCalledTimes(1);
    const updater = setPushPrefs.mock.calls[0][0] as (
      prev: WebPushPreferences,
    ) => WebPushPreferences;
    expect(updater({ alerts: true, exportStatus: true })).toEqual({
      alerts: true,
      exportStatus: false,
    });
  });

  // Hardening — a browser that rejects the permission request (policy block,
  // dismissed prompt) must not surface an unhandled promise rejection. The
  // panel catches it; the button stays available for retry.
  it('swallows a rejected requestPermission() without an unhandled rejection', async () => {
    const onUnhandled = vi.fn();
    process.on('unhandledRejection', onUnhandled);
    try {
      const requestPermission = vi
        .fn<() => Promise<NotificationPermission>>()
        .mockRejectedValue(new Error('permission prompt failed'));
      renderPanel({ permission: 'default', requestPermission });
      fireEvent.click(
        screen.getByRole('button', { name: /enable browser notifications/i }),
      );
      // Flush the rejected microtask + a macrotask so any unhandled rejection
      // would have been reported by the runtime by now.
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(requestPermission).toHaveBeenCalledTimes(1);
      expect(onUnhandled).not.toHaveBeenCalled();
    } finally {
      process.off('unhandledRejection', onUnhandled);
    }
  });

  // Hardening — corrupt persisted prefs (a null/undefined flag from a bad
  // localStorage merge) must render the switch as explicitly unchecked, never
  // as aria-checked-absent which breaks role="switch" semantics.
  it('renders switches as unchecked when pushPrefs flags are missing', () => {
    renderPanel({
      permission: 'granted',
      pushPrefs: {
        alerts: undefined,
        exportStatus: null,
      } as unknown as WebPushPreferences,
    });
    expect(screen.getByRole('switch', { name: 'Alerts' })).toHaveAttribute(
      'aria-checked',
      'false',
    );
    expect(screen.getByRole('switch', { name: 'Export completions' })).toHaveAttribute(
      'aria-checked',
      'false',
    );
  });

  // a11y / API — the caller-supplied className lands on the panel root and the
  // stable tour anchor is preserved so onboarding/tooltips keep targeting it.
  it('forwards className and preserves the data-tour anchor on the panel root', () => {
    const { container } = renderPanel({ className: 'xl:col-span-2' });
    const panel = container.querySelector('[data-tour="settings-notifications"]');
    expect(panel).not.toBeNull();
    expect(panel).toHaveClass('xl:col-span-2');
  });
});
