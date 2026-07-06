/**
 * WebhookSummary — full behavioural coverage of the Webhooks KPI band.
 *
 * The band derives a four-card bento off the shared `useWebhookChannels()`
 * query result passed down from the page, and owns every state itself so it
 * stays visible regardless of data availability. This suite pins each facet:
 *
 *   • Loaded — the four KPI cards (Endpoints / Enabled / Secure transport /
 *     HTTP methods) render with their English labels and the aggregates derived
 *     off `query.data`: the endpoint count, the enabled/total and secure/total
 *     ratios, and the sorted list of HTTP verbs in use.
 *   • Methods aggregation — verbs are de-duplicated and sorted, and a malformed
 *     empty / whitespace `method` degrades to POST (the server default) rather
 *     than leaking a blank token into the summary. That last case is the source
 *     bug this suite drove out: without the `|| 'POST'` guard the card would
 *     read "" or ", GET".
 *   • Secure transport — HTTPS detection is case-insensitive and
 *     whitespace-tolerant; plain-HTTP endpoints are never counted as secure.
 *   • Empty — zero webhooks render as zeros / em-dashes (never a blank panel),
 *     the labels still show, and the labelled region is preserved.
 *   • Loading — the whole band swaps for a labelled, busy stat-grid skeleton and
 *     none of the metric labels leak through.
 *   • Error — the shared QueryError surfaces with a Retry that calls
 *     `query.refetch()`.
 *   • Null safety — an `undefined` data payload degrades to the empty branch
 *     instead of iterating undefined.
 *   • a11y — the band is a labelled `region` and every lucide glyph is
 *     decorative and hidden from assistive tech.
 *
 * `@/components/data-display` (pulled in via MetricCard) drags motion-driven
 * siblings into the module graph, so framer-motion is stubbed to a passthrough
 * to keep module load hermetic in jsdom. react-i18next echoes the English
 * fallback so copy is deterministic without booting the real catalog. QueryError
 * uses `useNavigate`, so renders are wrapped in a MemoryRouter.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { ReactNode } from 'react';

import type { NotificationChannelWebhook } from '@/types/notifications';

vi.mock('framer-motion', () => ({
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
  useReducedMotion: () => true,
  useInView: () => true,
  useMotionValue: (v: unknown) => ({ get: () => v, set: vi.fn(), on: vi.fn() }),
  useSpring: (v: unknown) => ({ get: () => v, set: vi.fn(), on: vi.fn() }),
  useTransform: () => ({ get: () => 0, set: vi.fn(), on: vi.fn() }),
  animate: vi.fn(() => ({ stop: vi.fn() })),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback?: string) => fallback ?? _key,
    i18n: { language: 'en', changeLanguage: vi.fn() },
  }),
  Trans: ({ children }: { children?: ReactNode }) => <>{children}</>,
  initReactI18next: { type: '3rdParty', init: () => undefined },
}));

import { WebhookSummary, type WebhookSummaryProps } from './WebhookSummary';

type Query = WebhookSummaryProps['query'];

/** Build a well-formed webhook channel; every field is overridable. */
function makeWebhook(over: Partial<NotificationChannelWebhook> = {}): NotificationChannelWebhook {
  return {
    id: 1,
    name: 'Deploy hook',
    kind: 'webhook',
    enabled: true,
    created_at: '2024-01-01T00:00:00Z',
    updated_at: '2024-01-01T00:00:00Z',
    url: 'https://example.com/hook',
    method: 'POST',
    headers: {},
    body_template: '',
    ...over,
  };
}

/** Minimal query-result stub carrying only the fields the band reads. */
function makeQuery(over: Partial<Record<keyof Query, unknown>> = {}): Query {
  return {
    data: [] as NotificationChannelWebhook[],
    isLoading: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
    ...over,
  } as unknown as Query;
}

function renderBand(query: Query) {
  return render(
    <MemoryRouter>
      <WebhookSummary query={query} />
    </MemoryRouter>,
  );
}

const SECTION = 'Webhook endpoints summary';

/**
 * A representative fleet engineered so every displayed figure is distinct:
 * 5 endpoints, 3 enabled, 4 over HTTPS, verbs {GET, POST, PUT}.
 */
const LOADED: NotificationChannelWebhook[] = [
  makeWebhook({ id: 1, enabled: true, url: 'https://a.example/1', method: 'POST' }),
  makeWebhook({ id: 2, enabled: true, url: 'https://b.example/2', method: 'GET' }),
  makeWebhook({ id: 3, enabled: true, url: 'https://c.example/3', method: 'PUT' }),
  makeWebhook({ id: 4, enabled: false, url: 'https://d.example/4', method: 'POST' }),
  makeWebhook({ id: 5, enabled: false, url: 'http://e.example/5', method: 'GET' }),
];

const LABELS = ['Endpoints', 'Enabled', 'Secure transport', 'HTTP methods'] as const;

describe('WebhookSummary — loaded', () => {
  it('renders all four KPI cards with their English labels', () => {
    renderBand(makeQuery({ data: LOADED }));

    for (const label of LABELS) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
  });

  it('derives the endpoint count, enabled/total and secure/total ratios', () => {
    renderBand(makeQuery({ data: LOADED }));

    expect(screen.getByText('5')).toBeInTheDocument(); // endpoints total
    expect(screen.getByText('3/5')).toBeInTheDocument(); // enabled / total
    expect(screen.getByText('4/5')).toBeInTheDocument(); // secure / total
  });

  it('summarises the distinct HTTP verbs in sorted order', () => {
    renderBand(makeQuery({ data: LOADED }));

    // {POST, GET, PUT} de-duplicated and alphabetised.
    expect(screen.getByText('GET, POST, PUT')).toBeInTheDocument();
  });
});

describe('WebhookSummary — methods aggregation', () => {
  it('de-duplicates repeated verbs and normalises case', () => {
    renderBand(
      makeQuery({
        data: [
          makeWebhook({ id: 1, method: 'post' as NotificationChannelWebhook['method'] }),
          makeWebhook({ id: 2, method: 'POST' }),
          makeWebhook({ id: 3, method: 'get' as NotificationChannelWebhook['method'] }),
        ],
      }),
    );

    // Lowercase `post`/`POST` collapse to one entry; `get` upper-cases to GET.
    expect(screen.getByText('GET, POST')).toBeInTheDocument();
  });

  it('degrades a blank/whitespace method to POST instead of a blank token', () => {
    // Regression pin: an empty `method` slips past `?? 'POST'`; the `|| 'POST'`
    // guard keeps it out of the summary. Without the fix this read ", GET".
    renderBand(
      makeQuery({
        data: [
          makeWebhook({ id: 1, method: '' as NotificationChannelWebhook['method'] }),
          makeWebhook({ id: 2, method: '  ' as NotificationChannelWebhook['method'] }),
          makeWebhook({ id: 3, method: 'GET' }),
        ],
      }),
    );

    expect(screen.getByText('GET, POST')).toBeInTheDocument();
    expect(screen.queryByText(', GET')).not.toBeInTheDocument();
  });
});

describe('WebhookSummary — secure transport', () => {
  it('counts HTTPS case-insensitively and tolerant of surrounding whitespace', () => {
    renderBand(
      makeQuery({
        data: [
          makeWebhook({ id: 1, url: 'HTTPS://a.example/secure' }), // uppercase scheme
          makeWebhook({ id: 2, url: '  https://b.example/padded  ' }), // padded
          makeWebhook({ id: 3, url: 'http://c.example/plain' }), // not secure
        ],
      }),
    );

    // 2 of 3 endpoints are HTTPS once case + whitespace are normalised.
    expect(screen.getByText('2/3')).toBeInTheDocument();
  });

  it('treats a missing url as insecure without crashing', () => {
    renderBand(
      makeQuery({
        data: [
          makeWebhook({ id: 1, url: undefined as unknown as string }),
          makeWebhook({ id: 2, url: 'https://ok.example' }),
        ],
      }),
    );

    expect(screen.getByText('1/2')).toBeInTheDocument(); // secure / total
  });
});

describe('WebhookSummary — empty', () => {
  it('renders zeros and em-dashes (never a blank panel) for no endpoints', () => {
    renderBand(makeQuery({ data: [] }));

    // Labels still render, the band is not the skeleton…
    expect(screen.getByText('Endpoints')).toBeInTheDocument();
    expect(screen.queryByTestId('stat-grid-skeleton')).not.toBeInTheDocument();
    // …the endpoint count is a hard 0 and the three ratios/verbs collapse to —.
    expect(screen.getByText('0')).toBeInTheDocument();
    expect(screen.getAllByText('—')).toHaveLength(3);
    expect(screen.getByRole('region', { name: SECTION })).toBeInTheDocument();
  });
});

describe('WebhookSummary — loading', () => {
  it('swaps the band for a labelled busy skeleton and hides every metric label', () => {
    renderBand(makeQuery({ isLoading: true, data: undefined }));

    const skeleton = screen.getByTestId('stat-grid-skeleton');
    expect(skeleton).toHaveAttribute('aria-busy', 'true');
    for (const label of LABELS) {
      expect(screen.queryByText(label)).not.toBeInTheDocument();
    }
    // The labelled region is preserved so the summary never loses its name.
    expect(screen.getByRole('region', { name: SECTION })).toBeInTheDocument();
  });
});

describe('WebhookSummary — error', () => {
  it('surfaces a retryable QueryError that calls refetch', () => {
    const refetch = vi.fn();
    renderBand(makeQuery({ isError: true, error: new Error('boom'), refetch }));

    // A non-ApiError degrades to the network/unknown branch.
    expect(screen.getByText("Can't reach server")).toBeInTheDocument();
    // None of the metric labels render in the error branch.
    expect(screen.queryByText('Endpoints')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(refetch).toHaveBeenCalledTimes(1);
  });
});

describe('WebhookSummary — null safety', () => {
  it('treats an undefined data payload as empty rather than crashing', () => {
    // Neither loading nor errored, but no data yet — the `?? []` guard must
    // keep the band on the zeroed empty branch instead of iterating undefined.
    renderBand(makeQuery({ data: undefined }));

    expect(screen.getByText('0')).toBeInTheDocument();
    expect(screen.getAllByText('—')).toHaveLength(3);
    expect(screen.getByRole('region', { name: SECTION })).toBeInTheDocument();
  });
});

describe('WebhookSummary — accessibility', () => {
  it('exposes a labelled region and hides its decorative glyphs from a11y tools', () => {
    const { container } = renderBand(makeQuery({ data: LOADED }));

    expect(screen.getByRole('region', { name: SECTION })).toBeInTheDocument();
    // One decorative lucide glyph per card, each hidden from assistive tech.
    const hidden = container.querySelectorAll('[aria-hidden="true"]');
    expect(hidden.length).toBeGreaterThanOrEqual(4);
  });
});
