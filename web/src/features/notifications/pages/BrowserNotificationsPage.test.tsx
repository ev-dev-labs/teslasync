/**
 * BrowserNotificationsPage — orchestration + hardening coverage.
 *
 * The page exposes a single default export. It is a thin orchestrator whose one
 * job is to LIFT the browser-permission state (`useWebPush`) and the per-event
 * push preferences (`useNotificationListener`) up to the page, then fan the
 * exact same values into two independent children so the KPI band and the
 * permission panel never desync after a toggle. It also owns two self-contained
 * panels (tab signals, sounds) and the page chrome.
 *
 * This suite drives that orchestration by mocking the two source-of-truth hooks
 * and the four section components (each reflected as a prop-mirroring spy), plus
 * i18n and the motion wrapper. The real `PageContainer` (heading, subtitle,
 * copy-link button, error boundary) renders so the page chrome is exercised for
 * real. Network is never touched.
 *
 * Facets covered:
 *   - scaffolding/a11y: page heading + subtitle, the labelled controls region,
 *     the copy-link affordance, and every section mounts.
 *   - document title via usePageTitle.
 *   - single-source-of-truth wiring: the same `permission` + `notificationsSupported`
 *     land in BOTH the KPI band and the permission panel (granted / denied /
 *     default, and the unsupported branch).
 *   - push-preference fan-out: `pushPrefs` reaches both children unchanged.
 *   - interaction: the panel's `requestPermission` and `setPushPrefs` callbacks
 *     are the lifted callbacks, and the functional-updater contract is preserved.
 *   - layout wiring: the column-span class is forwarded to the permission panel.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import type { WebPushPreferences } from '@/hooks/useNotificationListener';

// ── i18n stub: return the fallback string, interpolating {{var}} options ──
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallbackOrOpts?: unknown, opts?: Record<string, unknown>) => {
      if (typeof fallbackOrOpts === 'string') {
        if (opts && typeof opts === 'object') {
          let s = fallbackOrOpts;
          for (const [k, v] of Object.entries(opts)) s = s.replace(`{{${k}}}`, String(v));
          return s;
        }
        return fallbackOrOpts;
      }
      return _key;
    },
    i18n: { language: 'en', changeLanguage: vi.fn() },
  }),
  Trans: ({ children }: { children?: ReactNode }) => <>{children}</>,
  initReactI18next: { type: '3rdParty', init: () => undefined },
}));

// ── motion: render children inline (no animation frames in jsdom). The real
//    `ToastProvider` renders below (not mocked) and needs both `motion` (for
//    MetricBar-style fills elsewhere in the tree) and `AnimatePresence` (for
//    its toast-stack transitions) — both now come from this barrel rather
//    than 'framer-motion' directly, so the mock must supply them too. ──
vi.mock('@/components/motion', () => ({
  FadeIn: ({ children }: { children?: ReactNode }) => <>{children}</>,
  motion: new Proxy(
    {},
    {
      get: () => (props: Record<string, unknown>) => {
        const Component = (props.as as string) ?? 'div';
        const { children, ...rest } = props as { children?: unknown } & Record<string, unknown>;
        return <Component {...(rest as Record<string, unknown>)}>{children as ReactNode}</Component>;
      },
    },
  ),
  AnimatePresence: ({ children }: { children?: ReactNode }) => <>{children}</>,
}));

// ── source-of-truth hooks ──
vi.mock('@/hooks/useWebPush', () => ({ useWebPush: vi.fn() }));
vi.mock('@/hooks/useNotificationListener', () => ({ useNotificationListener: vi.fn() }));

// ── section spies: reflect the props the page hands down as data-attributes ──
type KpisProps = {
  permission: NotificationPermission;
  notificationsSupported: boolean;
  pushPrefs: WebPushPreferences;
};
vi.mock('../components/BrowserNotificationsKpis', () => ({
  BrowserNotificationsKpis: ({ permission, notificationsSupported, pushPrefs }: KpisProps) => (
    <div
      data-testid="bn-kpis"
      data-permission={permission}
      data-supported={String(notificationsSupported)}
      data-alerts={String(pushPrefs.alerts)}
      data-export={String(pushPrefs.exportStatus)}
    />
  ),
}));

type PermissionPanelProps = {
  className?: string;
  permission: NotificationPermission;
  requestPermission: () => Promise<NotificationPermission>;
  notificationsSupported: boolean;
  pushPrefs: WebPushPreferences;
  setPushPrefs: (
    next: WebPushPreferences | ((prev: WebPushPreferences) => WebPushPreferences),
  ) => void;
};
vi.mock('../components/BrowserPermissionPanel', () => ({
  BrowserPermissionPanel: ({
    className,
    permission,
    requestPermission,
    notificationsSupported,
    pushPrefs,
    setPushPrefs,
  }: PermissionPanelProps) => (
    <div
      data-testid="bn-permission-panel"
      data-classname={className ?? ''}
      data-permission={permission}
      data-supported={String(notificationsSupported)}
      data-alerts={String(pushPrefs.alerts)}
      data-export={String(pushPrefs.exportStatus)}
    >
      <button type="button" aria-label="request permission" onClick={() => void requestPermission()}>
        request
      </button>
      <button
        type="button"
        aria-label="toggle alerts"
        onClick={() => setPushPrefs((prev) => ({ ...prev, alerts: !prev.alerts }))}
      >
        toggle
      </button>
    </div>
  ),
}));

vi.mock('../components/BrowserTabSignalsPanel', () => ({
  BrowserTabSignalsPanel: () => <div data-testid="bn-tab-signals" />,
}));

vi.mock('../components/NotificationSoundsPanel', () => ({
  NotificationSoundsPanel: () => <div data-testid="bn-sounds" />,
}));

import { useWebPush } from '@/hooks/useWebPush';
import { useNotificationListener } from '@/hooks/useNotificationListener';
import { ToastProvider } from '@/components/feedback/Toast';
import BrowserNotificationsPage from './BrowserNotificationsPage';

const mockWebPush = useWebPush as unknown as ReturnType<typeof vi.fn>;
const mockListener = useNotificationListener as unknown as ReturnType<typeof vi.fn>;

let requestPermissionMock: ReturnType<typeof vi.fn>;
let setPrefsMock: ReturnType<typeof vi.fn>;

interface ConfigureOpts {
  permission?: NotificationPermission;
  isSupported?: boolean;
  prefs?: WebPushPreferences;
}

function configure(opts: ConfigureOpts = {}) {
  const permission = opts.permission ?? 'granted';
  const isSupported = opts.isSupported ?? true;
  const prefs = opts.prefs ?? { alerts: true, exportStatus: true };
  mockWebPush.mockReturnValue({
    permission,
    requestPermission: requestPermissionMock,
    isSupported,
  });
  mockListener.mockReturnValue({ prefs, setPrefs: setPrefsMock });
}

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <MemoryRouter>
      <QueryClientProvider client={client}>
        <ToastProvider>
          <BrowserNotificationsPage />
        </ToastProvider>
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

const kpis = () => screen.getByTestId('bn-kpis');
const panel = () => screen.getByTestId('bn-permission-panel');

beforeEach(() => {
  mockWebPush.mockReset();
  mockListener.mockReset();
  requestPermissionMock = vi.fn().mockResolvedValue('granted');
  setPrefsMock = vi.fn();
  configure();
});

describe('BrowserNotificationsPage — scaffolding + a11y', () => {
  it('renders the page chrome, the labelled controls region, and every section', () => {
    renderPage();

    expect(
      screen.getByRole('heading', { level: 1, name: 'Browser notifications' }),
    ).toBeInTheDocument();
    expect(
      screen.getByText('Native browser push notifications when alerts fire.'),
    ).toBeInTheDocument();

    expect(
      screen.getByRole('region', { name: 'Notification delivery controls' }),
    ).toBeInTheDocument();

    for (const id of ['bn-kpis', 'bn-permission-panel', 'bn-tab-signals', 'bn-sounds']) {
      expect(screen.getByTestId(id)).toBeInTheDocument();
    }
  });

  it('exposes the copy-link affordance from the page chrome', () => {
    renderPage();
    expect(
      screen.getByRole('button', { name: 'Copy link to this view' }),
    ).toBeInTheDocument();
  });

  it('sets the document title via usePageTitle', () => {
    renderPage();
    expect(document.title).toContain('Browser notifications');
  });
});

describe('BrowserNotificationsPage — single source of truth', () => {
  it('feeds the granted permission + supported flag to BOTH children identically', () => {
    configure({ permission: 'granted', isSupported: true });
    renderPage();

    expect(kpis().getAttribute('data-permission')).toBe('granted');
    expect(panel().getAttribute('data-permission')).toBe('granted');
    // The whole point of lifting: both children read the exact same value.
    expect(kpis().getAttribute('data-permission')).toBe(panel().getAttribute('data-permission'));

    expect(kpis().getAttribute('data-supported')).toBe('true');
    expect(panel().getAttribute('data-supported')).toBe('true');
  });

  it('reflects the denied permission in both children', () => {
    configure({ permission: 'denied' });
    renderPage();

    expect(kpis().getAttribute('data-permission')).toBe('denied');
    expect(panel().getAttribute('data-permission')).toBe('denied');
  });

  it('reflects the default (not-yet-asked) permission in both children', () => {
    configure({ permission: 'default' });
    renderPage();

    expect(kpis().getAttribute('data-permission')).toBe('default');
    expect(panel().getAttribute('data-permission')).toBe('default');
  });

  it('propagates the unsupported-browser branch to both children', () => {
    configure({ isSupported: false });
    renderPage();

    expect(kpis().getAttribute('data-supported')).toBe('false');
    expect(panel().getAttribute('data-supported')).toBe('false');
  });

  it('fans the push preferences out to both children unchanged', () => {
    configure({ prefs: { alerts: false, exportStatus: true } });
    renderPage();

    expect(kpis().getAttribute('data-alerts')).toBe('false');
    expect(kpis().getAttribute('data-export')).toBe('true');
    expect(panel().getAttribute('data-alerts')).toBe('false');
    expect(panel().getAttribute('data-export')).toBe('true');
  });
});

describe('BrowserNotificationsPage — lifted callbacks', () => {
  it('forwards the lifted requestPermission callback to the permission panel', () => {
    renderPage();

    fireEvent.click(screen.getByRole('button', { name: 'request permission' }));

    expect(requestPermissionMock).toHaveBeenCalledTimes(1);
  });

  it('forwards setPushPrefs and preserves the functional-updater contract', () => {
    renderPage();

    fireEvent.click(screen.getByRole('button', { name: 'toggle alerts' }));

    expect(setPrefsMock).toHaveBeenCalledTimes(1);
    const updater = setPrefsMock.mock.calls[0][0] as (
      prev: WebPushPreferences,
    ) => WebPushPreferences;
    expect(typeof updater).toBe('function');
    // The page must pass a merge-preserving updater, not a bare replacement:
    // flipping `alerts` must leave `exportStatus` untouched.
    expect(updater({ alerts: true, exportStatus: true })).toEqual({
      alerts: false,
      exportStatus: true,
    });
  });
});

describe('BrowserNotificationsPage — layout wiring', () => {
  it('hands the column-span layout class to the permission panel', () => {
    renderPage();
    expect(panel().getAttribute('data-classname')).toContain('xl:col-span-2');
  });
});
