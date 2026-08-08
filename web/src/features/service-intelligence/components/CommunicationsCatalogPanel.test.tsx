import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

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
});
