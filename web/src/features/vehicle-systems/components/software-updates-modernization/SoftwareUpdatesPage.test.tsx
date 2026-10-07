/**
 * Parent's first mounted run: 1 passed, 2 failed on missing Router/motion setup.
 * Corrected setup NOT RERUN by this writer; parent owns the serialized Vitest baton.
 * Every query/vehicle input is fake; no installation or vehicle command is invoked.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { MemoryRouter } from 'react-router-dom';
import SoftwareUpdatesPage from '../../pages/SoftwareUpdatesPage';

const fake = vi.hoisted(() => ({
  query: { data: undefined as unknown, isLoading: false, isError: false, error: null as unknown, refetch: vi.fn() },
  vehicleId: 7 as number | null,
  setPage: vi.fn(), resetRange: vi.fn(), setUrl: vi.fn(),
}));
vi.mock('@tanstack/react-query', async importOriginal => ({
  ...await importOriginal<typeof import('@tanstack/react-query')>(),
  useQuery: () => fake.query,
}));
vi.mock('@/hooks/useSelectedVehicle', () => ({
  useSelectedVehicle: () => ({ vehicleId: fake.vehicleId, vehicles: [{ id: 7, display_name: 'Fake vehicle', vin: 'FAKE' }] }),
}));
vi.mock('@/hooks/usePageTitle', () => ({ usePageTitle: vi.fn() }));
vi.mock('@/hooks/useRangeState', () => ({
  useRangeState: () => ({ start: '2026-01-01', end: '2026-02-01', presetId: 'custom', reset: fake.resetRange }),
}));
vi.mock('@/hooks/useUrlState', () => ({
  useUrlNumber: () => [1, fake.setPage], useUrlBatch: () => fake.setUrl,
}));
vi.mock('@/hooks/useNumberFormatting', () => ({
  useNumberFormatting: () => ({ fmtInt: (n: number) => String(Math.round(n)), locale: 'en-US' }),
}));
vi.mock('@/hooks/useUnits', () => ({
  useUnits: () => ({ unitPrefs: { locale: 'en-US', precision: 2, duration: 'd' } }),
}));
vi.mock('@/hooks/useFormatting', () => ({
  useFormatting: () => ({ currencySymbol: '$' }),
}));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback: string, values?: Record<string, unknown>) =>
      fallback.replace(/\{\{(\w+)\}\}/g, (_match, key: string) => String(values?.[key] ?? '')),
  }),
}));
vi.mock('@/components/motion', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/components/motion')>();
  return {
    ...actual,
    FadeIn: ({ children }: { children: ReactNode }) => <>{children}</>,
  };
});
vi.mock('@/components/ai/AISoftwareUpdateChangelogSummarizer', () => ({
  AISoftwareUpdateChangelogSummarizer: ({ vehicleId }: { vehicleId?: number }) => <div data-testid="fake-ai">{vehicleId}</div>,
}));
vi.mock('@/components/layout/layout-reference', async importOriginal => ({
  ...await importOriginal<typeof import('@/components/layout/layout-reference')>(),
  PageLayout: ({ children, secondaryActions }: { children: ReactNode; secondaryActions: ReactNode }) => <main>{secondaryActions}{children}</main>,
  LayoutCard: ({ title, children }: { title: string; children: ReactNode }) => <section><h2>{title}</h2>{children}</section>,
  CardGrid: ({ items }: { items: { id: string; content: ReactNode }[] }) => <div>{items.map(item => <div key={item.id}>{item.content}</div>)}</div>,
  useCardPlacement: () => ({ className: 'col-span-1' }),
}));
vi.mock('@/components/layout', async importOriginal => ({
  ...await importOriginal<typeof import('@/components/layout')>(),
  ...await import('@/components/layout/layout-reference'),
}));
vi.mock('@/components/data-display', async importOriginal => ({
  ...await importOriginal<typeof import('@/components/data-display')>(),
  ...await import('@/components/data-display/stat-reference'),
}));
vi.mock('./SoftwareCadenceCard', () => ({
  SoftwareCadenceCard: ({ data, errorContent }: { data: unknown[]; errorContent: ReactNode }) =>
    <section data-testid="cadence">{data.length}{errorContent}</section>,
}));

const row = {
  id: 11, vehicle_id: 7, version: '2026.1 / fake', status: 'installed',
  installed_at: '2026-01-10T12:00:00Z', scheduled_at: '2026-01-09T12:00:00Z', created_at: '2026-01-08T12:00:00Z',
};
// RTL keeps this same wrapper around every rerender, including real query errors.
function RouterWrapper({ children }: { children: ReactNode }) {
  return <MemoryRouter initialEntries={['/software-updates']}>{children}</MemoryRouter>;
}

function summaryMetric(label: string) {
  const region = screen.getByTestId('software-update-summary');
  const node = within(region).getByText(label, {
    selector: '[data-operational-metric] > div:first-child > :first-child',
  }).closest('[data-operational-metric]');
  if (!(node instanceof HTMLElement)) throw new Error(`Missing summary metric ${label}`);
  return within(node);
}

describe('SoftwareUpdatesPage presentation preservation (fake inputs only)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fake.query.data = undefined;
    fake.query.isLoading = false;
    fake.query.isError = false;
    fake.query.error = null;
    fake.vehicleId = 7;
  });
  it('keeps unknown counts distinct from a successful observed empty page', () => {
    const view = render(<SoftwareUpdatesPage />, { wrapper: RouterWrapper });
    expect(summaryMetric('Total updates').getByText('—')).toBeTruthy();
    expect(screen.getByText('By status')).toBeTruthy();
    expect(screen.getByText('Update timeline')).toBeTruthy();
    fake.query.data = [];
    view.rerender(<SoftwareUpdatesPage />);
    expect(summaryMetric('Total updates').getByText('0')).toBeTruthy();
    expect(screen.getByText('No update history')).toBeTruthy();
  });
  it('refreshes unavailable status and timeline from the existing read query without manufacturing counts', () => {
    render(<SoftwareUpdatesPage />, { wrapper: RouterWrapper });
    const messages = screen.getAllByText('Update history is not available. Select a vehicle to load its history.');
    expect(messages).toHaveLength(3);
    for (const message of messages) {
      const status = message.closest('[role="status"]');
      if (!(status instanceof HTMLElement)) throw new Error('Missing unavailable software source');
      fireEvent.click(within(status).getByRole('button', { name: 'Refresh' }));
    }
    expect(fake.query.refetch).toHaveBeenCalledTimes(3);
    expect(summaryMetric('Total updates').getByText('—')).toBeTruthy();
    expect(screen.queryByRole('link', { name: /Release notes/ })).toBeNull();
  });
  it('offers vehicle management from every unavailable surface when no vehicle is selected', () => {
    fake.vehicleId = null;
    render(<SoftwareUpdatesPage />, { wrapper: RouterWrapper });
    const links = screen.getAllByRole('link', { name: 'Manage vehicles' });
    expect(links).toHaveLength(3);
    for (const link of links) expect(link).toHaveAttribute('href', '/vehicles');
    expect(fake.query.refetch).not.toHaveBeenCalled();
    expect(summaryMetric('Total updates').getByText('—')).toBeTruthy();
  });
  it('retains exact row identities, release-note link, vehicle and AI scope on refresh failure', () => {
    fake.query.data = [row];
    fake.query.isError = true;
    fake.query.error = new Error('Fake refresh failure');
    render(<SoftwareUpdatesPage />, { wrapper: RouterWrapper });
    expect(screen.getByTestId('software-update-summary').parentElement).toHaveAttribute('data-source-retained', 'true');
    expect(summaryMetric('Current version').getByText(row.version)).toBeTruthy();
    expect(screen.getByText('Fake vehicle')).toBeTruthy();
    expect(screen.getByTestId('fake-ai').textContent).toBe('7');
    const link = screen.getByRole('link', { name: `Release notes for ${row.version}` });
    expect(link.getAttribute('href')).toBe(`https://www.notateslaapp.com/software-updates/version/${encodeURIComponent(row.version)}/release-notes`);
    expect(link.getAttribute('rel')).toBe('noopener noreferrer');
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    expect(fake.query.refetch).toHaveBeenCalledOnce();
    expect(screen.queryByText(/^Scheduled /)).toBeNull();
  });
  it('keeps the original non-installed scheduled-date condition and reset callback', () => {
    fake.query.data = [{ ...row, status: 'scheduled', installed_at: null }];
    const view = render(<SoftwareUpdatesPage />, { wrapper: RouterWrapper });
    expect(screen.getByText(/^Scheduled /)).toBeTruthy();
    expect(summaryMetric('Pending').getByText('1')).toBeTruthy();
    fake.query.data = [];
    view.rerender(<SoftwareUpdatesPage />);
    fireEvent.click(screen.getAllByRole('button', { name: 'View all time' })[0]);
    expect(fake.resetRange).toHaveBeenCalledOnce();
  });
});
