import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import type { DataStateSource } from '@/api/dataState';
import type { AuditLogEntry, SecurityEvent } from '@/types/admin';
import type { WidgetProps } from './types';
import { PackBoundary } from './designPacks/PackBoundary';
import { PACK_APPEARANCES, PACK_IDS, type PackId } from './designPacks/types';
import AuditLogWidget from './AuditLogWidget';

type QueryFixture<T> = DataStateSource<T> & { refetch: ReturnType<typeof vi.fn> };
type SecurityRecord = Pick<SecurityEvent,
  'id' | 'createdAt' | 'locked' | 'sentryMode' | 'doorState' | 'guestMode' | 'valetModeEnabled'>;

const hooks = vi.hoisted(() => ({
  audit: vi.fn<() => QueryFixture<AuditLogEntry[] | null>>(),
  security: vi.fn<(vehicleId: string) => QueryFixture<SecurityRecord[] | null>>(),
  vehicles: vi.fn<() => QueryFixture<{ id: number }[] | null>>(),
}));

vi.mock('@/api/hooks/useAdmin', () => ({
  useAuditLogs: hooks.audit,
  useSecurityEvents: hooks.security,
}));
vi.mock('@/api/hooks/useVehicles', () => ({ useVehicles: hooks.vehicles }));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: unknown, options?: Record<string, unknown>) => {
      if (typeof fallback !== 'string') return key;
      return Object.entries(options ?? {}).reduce(
        (text, [name, value]) => text.replace(`{{${name}}}`, String(value)), fallback,
      );
    },
    i18n: { language: 'en', changeLanguage: vi.fn() },
  }),
  Trans: ({ children }: { children?: ReactNode }) => <>{children}</>,
  initReactI18next: { type: '3rdParty', init: () => undefined },
}));

const now = Date.parse('2026-11-09T12:00:00Z');
const timestamp = (minutesAgo: number) => new Date(now - minutesAgo * 60_000).toISOString();

function query<T>(data: T, overrides: Partial<Omit<QueryFixture<T>, 'data'>> = {}): QueryFixture<T> {
  return {
    data, error: null, isLoading: false, isFetching: false, isError: false,
    isStale: false, dataUpdatedAt: now, refetch: vi.fn(), ...overrides,
  };
}

function audit(id: string, overrides: Partial<AuditLogEntry> = {}): AuditLogEntry {
  return { id, action: 'user.login', resource: '', details: '', createdAt: timestamp(5), ...overrides };
}

function security(id: string, overrides: Partial<SecurityRecord> = {}): SecurityRecord {
  return {
    id, locked: null, sentryMode: null, doorState: null, guestMode: null,
    valetModeEnabled: null, createdAt: timestamp(10), ...overrides,
  };
}

function mount(packId: PackId, props: Partial<WidgetProps> = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const tree = (pack: PackId, nextProps: Partial<WidgetProps>) => (
    <MemoryRouter>
      <QueryClientProvider client={client}>
        <PackBoundary requestedPackId={pack}>
          <AuditLogWidget size={{ cols: 3, rows: 3 }} vehicleId={7} {...nextProps} />
        </PackBoundary>
      </QueryClientProvider>
    </MemoryRouter>
  );
  const view = render(tree(packId, props));
  return {
    ...view,
    update: (pack: PackId = packId, nextProps: Partial<WidgetProps> = props) => {
      view.rerender(tree(pack, nextProps));
    },
  };
}

async function expectPresentation(container: HTMLElement, packId: PackId) {
  expect(container.querySelector('[data-widget-pack]')).toHaveAttribute('data-widget-pack', packId);
  if (packId === 'classic') {
    expect(container.querySelector('[data-timeline-appearance]')).toBeNull();
  } else {
    await waitFor(() => expect(container.querySelector('[data-timeline-appearance]'))
      .toHaveAttribute('data-timeline-appearance', PACK_APPEARANCES[packId]));
  }
}

beforeEach(() => {
  vi.spyOn(Date, 'now').mockReturnValue(now);
  hooks.audit.mockReset().mockReturnValue(query([]));
  hooks.security.mockReset().mockReturnValue(query([]));
  hooks.vehicles.mockReset().mockReturnValue(query([{ id: 42 }]));
});
afterEach(() => vi.restoreAllMocks());

describe.each(PACK_IDS)('AuditLogWidget pack %s', (packId) => {
  it('preserves the classic merged feed, chronology, source details, unknown time and row cap', async () => {
    hooks.audit.mockReturnValue(query([
      audit('invalid', { action: 'unknown.time', createdAt: 'invalid' }),
      audit('recent', { action: 'token.revoke', resource: 'token', details: 'operator request' }),
    ]));
    hooks.security.mockReturnValue(query([
      security('unknown'),
      security('locked', { locked: true }),
      security('unlocked', { locked: false }),
      security('sentry', { sentryMode: true }),
      security('door', { doorState: true }),
      security('guest', { guestMode: false }),
      security('valet', { valetModeEnabled: false }),
    ]));
    const view = mount('classic');
    const content = () => [...view.container.querySelectorAll('dt, dd')].map(node => node.textContent);
    const original = content();
    expect(screen.getByText('token · operator request')).toBeInTheDocument();
    for (const title of [
      'Vehicle locked', 'Vehicle unlocked', 'Sentry: On', 'Door: Open', 'Guest mode off', 'Valet mode off',
    ]) expect(screen.getByText(title)).toBeInTheDocument();
    expect(view.container.querySelector('dt')).toHaveTextContent('token.revoke');
    expect([...view.container.querySelectorAll('dt')].at(-1)).toHaveTextContent('unknown.time');
    expect([...view.container.querySelectorAll('dd')].at(-1)).toHaveTextContent('—');

    view.update(packId);
    await expectPresentation(view.container, packId);
    expect(content()).toEqual(original);

    hooks.security.mockReturnValue(query([]));
    hooks.audit.mockReturnValue(query(Array.from({ length: 16 }, (_, index) =>
      audit(`cap-${index}`, { action: `action.${index}`, createdAt: timestamp(index) }))));
    view.update(packId);
    expect(view.container.querySelectorAll('dt')).toHaveLength(15);
    expect(screen.getByText('action.0')).toBeInTheDocument();
    expect(screen.queryByText('action.15')).not.toBeInTheDocument();
  });

  it('preserves compact counts and severity, excluding old, future and invalid timestamps, across pack switches', async () => {
    const excluded = [
      audit('old', { action: 'vehicle.delete', createdAt: timestamp(1500) }),
      audit('future', { action: 'token.revoke', createdAt: timestamp(-60) }),
      audit('invalid', { action: 'login.failed', createdAt: 'invalid' }),
    ];
    hooks.audit.mockReturnValue(query([...excluded, audit('warning', { action: 'settings.update' })]));
    hooks.security.mockReturnValue(query([security('critical', { locked: false })]));
    const view = mount(packId, { size: { cols: 1, rows: 2 } });
    await expectPresentation(view.container, packId);
    expect(screen.getByText('Events (24h)')).toBeInTheDocument();
    expect(screen.getByText('2', { exact: true })).toBeInTheDocument();
    expect(screen.getByText('Critical')).toBeInTheDocument();
    expect(screen.queryByText('settings.update')).not.toBeInTheDocument();

    hooks.security.mockReturnValue(query([]));
    view.update();
    expect(screen.getByText('1', { exact: true })).toBeInTheDocument();
    expect(screen.getByText('Warning')).toBeInTheDocument();
    hooks.audit.mockReturnValue(query(excluded));
    view.update();
    expect(screen.getByText('0', { exact: true })).toBeInTheDocument();
    expect(screen.getByText('Info')).toBeInTheDocument();
    view.update('classic');
    expect(screen.getByText('0', { exact: true })).toBeInTheDocument();
    view.update();
    await expectPresentation(view.container, packId);
    expect(screen.getByText('0', { exact: true })).toBeInTheDocument();
    expect(screen.queryByText('Critical')).not.toBeInTheDocument();
  });

  it.each([1, 3])('keeps honest initial, failure, partial, retained and empty states at %i columns', async (cols) => {
    hooks.audit.mockReturnValue(query(undefined, { isLoading: true }));
    hooks.security.mockReturnValue(query(undefined, { isLoading: true }));
    const view = mount(packId, { size: { cols, rows: 2 } });
    const shell = () => view.container.querySelector('[data-data-state]');
    expect(shell()).toHaveAttribute('data-data-state', 'initial');
    expect(shell()).toHaveAttribute('aria-busy', 'true');
    expect(screen.queryByText('No audit events')).not.toBeInTheDocument();

    hooks.audit.mockReturnValue(query(undefined, { isError: true, error: new Error('audit failed') }));
    hooks.security.mockReturnValue(query(undefined, { isError: true, error: new Error('security failed') }));
    view.update();
    expect(shell()).toHaveAttribute('data-data-state', 'initialFailure');
    expect(screen.getByText("Can't reach server")).toBeInTheDocument();
    expect(screen.queryByText('No audit events')).not.toBeInTheDocument();

    const retained = [audit('retained', { action: 'token.revoke' })];
    hooks.audit.mockReturnValue(query(retained));
    hooks.security.mockReturnValue(query(undefined, { isLoading: true }));
    view.update();
    await expectPresentation(view.container, packId);
    expect(shell()).toHaveAttribute('data-data-state', 'partial');
    expect(screen.getByText(cols === 1 ? 'Critical' : 'token.revoke')).toBeInTheDocument();

    hooks.audit.mockReturnValue(query(retained, { isError: true, error: new Error('refresh failed') }));
    hooks.security.mockReturnValue(query([]));
    view.update();
    expect(shell()).toHaveAttribute('data-data-state', 'stale');
    expect(screen.getByTestId('stale-refresh-warning')).toBeInTheDocument();
    expect(screen.getByText(cols === 1 ? 'Critical' : 'token.revoke')).toBeInTheDocument();
    expect(screen.queryByText("Can't reach server")).not.toBeInTheDocument();

    hooks.audit.mockReturnValue(query(null));
    hooks.security.mockReturnValue(query(null));
    view.update();
    expect(screen.getByText('No audit events')).toBeInTheDocument();
    expect(screen.queryByText('Events (24h)')).not.toBeInTheDocument();
  });

  it('keeps refresh callbacks and vehicle discovery guards independent of presentation', async () => {
    const auditSource = query([audit('source')]);
    const securitySource = query([security('unknown')]);
    hooks.audit.mockReturnValue(auditSource);
    hooks.security.mockReturnValue(securitySource);
    const discovery = query(undefined, { error: new Error('discovery failed'), isError: true });
    hooks.vehicles.mockReturnValue(discovery);
    const view = mount(packId, { vehicleId: undefined });
    await expectPresentation(view.container, packId);
    expect(hooks.security).toHaveBeenLastCalledWith('');
    expect(screen.queryByText('Security event')).not.toBeInTheDocument();
    fireEvent.click(screen.getAllByRole('button', { name: /^Refresh/i })[0]);
    expect(auditSource.refetch).toHaveBeenCalledOnce();
    expect(discovery.refetch).toHaveBeenCalledOnce();
    expect(securitySource.refetch).not.toHaveBeenCalled();

    view.update(packId, { vehicleId: 7 });
    expect(hooks.security).toHaveBeenLastCalledWith('7');
    expect(screen.queryByText('Vehicle unlocked')).not.toBeInTheDocument();
    expect(screen.queryByText('Guest mode off')).not.toBeInTheDocument();
    fireEvent.click(screen.getAllByRole('button', { name: /^Refresh/i })[0]);
    expect(auditSource.refetch).toHaveBeenCalledTimes(2);
    expect(securitySource.refetch).toHaveBeenCalledOnce();
    expect(discovery.refetch).toHaveBeenCalledOnce();
    for (const vehicleId of [0, -1, NaN, Infinity, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
      view.update(packId, { vehicleId });
      expect(hooks.security).toHaveBeenLastCalledWith('');
      expect(screen.queryByText('Security event')).not.toBeInTheDocument();
    }
  });
});
