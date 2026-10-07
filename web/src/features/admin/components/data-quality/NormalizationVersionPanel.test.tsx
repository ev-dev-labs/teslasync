/**
 * NormalizationVersionPanel — version distribution for the Data Quality page.
 *
 * Contract pinned here:
 *   - the legacy/unknown bucket (`version: null`) renders as "Legacy / unknown"
 *     FIRST and is never collapsed into "v0" — an absent attestation and an
 *     explicit below-contract attestation are different provenance facts;
 *   - a version below `required_version` is badged Unattested even though it
 *     carries a number;
 *   - a null `share_pct` renders "Share unknown" rather than "0.0% of window";
 *   - the panel shell always renders: loading → skeleton, empty → explicit
 *     empty state, error → QueryError with a working Retry. No hidden section.
 */
import type { ReactNode } from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

import { NormalizationVersionPanel } from './NormalizationVersionPanel';
import { ApiError } from '@/lib/resilience';
import type { NormalizationSummary } from '@/types/admin-operator-confidence';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback: string, opts?: Record<string, unknown>) => {
      let out = typeof fallback === 'string' ? fallback : key;
      if (opts) {
        for (const [k, v] of Object.entries(opts)) {
          out = out.replace(new RegExp(`{{\\s*${k}\\s*}}`, 'g'), String(v));
        }
      }
      return out;
    },
  }),
  Trans: ({ children }: { children?: ReactNode }) => <>{children}</>,
  initReactI18next: { type: '3rdParty', init: () => undefined },
}));

vi.mock('@/hooks/useOnlineStatus', () => ({
  useOnlineStatus: () => true,
}));

const SUMMARY: NormalizationSummary = {
  required_version: 1,
  total_sample_count: 1000,
  versioned_sample_count: 600,
  unversioned_sample_count: 400,
  coverage_pct: 60,
  coverage_state: 'measured',
  versions: [
    { version: 2, sample_count: 100, share_pct: 10 },
    { version: 1, sample_count: 500, share_pct: 50 },
    { version: 0, sample_count: 100, share_pct: 10 },
    { version: null, sample_count: 300, share_pct: 30 },
  ],
};

function renderPanel(props: Partial<Parameters<typeof NormalizationVersionPanel>[0]> = {}) {
  return render(
    <MemoryRouter>
      <NormalizationVersionPanel
        normalization={SUMMARY}
        loading={false}
        error={null}
        onRetry={() => {}}
        {...props}
      />
    </MemoryRouter>,
  );
}

describe('NormalizationVersionPanel', () => {
  it('always renders the panel shell and its heading', () => {
    renderPanel({ normalization: undefined });
    expect(screen.getByText('Normalization version distribution')).toBeInTheDocument();
  });

  it('lists the legacy bucket first and never labels it v0', () => {
    renderPanel();
    const items = screen.getAllByRole('listitem');
    expect(within(items[0]).getByText('Legacy / unknown')).toBeInTheDocument();
    // A separate, explicit v0 bucket must still exist and be distinguishable.
    expect(items.map((li) => li.textContent)).toHaveLength(4);
    expect(screen.getByText('v0')).toBeInTheDocument();
    expect(screen.getByText('v1')).toBeInTheDocument();
    expect(screen.getByText('v2')).toBeInTheDocument();
  });

  it('orders remaining buckets ascending by version', () => {
    renderPanel();
    const items = screen.getAllByRole('listitem');
    expect(within(items[1]).getByText('v0')).toBeInTheDocument();
    expect(within(items[2]).getByText('v1')).toBeInTheDocument();
    expect(within(items[3]).getByText('v2')).toBeInTheDocument();
  });

  it('badges legacy and below-contract versions as unattested', () => {
    renderPanel();
    const items = screen.getAllByRole('listitem');
    // legacy (null) and v0 (< required v1) are unattested.
    expect(within(items[0]).getByText('Unattested')).toBeInTheDocument();
    expect(within(items[1]).getByText('Unattested')).toBeInTheDocument();
    // v1 and v2 meet the contract.
    expect(within(items[2]).getByText('Attested')).toBeInTheDocument();
    expect(within(items[3]).getByText('Attested')).toBeInTheDocument();
  });

  it('renders explicit row counts and shares for each bucket', () => {
    renderPanel();
    expect(screen.getByText('300 rows')).toBeInTheDocument();
    expect(screen.getByText('500 rows')).toBeInTheDocument();
    expect(screen.getByText('30.0% of window')).toBeInTheDocument();
    expect(screen.getByText('50.0% of window')).toBeInTheDocument();
  });

  it('renders "Share unknown" instead of a fabricated 0% when share_pct is null', () => {
    renderPanel({
      normalization: {
        ...SUMMARY,
        versions: [{ version: null, sample_count: 0, share_pct: null }],
      },
    });
    expect(screen.getByText('Share unknown')).toBeInTheDocument();
    expect(screen.queryByText('0.0% of window')).not.toBeInTheDocument();
  });

  it('shows an explicit empty state when the window produced no buckets', () => {
    renderPanel({ normalization: { ...SUMMARY, versions: [] } });
    expect(screen.getByText('No version evidence')).toBeInTheDocument();
    expect(
      screen.getByText(/No signal rows were persisted in this window/i),
    ).toBeInTheDocument();
  });

  it('shows a skeleton while the first fetch is in flight', () => {
    const { container } = renderPanel({ normalization: undefined, loading: true });
    expect(screen.queryByRole('listitem')).not.toBeInTheDocument();
    expect(screen.queryByText('No version evidence')).not.toBeInTheDocument();
    // Panel shell still present.
    expect(container.textContent).toContain('Normalization version distribution');
  });

  it('renders the error branch with a working retry and keeps the panel mounted', () => {
    const onRetry = vi.fn();
    renderPanel({ normalization: undefined, error: new ApiError('boom', 500), onRetry });

    expect(screen.getByText('Normalization version distribution')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /retry|try again/i }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});
