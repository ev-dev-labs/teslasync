import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import type { ReactNode } from 'react';
import type { DataStateSource } from '@/api/dataState';
import type { SentinelFinding, SentinelPage } from '@/types/advancedIntelligence';
import { formatDateTime } from '@/lib/dateFormat';
import { BADGE_VARIANTS } from '@/components/ui';
import BehavioralSentinelPage from './BehavioralSentinelPage';

const mocks = vi.hoisted(() => ({
  vehicleId: 4 as number | null,
  query: vi.fn(),
  refetch: vi.fn(),
  translations: {} as Record<string, string>,
}));

vi.mock('@/api/hooks/useAdvancedIntelligence', () => ({
  useBehavioralSentinel: mocks.query,
}));
vi.mock('@/hooks/useSelectedVehicle', () => ({
  useSelectedVehicle: () => ({ vehicleId: mocks.vehicleId }),
}));
vi.mock('@/hooks/usePageTitle', () => ({ usePageTitle: vi.fn() }));
vi.mock('@/hooks/useDateFormat', async () => {
  const actual = await vi.importActual<typeof import('@/hooks/useDateFormat')>('@/hooks/useDateFormat');
  return {
    ...actual,
    useDateFormat: (mode?: Parameters<typeof actual.useDateFormat>[0]) => ({
      ...actual.useDateFormat(mode),
      formatDateTime: (value: Parameters<typeof formatDateTime>[0], override?: Parameters<typeof formatDateTime>[1]) =>
        formatDateTime(value, { locale: 'en-GB', tz: 'Pacific/Auckland', ...override }),
    }),
  };
});
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallbackOrOptions?: string | Record<string, unknown>, options?: Record<string, unknown>) => {
      const values = typeof fallbackOrOptions === 'string' ? options : fallbackOrOptions;
      const template = typeof fallbackOrOptions === 'string'
        ? fallbackOrOptions
        : String(values?.defaultValue ?? key);
      return (mocks.translations[key] ?? template).replace(/\{\{(\w+)\}\}/g, (_, name: string) => String(values?.[name] ?? ''));
    },
    i18n: { language: 'en', changeLanguage: vi.fn() },
  }),
  Trans: ({ children }: { children?: ReactNode }) => <>{children}</>,
  initReactI18next: { type: '3rdParty', init: vi.fn() },
}));

function finding(overrides: Partial<SentinelFinding> = {}): SentinelFinding {
  return {
    finding_type: 'identity_pattern',
    severity: 'high',
    confidence_pct: 72.5,
    observed_at: '2026-06-01T12:30:00Z',
    explanation: 'Test-only unusual aggregate command timing; not personal attribution.',
    evidence: [{
      source: 'test-command-history',
      summary: 'Test-only timing comparison across command groups.',
      sample_count: 12,
      observed_at: '2026-06-01T12:25:00Z',
    }],
    limitations: ['Test-only aggregate pattern cannot establish intent.'],
    ...overrides,
  };
}

function payload(overrides: Partial<SentinelPage> = {}): SentinelPage {
  return {
    items: [finding()],
    total: 1,
    limit: 20,
    offset: 0,
    data_quality: {
      status: 'limited',
      sample_count: 12,
      coverage_pct: 65,
      window_start: '2026-05-01T00:00:00Z',
      window_end: '2026-06-01T00:00:00Z',
      reasons: ['Test-only observation gaps remain.'],
    },
    limitations: ['Test-only evidence covers only the loaded page.'],
    generated_at: '2026-06-01T12:40:00Z',
    ...overrides,
  };
}

function query(data?: SentinelPage, overrides: DataStateSource<SentinelPage> & { isPlaceholderData?: boolean } = {}) {
  return {
    data,
    isLoading: false,
    isFetching: false,
    isSuccess: data !== undefined,
    isError: false,
    isPlaceholderData: false,
    fetchStatus: 'idle',
    dataUpdatedAt: Date.UTC(2026, 5, 1, 12, 40),
    error: null,
    refetch: mocks.refetch,
    ...overrides,
  };
}

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<BehavioralSentinelPage />, {
    wrapper: ({ children }) => (
      <MemoryRouter>
        <QueryClientProvider client={client}>{children}</QueryClientProvider>
      </MemoryRouter>
    ),
  });
}

function findingArticle() {
  return screen.getByRole('article');
}

beforeEach(() => {
  vi.stubEnv('TZ', 'UTC');
  vi.clearAllMocks();
  mocks.vehicleId = 4;
  mocks.translations = {};
  mocks.query.mockReturnValue(query(payload()));
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('BehavioralSentinelPage', () => {
  it('preserves finding metadata, aggregate evidence, quality and non-attribution warnings', () => {
    renderPage();
    const article = within(findingArticle());
    expect(article.getByRole('heading', { name: 'identity_pattern' })).toBeInTheDocument();
    expect(article.getByText('High')).toHaveClass(...BADGE_VARIANTS.danger.split(' '));
    expect(article.getByText('72.50% confidence')).toBeInTheDocument();
    expect(article.getByText('Test-only unusual aggregate command timing; not personal attribution.')).toBeInTheDocument();
    expect(article.getByText('2 Jun 2026, 00:30')).toBeInTheDocument();
    expect(article.getByText('Test-only aggregate pattern cannot establish intent.')).toBeInTheDocument();
    expect(screen.getByText('Anomaly is not attribution')).toBeInTheDocument();
    expect(screen.getByText('Findings identify unusual aggregate behavior. They do not identify a person, prove intent, or establish compromise.')).toBeInTheDocument();
    const quality = within(screen.getByRole('region', { name: 'Data quality' }));
    expect(quality.getByText('Limited evidence')).toBeInTheDocument();
    expect(quality.getByText('12')).toBeInTheDocument();
    expect(quality.getByText('65.00%')).toBeInTheDocument();
    expect(quality.getByText(/1 May 2026.*1 Jun 2026/)).toBeInTheDocument();
    expect(quality.getByText(/Test-only observation gaps remain/)).toBeInTheDocument();
    const evidence = within(screen.getByRole('region', { name: 'Evidence sources' }));
    expect(evidence.getByText('test-command-history')).toBeInTheDocument();
    expect(evidence.getByText('Test-only timing comparison across command groups.')).toBeInTheDocument();
    expect(evidence.getByText(/12 samples/)).toBeInTheDocument();
    expect(screen.getByText(/Test-only evidence covers only the loaded page/)).toBeInTheDocument();
    expect(screen.getByText(/Attribution to a specific person or identity/)).toBeInTheDocument();
    expect(screen.getByText(/Proof of malicious intent or compromise/)).toBeInTheDocument();
    expect(mocks.query).toHaveBeenCalledWith(4, 20, 0);
  });

  it('uses neutral theme roles and semantic lists without truncating long findings', () => {
    const identifier = 'test_identity_' + 'long_identifier_'.repeat(20);
    mocks.query.mockReturnValue(query(payload({ items: [finding({ finding_type: identifier })] })));
    renderPage();
    const article = findingArticle();
    expect(article).toHaveClass('min-w-0', 'rounded-panel', 'bg-[var(--surface-2)]', 'border-[var(--border-default)]');
    expect(within(article).getByRole('heading', { name: identifier })).toHaveClass('break-words');
    const lists = within(article).getAllByRole('list');
    expect(lists).toHaveLength(2);
    expect(within(lists[0]).getByRole('listitem')).toHaveTextContent('test-command-history: Test-only timing comparison across command groups.');
    expect(within(lists[1]).getByRole('listitem')).toHaveTextContent('Test-only aggregate pattern cannot establish intent.');
    const glyph = article.querySelector('svg');
    expect(glyph).toHaveAttribute('aria-hidden', 'true');
    expect(glyph).toHaveClass('shrink-0', 'text-[var(--text-secondary)]');
  });

  it('explains absent per-finding evidence and limitations without claiming none exist', () => {
    mocks.query.mockReturnValue(query(payload({ items: [finding({ evidence: [], limitations: [] })] })));
    renderPage();
    const article = within(findingArticle());
    expect(article.getByText('No detailed evidence was returned.')).toBeInTheDocument();
    expect(article.getByText('No additional limitations were returned.')).toBeInTheDocument();
    expect(article.queryByRole('list')).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Evidence, quality, and limitations' })).toBeInTheDocument();
  });

  it.each([
    { case: 'measured zero', confidence: 0, expected: '0.00% confidence' },
    { case: 'nonfinite unknown', confidence: NaN, expected: 'Unknown' },
  ])('preserves $case confidence independently from unrecognized severity', ({ confidence, expected }) => {
    mocks.query.mockReturnValue(query(payload({ items: [finding({ confidence_pct: confidence, severity: 'unclassified' })] })));
    renderPage();
    const article = within(findingArticle());
    expect(article.getByText(expected)).toBeInTheDocument();
    expect(article.getByText('Unknown severity: unclassified')).toHaveClass(...BADGE_VARIANTS.neutral.split(' '));
    expect(article.queryByText('NaN% confidence')).not.toBeInTheDocument();
  });

  it.each([
    { severity: 'critical', label: 'Critical', translated: 'Kritisch', variant: 'danger' },
    { severity: 'high', label: 'High', translated: 'Hoch', variant: 'danger' },
    { severity: 'medium', label: 'Medium', translated: 'Mittel', variant: 'warning' },
    { severity: 'warning', label: 'Warning', translated: 'Warnung', variant: 'warning' },
    { severity: 'low', label: 'Low', translated: 'Niedrig', variant: 'info' },
    { severity: 'info', label: 'Info', translated: 'Information', variant: 'info' },
  ] satisfies Array<{ severity: string; label: string; translated: string; variant: keyof typeof BADGE_VARIANTS }>)(
    'localizes $severity at the badge without changing source data or variants',
    async ({ severity, label, translated, variant }) => {
      const item = Object.freeze(finding({ severity }));
      mocks.query.mockReturnValue(query(payload({ items: [item] })));
      const view = renderPage();
      expect(within(findingArticle()).getByText(label)).toHaveClass(...BADGE_VARIANTS[variant].split(' '));
      mocks.translations[`advancedIntelligence.sentinel.severity.${severity}`] = translated;
      view.rerender(<BehavioralSentinelPage />);
      const article = within(findingArticle());
      expect(article.getByText(translated)).toHaveClass(...BADGE_VARIANTS[variant].split(' '));
      await waitFor(() => expect(screen.getByText('Limited evidence')).toBeVisible());
      expect(article.getByText(item.explanation)).toBeVisible();
      expect(article.getByText(`${item.evidence[0].source}: ${item.evidence[0].summary}`)).toBeVisible();
      expect(article.getByText(item.limitations[0])).toBeVisible();
      expect(item.severity).toBe(severity);
      expect(mocks.refetch).not.toHaveBeenCalled();
    },
  );

  it.each(['future-severity', 'advancedIntelligence.sentinel.severity.high', '<unknown-severity>'])(
    'shows unknown severity %s explicitly without translating its raw code',
    (severity) => {
      const item = Object.freeze(finding({ severity }));
      mocks.query.mockReturnValue(query(payload({ items: [item] })));
      mocks.translations['advancedIntelligence.sentinel.severity.high'] = 'Hoch';
      const view = renderPage();
      expect(within(findingArticle()).getByText(`Unknown severity: ${severity}`))
        .toHaveClass(...BADGE_VARIANTS.neutral.split(' '));
      mocks.translations['advancedIntelligence.sentinel.severity.unknownCode'] = 'Unbekannter Schweregrad: {{code}}';
      view.rerender(<BehavioralSentinelPage />);
      expect(within(findingArticle()).getByText(`Unbekannter Schweregrad: ${severity}`))
        .toHaveClass(...BADGE_VARIANTS.neutral.split(' '));
      expect(item.severity).toBe(severity);
      expect(mocks.refetch).not.toHaveBeenCalled();
    },
  );

  it('requests the first page immediately when the workspace vehicle changes and returns', () => {
    mocks.query.mockImplementation((_vehicleId: number, _limit: number, offset: number) =>
      query(payload({ total: 65, offset })));
    const view = renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'Next page' }));
    expect(mocks.query).toHaveBeenLastCalledWith(4, 20, 20);
    mocks.vehicleId = 3;
    mocks.query.mockClear();
    view.rerender(<BehavioralSentinelPage />);
    expect(mocks.query.mock.calls.every(([vehicleId, , offset]) => vehicleId === 3 && offset === 0)).toBe(true);
    mocks.vehicleId = 4;
    view.rerender(<BehavioralSentinelPage />);
    expect(mocks.query).toHaveBeenLastCalledWith(4, 20, 0);
  });

  it('recovers the last valid page after a resolved total shrinks', async () => {
    let shrunk = false;
    mocks.query.mockImplementation((_vehicleId: number, _limit: number, offset: number) =>
      query(payload({ total: shrunk ? 25 : 65, offset, items: shrunk && offset === 60 ? [] : [finding()] })));
    const view = renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'Last page' }));
    expect(mocks.query).toHaveBeenLastCalledWith(4, 20, 60);
    shrunk = true;
    view.rerender(<BehavioralSentinelPage />);
    await waitFor(() => expect(mocks.query).toHaveBeenLastCalledWith(4, 20, 20));
    expect(screen.getByRole('button', { name: 'Page 2 of 2' })).toHaveAttribute('aria-current', 'page');
    expect(findingArticle()).toBeInTheDocument();
  });

  it('keeps empty-page navigation reachable without turning failed refresh into a fresh total', () => {
    mocks.query.mockImplementation((_vehicleId: number, _limit: number, offset: number) =>
      query(payload({ total: 65, offset, items: offset ? [] : [finding()] }), offset ? {
        error: new Error('test-only refresh failed'),
        isError: true,
        isSuccess: false,
      } : {}));
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'Next page' }));
    expect(screen.getByRole('navigation', { name: 'Pagination' })).toBeInTheDocument();
    expect(screen.getByText('No supported sentinel findings were detected.')).toBeInTheDocument();
    expect(screen.getByText('The refresh failed; the most recently loaded evidence remains visible.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Previous page' }));
    expect(mocks.query).toHaveBeenLastCalledWith(4, 20, 0);
    expect(findingArticle()).toBeInTheDocument();
  });

  it.each([
    { case: 'refresh failure', state: { error: new Error('test-only failure'), isError: true, isSuccess: false }, message: 'The refresh failed; the most recently loaded evidence remains visible.' },
    { case: 'paused refresh', state: { fetchStatus: 'paused' as const }, message: 'Cached evidence remains visible while its refresh is paused.' },
  ])('retains findings and metadata through $case with independent retry', ({ state, message }) => {
    mocks.query.mockReturnValue(query(payload(), state));
    renderPage();
    expect(within(findingArticle()).getByText('identity_pattern')).toBeInTheDocument();
    expect(screen.getByText('test-command-history')).toBeInTheDocument();
    expect(screen.getByText(message)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Refresh', exact: true }));
    expect(mocks.refetch).toHaveBeenCalledOnce();
  });

  it('keeps findings and warning shells visible during initial loading and fatal failure', () => {
    mocks.query.mockReturnValue(query(undefined, { isLoading: true, fetchStatus: 'fetching' }));
    const view = renderPage();
    expect(screen.getByRole('heading', { name: 'Explainable findings' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Evidence, quality, and limitations' })).toBeInTheDocument();
    expect(screen.queryByRole('article')).not.toBeInTheDocument();
    expect(screen.getByText('Anomaly is not attribution')).toBeInTheDocument();
    mocks.query.mockReturnValue(query(undefined, { error: new Error('test-only load failed'), isError: true }));
    view.rerender(<BehavioralSentinelPage />);
    expect(screen.getByText('Intelligence evidence could not be loaded.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(mocks.refetch).toHaveBeenCalledOnce();
    expect(screen.getByRole('heading', { name: 'Evidence, quality, and limitations' })).toBeInTheDocument();
  });

  it('distinguishes an initial paused query from a resolved empty response', () => {
    mocks.query.mockReturnValue(query(undefined, { fetchStatus: 'paused' }));
    const view = renderPage();
    expect(screen.getByText('The initial evidence query is paused; no empty result is inferred.')).toBeInTheDocument();
    expect(screen.queryByText('No supported sentinel findings were detected.')).not.toBeInTheDocument();
    mocks.query.mockReturnValue(query(payload({ items: [], total: 0 })));
    view.rerender(<BehavioralSentinelPage />);
    expect(screen.getByText('No supported sentinel findings were detected.')).toBeInTheDocument();
    expect(screen.queryByRole('navigation', { name: 'Pagination' })).not.toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Data quality' })).toBeInTheDocument();
  });

  it('preserves the vehicle prerequisite and static warnings without inventing findings', () => {
    mocks.vehicleId = null;
    mocks.query.mockReturnValue(query());
    renderPage();
    expect(mocks.query).toHaveBeenCalledWith(null, 20, 0);
    expect(screen.getByText('Select a vehicle to load intelligence.')).toBeInTheDocument();
    expect(screen.getByText('Anomaly is not attribution')).toBeInTheDocument();
    expect(screen.getByText(/Attribution to a specific person or identity/)).toBeInTheDocument();
    expect(screen.queryByRole('article')).not.toBeInTheDocument();
  });
});
