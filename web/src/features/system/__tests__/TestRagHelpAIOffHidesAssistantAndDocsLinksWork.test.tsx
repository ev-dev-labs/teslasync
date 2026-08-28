// `TestRagHelpAIOffHidesAssistantAndDocsLinksWork` (the Vitest
// sibling to the Go test of the same name) proves the React-side
// AI-off contract. It mounts the
// AIRAGHelp component with ai_mode='off' (plus the per-feature
// toggle on, to defeat the obvious "off because nothing is
// enabled" path) and asserts:
//
//   1. The AI section's rooted test ID is absent from the DOM.
//   2. The wrapper renders no children (empty container).
//   3. With ai_mode='cloud' AND rag-help=true, the section IS
//      present + carries the expected test ID. This is the
//      positive control that proves the gate actually works
//      (otherwise the "absent in off mode" assertion is
//      trivially true).
//   4. The deterministic baseline curated docs links remain
//      rendered AND clickable in off-mode. This is the load-
//      baseline-coexistence proof — even when the AI
//      surface is hidden, every static help link MUST still
//      appear (ADR-015 §I3).
//
// The HTTP /api/v1/ai/help/query 404-in-off-mode invariant is
// proven by the Go-side TestRagHelpAIOffHidesAssistantAndDocsLinksWork
// in internal/api/ai_rag_help_handler_test.go — the network layer
// does not exist in the React unit-test scope.
//
// File name MUST stay
// `TestRagHelpAIOffHidesAssistantAndDocsLinksWork.test.tsx` —
// the verification command runs
// `vitest --run TestRagHelpAIOffHidesAssistantAndDocsLinksWork`,
// where the positional pattern is matched against the file PATH.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import type { AppSettings } from '@/api/types';

vi.mock('@/hooks/useSettings', () => ({
  useSettings: vi.fn(),
}));

// usePageTitle is a side-effect hook; stub so the test does not
// depend on a real DOM head + i18n init beyond what react-i18next
// already mocks.
vi.mock('@/hooks/usePageTitle', () => ({
  usePageTitle: vi.fn(),
}));

import { useSettings } from '@/hooks/useSettings';
import { AIRAGHelp } from '@/components/ai/AIRAGHelp';
import HelpPage from '@/features/system/pages/HelpPage';

const mockUseSettings = useSettings as unknown as ReturnType<typeof vi.fn>;

// baseSettings is a complete AppSettings with realistic non-AI
// defaults. Per-test cases override `ai_mode` + `ai_features` to
// exercise the off-mode (negative) and on-mode (positive control)
// paths.
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

beforeEach(() => {
  mockUseSettings.mockReset();
});

describe('TestRagHelpAIOffHidesAssistantAndDocsLinksWork (rag-help AI-off contract)', () => {
  it('TestRagHelpAIOffHidesAssistantAndDocsLinksWork: AIRAGHelp renders nothing when ai_mode=off even with the rag-help toggle on', () => {
    // The toggle is intentionally set to true to defeat the
    // shortcut path "the section hides because the feature flag
    // is off". The mode='off' check MUST trump the per-feature
    // toggle (ADR-015 §I7).
    mockUseSettings.mockReturnValue(
      settingsPayload({
        ai_mode: 'off',
        ai_features: { 'rag-help': true },
      }),
    );

    const { container } = render(<AIRAGHelp />);

    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByTestId('ai-feature-rag-help-root')).not.toBeInTheDocument();
  });

  it('TestRagHelpAIOffHidesAssistantAndDocsLinksWork: AIRAGHelp renders nothing when ai_mode=non-off but the rag-help toggle is false', () => {
    // The other half of the gate: even with mode='cloud', a
    // toggle=false MUST hide the surface (per-feature opt-in).
    mockUseSettings.mockReturnValue(
      settingsPayload({
        ai_mode: 'cloud',
        ai_features: { 'rag-help': false },
      }),
    );

    const { container } = render(<AIRAGHelp />);
    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByTestId('ai-feature-rag-help-root')).not.toBeInTheDocument();
  });

  it('TestRagHelpAIOffHidesAssistantAndDocsLinksWork: AIRAGHelp renders the section when ai_mode=cloud AND rag-help toggle is on (positive control)', () => {
    // Without this assertion, the off-mode assertions above are
    // trivially true (they would pass even if the section were
    // permanently hidden by a typo in the registry/HOC).
    mockUseSettings.mockReturnValue(
      settingsPayload({
        ai_mode: 'cloud',
        ai_features: { 'rag-help': true },
      }),
    );

    render(<AIRAGHelp />);
    const root = screen.getByTestId('ai-feature-rag-help-root');
    expect(root).toBeInTheDocument();
    expect(root).toHaveAttribute('data-ai-feature', 'rag-help');
  });

  // --- baseline coexistence (the second half of the test name) ----
  //
  // The HelpPage SPA route renders five curated <Link> cards
  // unconditionally. The off-mode invariant requires that EVERY
  // baseline link survives even when the AI surface vanishes;  // these assertions are the load-bearing baseline-intact proof
  // (ADR-015 §I3).
  //
  // Per-link test IDs are stable: `help-baseline-link-<id>`. The
  // off-mode tests below assert the AIRAGHelp root is absent AND
  // every baseline link is present; the on-mode positive control
  // asserts both are present together (proves they coexist
  // peacefully, not in an either/or rendering branch).

  const expectedBaselineLinkIds = [
    'docs-status-api',
    'onboarding',
    'system-status',
    'search',
    'chatbot',
  ] as const;
  const expectedBaselineLinkHrefs: Record<(typeof expectedBaselineLinkIds)[number], string> = {
    'docs-status-api': '/docs/status-api',
    onboarding: '/onboarding',
    'system-status': '/system-status',
    search: '/search',
    chatbot: '/chatbot',
  };

  // HelpPage now mounts query-backed panels alongside the deterministic
  // baseline (support bundle → /system/version, /system/health). Production
  // always renders it inside the app's QueryClientProvider, so the contract is
  // asserted against the same tree. Retries are off: a failing query must
  // settle immediately rather than hold the render open, since the point of
  // this suite is that the baseline survives regardless of what else fails.
  function renderHelpPage() {
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

  it('TestRagHelpAIOffHidesAssistantAndDocsLinksWork: HelpPage renders every baseline curated link AND hides AIRAGHelp when ai_mode=off', () => {
    mockUseSettings.mockReturnValue(
      settingsPayload({
        ai_mode: 'off',
        ai_features: { 'rag-help': true },
      }),
    );

    renderHelpPage();

    // AI surface MUST be absent.
    expect(screen.queryByTestId('ai-feature-rag-help-root')).not.toBeInTheDocument();

    // Every curated link MUST be present + carry the expected
    // href. Asserting both proves the user can navigate from the
    // off-mode help page to every canonical destination.
    expect(screen.getByTestId('help-baseline-links')).toBeInTheDocument();
    for (const id of expectedBaselineLinkIds) {
      const link = screen.getByTestId(`help-baseline-link-${id}`);
      expect(link).toBeInTheDocument();
      expect(link).toHaveAttribute('href', expectedBaselineLinkHrefs[id]);
    }
  });

  it('TestRagHelpAIOffHidesAssistantAndDocsLinksWork: HelpPage renders the AI section AND every baseline curated link when ai_mode=cloud AND rag-help=true', () => {
    mockUseSettings.mockReturnValue(
      settingsPayload({
        ai_mode: 'cloud',
        ai_features: { 'rag-help': true },
      }),
    );

    renderHelpPage();

    // AI surface MUST be present.
    expect(screen.getByTestId('ai-feature-rag-help-root')).toBeInTheDocument();

    // Every curated link MUST also be present — proves the AI
    // section is layered ALONGSIDE the baseline, not instead of
    // it.
    for (const id of expectedBaselineLinkIds) {
      const link = screen.getByTestId(`help-baseline-link-${id}`);
      expect(link).toBeInTheDocument();
      expect(link).toHaveAttribute('href', expectedBaselineLinkHrefs[id]);
    }
  });
});
