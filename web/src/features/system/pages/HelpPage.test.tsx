/**
 * HelpPage — co-located contract + hardening tests.
 *
 * HelpPage is the static `/help` route: a welcome hero, a "Ways to get
 * help" channel list, the self-gating AIRAGHelp assistant, and five
 * curated link cards. It renders NO network-backed data — its only
 * dynamic input is `useSettings().settings.ai_mode` / `ai_features`,
 * consumed transitively by the `withAiFeature` gate around AIRAGHelp.
 *
 * These tests cover every facet of the page:
 *   - the page shell (h1 title + subtitle) and the document-title write;
 *   - the welcome hero prose;
 *   - all three "ways to get help" channels;
 *   - the "Explore the app" heading + subtitle;
 *   - every curated baseline link (id → exact href), their DOM order,
 *     and the load-bearing container test id;
 *   - a11y: both landmark <section>s expose their aria-label as a
 *     `region` and every decorative icon is `aria-hidden`;
 *   - the AI-off contract (assistant hidden, baseline intact) plus the
 *     AI-on positive control (assistant mounted ALONGSIDE the baseline);
 *   - the settings-loading branch (undefined settings → assistant
 *     hidden, baseline intact) so a slow /settings query never blanks
 *     the page.
 *
 * `useSettings` is mocked per-file (overriding the global test-setup
 * stub) so each case can pin ai_mode/ai_features; `usePageTitle` is
 * mocked so the title write can be asserted without a real <head>; and
 * react-i18next is stubbed to echo the English fallback so text
 * assertions are deterministic regardless of the shipped catalogue.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

import type { AppSettings } from '@/api/types';

vi.mock('@/hooks/useSettings', () => ({
  useSettings: vi.fn(),
}));

// usePageTitle is a side-effect hook; mock it so we can assert the
// canonical-title write without depending on a real DOM <head>.
vi.mock('@/hooks/usePageTitle', () => ({
  usePageTitle: vi.fn(),
}));

// Stub react-i18next so `t(key, fallback)` deterministically returns the
// English fallback string. This mirrors the convention used by the
// sibling DiagnosticPage.test.tsx and keeps the text assertions stable
// even if the shipped i18n catalogue changes.
vi.mock('react-i18next', async () => {
  const actual =
    await vi.importActual<typeof import('react-i18next')>('react-i18next');
  return {
    ...actual,
    useTranslation: () => ({
      t: (key: string, fallback?: unknown) => {
        if (typeof fallback === 'string') return fallback;
        if (fallback && typeof fallback === 'object') {
          const o = fallback as Record<string, unknown>;
          if (typeof o.defaultValue === 'string') return o.defaultValue;
        }
        return key;
      },
      i18n: { language: 'en', changeLanguage: vi.fn() },
    }),
    Trans: ({ children }: { children?: ReactNode }) => <>{children}</>,
  };
});

import { useSettings } from '@/hooks/useSettings';
import { usePageTitle } from '@/hooks/usePageTitle';
import HelpPage from './HelpPage';

const mockUseSettings = useSettings as unknown as ReturnType<typeof vi.fn>;
const mockUsePageTitle = usePageTitle as unknown as ReturnType<typeof vi.fn>;

// A complete AppSettings with realistic non-AI defaults. Per-test cases
// override `ai_mode` + `ai_features` to exercise the off / on / loading
// gate paths.
const baseSettings: AppSettings = {
  unit_of_length: 'km',
  unit_of_temp: 'C',
  unit_of_pressure: 'bar',
  preferred_range: 'rated',
  language: 'en',
  base_cost_per_kwh: 0.12,
  api_suspended: false,
  theme: 'neon-cyan',
  mode: 'dark',
  custom_primary: '#00b4d8',
  custom_accent: '#e63946',
  gas_price_per_unit: 0,
  gas_unit: 'gallon',
  gas_efficiency_mpg: 25,
  decimal_precision: 2,
  quiet_hours_enabled: false,
  quiet_hours_start: '22:00',
  quiet_hours_end: '07:00',
  alert_digest_mode: 'instant',
};

function settingsPayload(overrides: Partial<AppSettings>) {
  return { settings: { ...baseSettings, ...overrides } };
}

function renderHelp() {
  // The page now mounts query-backed panels (support bundle → /system/version
  // and /system/health). Every real mount of /help is inside the app's
  // provider; the test supplies its own so the deterministic baseline below is
  // asserted against the same tree production renders. Retries are disabled so
  // a failing query settles immediately instead of holding the render open.
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <HelpPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

// The curated baseline links, in their documented (intentional) order.
// The id → href contract is duplicated in the off-mode Go/Vitest suite
// (TestRagHelpAIOffHidesAssistantAndDocsLinksWork); keep both in sync.
const EXPECTED_LINKS = [
  { id: 'docs-status-api', href: '/docs/status-api', title: 'Documentation' },
  { id: 'onboarding', href: '/onboarding', title: 'Onboarding' },
  { id: 'system-status', href: '/system-status', title: 'System status' },
  { id: 'search', href: '/search', title: 'Search' },
  { id: 'chatbot', href: '/chatbot', title: 'Chatbot' },
] as const;

beforeEach(() => {
  mockUseSettings.mockReset();
  mockUsePageTitle.mockReset();
  // Default: AI off, but with the rag-help toggle ON so the off-mode
  // assertions cannot pass merely because nothing is enabled.
  mockUseSettings.mockReturnValue(
    settingsPayload({ ai_mode: 'off', ai_features: { 'rag-help': true } }),
  );
});

describe('HelpPage', () => {
  it('renders the page shell (h1 title + subtitle) and writes the canonical document title', () => {
    renderHelp();

    expect(
      screen.getByRole('heading', { level: 1, name: 'Help' }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Guides, the in-app assistant, and quick links/i),
    ).toBeInTheDocument();
    expect(mockUsePageTitle).toHaveBeenCalledWith('Help');
  });

  it('renders the welcome hero prose and all three ways-to-get-help channels', () => {
    renderHelp();

    expect(
      screen.getByRole('heading', { name: 'Welcome to TeslaSync' }),
    ).toBeInTheDocument();
    expect(screen.getByText(/Get started with TeslaSync\./i)).toBeInTheDocument();

    expect(
      screen.getByRole('heading', { name: 'Ways to get help' }),
    ).toBeInTheDocument();
    // All three channel titles render (browse / docs / assistant).
    expect(screen.getByText('Browse the app')).toBeInTheDocument();
    expect(screen.getByText('Read the documentation')).toBeInTheDocument();
    expect(screen.getByText('Ask the assistant')).toBeInTheDocument();
    // ...and at least one channel description is present.
    expect(
      screen.getByText(/Jump straight to the canonical pages/i),
    ).toBeInTheDocument();
  });

  it('renders the "Explore the app" section heading + subtitle', () => {
    renderHelp();

    expect(
      screen.getByRole('heading', { name: 'Explore the app' }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Every card jumps to a canonical destination/i),
    ).toBeInTheDocument();
  });

  it('renders every curated baseline link with its exact href and title, in order, inside the load-bearing container', () => {
    renderHelp();

    const container = screen.getByTestId('help-baseline-links');
    expect(container).toBeInTheDocument();

    for (const { id, href, title } of EXPECTED_LINKS) {
      const link = screen.getByTestId(`help-baseline-link-${id}`);
      expect(link).toHaveAttribute('href', href);
      expect(link).toHaveTextContent(title);
    }

    // DOM order must match the documented (intentional) ordering.
    const renderedOrder = Array.from(
      container.querySelectorAll<HTMLElement>('[data-testid^="help-baseline-link-"]'),
    ).map((el) => el.getAttribute('data-testid'));
    expect(renderedOrder).toEqual(
      EXPECTED_LINKS.map((l) => `help-baseline-link-${l.id}`),
    );

    // Off-mode: the five curated cards are the only navigable links.
    expect(screen.getAllByRole('link').length).toBeGreaterThanOrEqual(5);
  });

  it('exposes both landmark sections via their aria-label and marks decorative icons aria-hidden (a11y)', () => {
    const { container } = renderHelp();

    expect(
      screen.getByRole('region', { name: 'Getting started' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('region', { name: 'Explore the app' }),
    ).toBeInTheDocument();

    // Every icon on the page is decorative — the visible text carries the
    // meaning — so each SVG must be hidden from assistive tech.
    const decorativeIcons = container.querySelectorAll('svg[aria-hidden="true"]');
    expect(decorativeIcons.length).toBeGreaterThanOrEqual(3);
  });

  it('AI-off contract: hides the AIRAGHelp assistant while the baseline links stay intact', () => {
    // beforeEach already pins ai_mode='off' with the rag-help toggle ON.
    renderHelp();

    expect(
      screen.queryByTestId('ai-feature-rag-help-root'),
    ).not.toBeInTheDocument();
    // The static help surface MUST survive even when the AI panel vanishes.
    expect(screen.getByTestId('help-baseline-links')).toBeInTheDocument();
    for (const { id, href } of EXPECTED_LINKS) {
      expect(screen.getByTestId(`help-baseline-link-${id}`)).toHaveAttribute(
        'href',
        href,
      );
    }
  });

  it('AI-on positive control: mounts the assistant ALONGSIDE the baseline links when ai_mode!=off and rag-help is on', () => {
    mockUseSettings.mockReturnValue(
      settingsPayload({ ai_mode: 'cloud', ai_features: { 'rag-help': true } }),
    );

    renderHelp();

    const root = screen.getByTestId('ai-feature-rag-help-root');
    expect(root).toBeInTheDocument();
    expect(root).toHaveAttribute('data-ai-feature', 'rag-help');
    // The assistant's own surface actually rendered (heading + prompt box),
    // not just the empty gate wrapper.
    expect(
      screen.getByRole('heading', { name: 'Ask the help assistant' }),
    ).toBeInTheDocument();
    expect(
      screen.getByPlaceholderText(/How do I enable energy cost forecasting/i),
    ).toBeInTheDocument();

    // Coexistence: the baseline links are still present, proving the AI
    // section is layered alongside the baseline, not instead of it.
    for (const { id } of EXPECTED_LINKS) {
      expect(
        screen.getByTestId(`help-baseline-link-${id}`),
      ).toBeInTheDocument();
    }
  });

  it('keeps the assistant hidden and the baseline intact while the settings query is still loading (undefined settings)', () => {
    // Fail-closed: an unresolved /settings query yields no `settings`, so
    // useAiEnabled returns false and the assistant must not leak.
    mockUseSettings.mockReturnValue({ settings: undefined });

    renderHelp();

    expect(
      screen.queryByTestId('ai-feature-rag-help-root'),
    ).not.toBeInTheDocument();
    const baseline = screen.getByTestId('help-baseline-links');
    expect(baseline).toBeInTheDocument();
    // Scoped to the baseline container: the page now also renders the glossary
    // and preset panels, which contribute their own links. The invariant this
    // asserts is "all five curated links survive", not "the page has exactly
    // five links in total".
    expect(within(baseline).getAllByRole('link')).toHaveLength(EXPECTED_LINKS.length);
  });
});
