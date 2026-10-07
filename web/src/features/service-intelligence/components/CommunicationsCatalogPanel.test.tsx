import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/hooks/useSettings', () => ({
  useSettings: () => ({
    settings: { locale: 'en-US', decimal_precision: 2, currency_symbol: '$' },
    settingsUnavailable: false,
  }),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (
      key: string,
      fallback?: unknown,
      variables?: Record<string, string | number>,
    ) => {
      if (typeof fallback !== 'string') return key;
      return Object.entries(variables ?? {}).reduce(
        (value, [name, replacement]) =>
          value.replace(`{{${name}}}`, String(replacement)),
        fallback,
      );
    },
  }),
}));

import {
  OFFICIAL_NHTSA_COMMUNICATION_ARTIFACTS,
  type CommunicationsCatalogStatus,
} from '@/api/hooks/useServiceIntelligence';
import {
  CommunicationsCatalogPanel,
  communicationsCatalogFreshness,
} from './CommunicationsCatalogPanel';

function successfulStatus(completedAt: string): CommunicationsCatalogStatus {
  const imported = {
    id: 5,
    artifact_url: OFFICIAL_NHTSA_COMMUNICATION_ARTIFACTS[4].url,
    source_etag: '"catalog-v1"',
    source_last_modified: 'Tue, 05 Aug 2026 00:00:00 GMT',
    artifact_sha256: 'a'.repeat(64),
    status: 'succeeded' as const,
    total_rows: 1000,
    imported_rows: 188,
    rejected_rows: 0,
    not_modified: false,
    error_detail: null,
    started_at: '2026-08-05T06:00:00Z',
    completed_at: completedAt,
  };
  return {
    latest_attempt: imported,
    latest_successful: imported,
    record_count: 321,
  };
}

const baseProps = {
  loading: false,
  error: null,
  importing: false,
  importingArtifactURL: null,
  importError: null,
  onRetry: vi.fn(),
  onImport: vi.fn(),
};

describe('CommunicationsCatalogPanel', () => {
  it('retains last-success counts and provenance when a later import fails, rather than relabeling the catalog unimported', () => {
    const status = successfulStatus(new Date(Date.now() - 60_000).toISOString());
    status.latest_attempt = {
      ...status.latest_successful!,
      id: 6,
      artifact_url: OFFICIAL_NHTSA_COMMUNICATION_ARTIFACTS[0].url,
      status: 'failed',
      imported_rows: 0,
      error_detail: 'The latest artifact failed; the previous import remains active.',
    };
    render(<CommunicationsCatalogPanel {...baseProps} status={status} />);
    expect(screen.getByText('321')).toBeInTheDocument();
    expect(screen.getByText('1000 source rows')).toBeInTheDocument();
    expect(screen.getByText('188 Tesla rows')).toBeInTheDocument();
    expect(screen.getByText('0 rejected')).toBeInTheDocument();
    expect(screen.getByText('Latest import failed')).toBeInTheDocument();
    expect(screen.getByText(status.latest_attempt.error_detail!)).toBeInTheDocument();
    expect(screen.getByText('Fresh')).toBeInTheDocument();
    expect(screen.queryByText('TSB catalog is not populated')).not.toBeInTheDocument();
    expect(screen.getByTitle('a'.repeat(64))).toHaveTextContent('SHA-256 aaaaaaaaaaaa…');
    expect(screen.getByRole('button', { name: 'Import official NHTSA artifact for 2025–2026' }))
      .toHaveTextContent('Refresh');
  });

  it('disables all import periods while identifying only the pending period as busy, then restores the same actions', () => {
    const onImport = vi.fn();
    const status = successfulStatus(new Date().toISOString());
    const pending = OFFICIAL_NHTSA_COMMUNICATION_ARTIFACTS[2];
    const view = render(
      <CommunicationsCatalogPanel {...baseProps} status={status} onImport={onImport}
        importing importingArtifactURL={pending.url} />,
    );
    const actions = screen.getAllByRole('button', { name: /Import official NHTSA artifact/ });
    expect(actions).toHaveLength(5);
    for (const action of actions) expect(action).toBeDisabled();
    expect(actions.filter((action) => action.getAttribute('aria-busy') === 'true')).toHaveLength(1);
    const button = screen.getByRole('button', { name: `Import official NHTSA artifact for ${pending.period}` });
    expect(button).toHaveAttribute('aria-busy', 'true');
    fireEvent.click(button);
    expect(onImport).not.toHaveBeenCalled();
    view.rerender(<CommunicationsCatalogPanel {...baseProps} status={status} onImport={onImport} />);
    fireEvent.click(screen.getByRole('button', { name: `Import official NHTSA artifact for ${pending.period}` }));
    expect(onImport).toHaveBeenCalledOnce();
    expect(onImport).toHaveBeenCalledWith(pending.url);
  });

  it('makes initial catalog failure retryable without inventing a zero-count catalog or an import opportunity', () => {
    const onRetry = vi.fn();
    const view = render(
      <MemoryRouter>
        <CommunicationsCatalogPanel {...baseProps} status={null} error={new Error('catalog unavailable')} onRetry={onRetry} />
      </MemoryRouter>,
    );
    expect(screen.getByText('This source could not be loaded.')).toBeInTheDocument();
    expect(screen.queryByText('Normalized Tesla records')).not.toBeInTheDocument();
    expect(screen.queryByText('TSB catalog is not populated')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Import official NHTSA artifact/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(onRetry).toHaveBeenCalledOnce();
    view.rerender(
      <MemoryRouter>
        <CommunicationsCatalogPanel {...baseProps} status={successfulStatus(new Date().toISOString())} onRetry={onRetry} />
      </MemoryRouter>,
    );
    expect(screen.getByText('321')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /Import official NHTSA artifact/ })).toHaveLength(5);
  });

  it('shows prior official evidence and all actions beside an import error without changing freshness', () => {
    render(
      <CommunicationsCatalogPanel {...baseProps}
        status={successfulStatus(new Date().toISOString())}
        importError={new Error('Administrator authorization denied')} />,
    );
    expect(screen.getByText('Catalog import failed')).toBeInTheDocument();
    expect(screen.getByText('Administrator authorization denied')).toBeInTheDocument();
    expect(screen.getByText('321')).toBeInTheDocument();
    expect(screen.getByText('Fresh')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /Import official NHTSA artifact/ })).toHaveLength(5);
  });

  it.each([
    [8 * 24 * 60 * 60 * 1000 - 1, 'fresh'],
    [8 * 24 * 60 * 60 * 1000, 'stale'],
    [8 * 24 * 60 * 60 * 1000 + 1, 'stale'],
  ] as const)('retains the eight-day freshness boundary at age %i ms', (age, expected) => {
    const now = Date.parse('2026-08-15T08:00:00Z');
    expect(communicationsCatalogFreshness(successfulStatus(new Date(now - age).toISOString()), now))
      .toBe(expected);
  });

  it('shows catalog counts, freshness, all official periods, and imports by allow-listed URL', () => {
    const onImport = vi.fn();
    const now = Date.now();
    render(
      <CommunicationsCatalogPanel
        {...baseProps}
        status={successfulStatus(new Date(now - 60_000).toISOString())}
        onImport={onImport}
      />,
    );

    expect(screen.getByText('321')).toBeInTheDocument();
    expect(screen.getByText('Fresh')).toBeInTheDocument();
    for (const artifact of OFFICIAL_NHTSA_COMMUNICATION_ARTIFACTS) {
      expect(screen.getByText(artifact.period)).toBeInTheDocument();
    }

    fireEvent.click(
      screen.getByRole('button', {
        name: 'Import official NHTSA artifact for 2005–2009',
      }),
    );
    expect(onImport).toHaveBeenCalledWith(
      OFFICIAL_NHTSA_COMMUNICATION_ARTIFACTS[0].url,
    );
  });

  it('renders a complete empty state before the first successful import', () => {
    render(
      <CommunicationsCatalogPanel
        {...baseProps}
        status={{
          latest_attempt: null,
          latest_successful: null,
          record_count: 0,
        }}
      />,
    );

    expect(screen.getByText('TSB catalog is not populated')).toBeInTheDocument();
    expect(screen.getByText('Not imported')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /Import official NHTSA artifact/ })).toHaveLength(5);
  });

  it('classifies missing, fresh, and stale catalog status defensively', () => {
    const now = Date.parse('2026-08-05T08:00:00Z');
    expect(communicationsCatalogFreshness(null, now)).toBe('unavailable');
    expect(
      communicationsCatalogFreshness(
        successfulStatus('2026-08-05T07:00:00Z'),
        now,
      ),
    ).toBe('fresh');
    expect(
      communicationsCatalogFreshness(
        successfulStatus('2026-07-20T07:00:00Z'),
        now,
      ),
    ).toBe('stale');
  });

  it('uses the real compact brief and drawer without treating configured periods as imported coverage', () => {
    const view = render(
      <CommunicationsCatalogPanel {...baseProps} status={successfulStatus(new Date().toISOString())} />,
    );
    const brief = screen.getByTestId('service-intelligence-catalog-summary');
    expect(brief).toHaveAttribute('data-operational-brief');
    const records = brief.querySelector('[data-operational-metric="normalized-tesla-records"]');
    const periods = brief.querySelector('[data-operational-metric="official-period-artifacts"]');
    expect(records).toHaveAttribute('data-value-state', 'value');
    expect(records?.querySelector('[data-operational-value]')).toHaveTextContent('321');
    expect(periods?.querySelector('[data-operational-value]')).toHaveTextContent('5');
    fireEvent.click(within(brief).getByRole('button', { name: 'Review details' }));
    const drawer = screen.getByRole('dialog', { name: 'Catalog coverage summary details' });
    expect(within(drawer).getByText('Allow-listed official periods available to import, not proof that every period has been imported.')).toBeInTheDocument();
    expect(within(drawer).getByText('Official NHTSA bulk artifacts. Freshness follows the last successful import; a failed later attempt does not replace retained records.')).toBeInTheDocument();
    fireEvent.keyDown(drawer, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /Import official NHTSA artifact/ })).toHaveLength(5);
    view.rerender(
      <CommunicationsCatalogPanel {...baseProps} status={{ latest_attempt: null, latest_successful: null, record_count: 0 }} />,
    );
    expect(screen.getByTestId('service-intelligence-catalog-summary')
      .querySelector('[data-operational-metric="normalized-tesla-records"] [data-operational-value]')).toHaveTextContent('0');
    expect(screen.getByText('Not imported')).toBeInTheDocument();
  });

  it('keeps unknown catalog counts missing and rejects invalid counts instead of inventing zero', () => {
    const view = render(<CommunicationsCatalogPanel {...baseProps} status={null} />);
    expect(screen.getByTestId('service-intelligence-catalog-summary')
      .querySelector('[data-operational-metric="normalized-tesla-records"]')).toHaveAttribute('data-value-state', 'missing');
    view.rerender(
      <CommunicationsCatalogPanel {...baseProps} status={{ latest_attempt: null, latest_successful: null, record_count: -1 }} />,
    );
    expect(screen.getByTestId('service-intelligence-catalog-summary')
      .querySelector('[data-operational-metric="normalized-tesla-records"]')).toHaveAttribute('data-value-state', 'invalid');
    expect(screen.getAllByRole('button', { name: /Import official NHTSA artifact/ })).toHaveLength(5);
  });
});
