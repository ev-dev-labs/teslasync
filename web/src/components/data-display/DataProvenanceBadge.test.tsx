import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';

import { DataProvenanceBadge } from './DataProvenanceBadge';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback: string) => fallback,
  }),
  Trans: ({ children }: { children?: ReactNode }) => <>{children}</>,
  initReactI18next: { type: '3rdParty', init: () => undefined },
}));

describe('DataProvenanceBadge', () => {
  it('labels every provenance distinctly', () => {
    const cases = [
      ['live', 'Live'],
      ['cached', 'Cached'],
      ['historical', 'Historical'],
      ['inferred', 'Estimated'],
      ['repaired', 'Repaired'],
      ['unknown', 'Unknown source'],
    ] as const;

    for (const [provenance, label] of cases) {
      const { unmount } = render(<DataProvenanceBadge provenance={provenance} />);
      expect(screen.getByText(label)).toBeInTheDocument();
      unmount();
    }
  });

  it('never claims an unknown-origin value is live', () => {
    render(<DataProvenanceBadge provenance="unknown" />);
    expect(screen.queryByText('Live')).toBeNull();
    expect(screen.getByText('Unknown source')).toBeInTheDocument();
  });

  it('marks an estimate as an estimate rather than a measurement', () => {
    render(<DataProvenanceBadge provenance="inferred" />);
    const badge = screen.getByLabelText('Estimated');
    expect(badge).toHaveAttribute('data-provenance', 'inferred');
    expect(badge.getAttribute('title')).toMatch(/did not report this value directly/i);
  });

  it('exposes provenance and status as separate data attributes', () => {
    render(<DataProvenanceBadge provenance="live" status="stale" />);
    const badge = screen.getByLabelText('Live');
    // Provenance is NOT rewritten by a degraded status — only toned down.
    expect(badge).toHaveAttribute('data-provenance', 'live');
    expect(badge).toHaveAttribute('data-data-status', 'stale');
  });

  it('defaults the status attribute to ok when none is supplied', () => {
    render(<DataProvenanceBadge provenance="historical" />);
    expect(screen.getByLabelText('Historical')).toHaveAttribute('data-data-status', 'ok');
  });

  it('appends the snapshot time when the capture instant is known', () => {
    render(<DataProvenanceBadge provenance="cached" updatedAt={1_700_000_000_000} />);
    expect(screen.getByLabelText('Cached').getAttribute('title')).toMatch(/Last updated/);
  });

  it('omits the snapshot time rather than inventing "now" when unknown', () => {
    render(<DataProvenanceBadge provenance="cached" updatedAt={null} />);
    expect(screen.getByLabelText('Cached').getAttribute('title')).not.toMatch(/Last updated/);
  });

  it('falls back to the unknown config for an out-of-union value', () => {
    // Provenance often arrives from an API string; a value outside the union
    // must fail closed to "unknown", never to "live".
    render(<DataProvenanceBadge provenance={'bogus' as never} />);
    expect(screen.getByText('Unknown source')).toBeInTheDocument();
  });
});
