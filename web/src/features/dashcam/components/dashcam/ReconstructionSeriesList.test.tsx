import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { APPLICATION_DESIGNS, getAppDesignAttributes, observeAppDesignScopes } from '@/components/ui/app-designs/designs';
import { expectAppDesignDataMode } from '@/components/feedback/appDesignCss.test-utils';
import { PACK_IDS } from '@/features/dashboard/widgets/designPacks/types';
import type { AlignedSignalSeries } from '../../lib/timelineAlignment';
import { ReconstructionSeriesList } from './ReconstructionSeriesList';

const series: AlignedSignalSeries[] = [
  {
    signal: 'UnknownUnitSignalWithLongIdentity', coverage: 'partial',
    points: [
      { atSeconds: -2, timestamp: '2026-10-06T00:00:00Z', value: 0 },
      { atSeconds: 65, timestamp: '2026-10-06T00:01:07Z', value: false },
    ],
    gapNotes: ['Original recorded gap, not an interpolated sample.'],
  },
  { signal: 'Absent', coverage: 'none', points: [], gapNotes: ['No received samples.'] },
];

describe('reconstruction series native records', () => {
  it.each(PACK_IDS)('%s owns the actual coverage records while keeping raw samples and gap evidence', pack => {
    const original = JSON.stringify(series);
    const { container } = render(<div data-app-design-preview="" {...getAppDesignAttributes(pack)}>
      <ReconstructionSeriesList series={series} />
    </div>);
    const release = observeAppDesignScopes(container.firstElementChild!);
    try {
      const records = screen.getAllByRole('listitem');
      expect(records).toHaveLength(2);
      for (const record of records) {
        expect(record).toHaveAttribute('data-surface-variant', 'standalone');
        expectAppDesignDataMode(record, APPLICATION_DESIGNS[pack].data, '[data-app-card-kind="record"]');
        expectAppDesignDataMode(record.querySelector('[data-app-part~="record-title"]')!,
          APPLICATION_DESIGNS[pack].data, '[data-app-card-kind="record"]');
      }
      const body = records[0].querySelector(':scope > [data-app-part~="record-body"]')!;
      expectAppDesignDataMode(body, APPLICATION_DESIGNS[pack].data, '[data-app-card-kind="record"]');
      expect(body).toHaveTextContent('First: 0 at t=-2.00s · last: false at t=65.00s');
      expect(within(records[0]).getByText('2 sample(s)')).toBeInTheDocument();
      expect(within(records[1]).getByText('0 sample(s)')).toBeInTheDocument();
      expect(within(records[1]).queryByText(/First:/)).toBeNull();
      expect(screen.getByText(series[0].gapNotes[0])).toBeInTheDocument();
      expect(screen.getByText(series[1].gapNotes[0])).toBeInTheDocument();
      expect(container.querySelector('[data-app-part~="metric-unit"], [role="meter"], [data-metric-fill]')).toBeNull();
      expect(JSON.stringify(series)).toBe(original);
    } finally { release(); }
  });

  it('does not create records for an absent series list or inherit an outer profile across a neutral boundary', () => {
    const { container, rerender } = render(<ReconstructionSeriesList series={[]} />);
    expect(container).toBeEmptyDOMElement();
    rerender(<div data-app-design-preview="" {...getAppDesignAttributes('v2')}>
      <div data-app-design-preview="" data-testid="neutral"><ReconstructionSeriesList series={series} /></div>
      <div data-app-design-preview="" {...getAppDesignAttributes('terminal')} data-testid="nested">
        <ReconstructionSeriesList series={series} />
      </div>
    </div>);
    const release = observeAppDesignScopes(container.firstElementChild!);
    try {
      expect(screen.getByTestId('neutral').querySelector('[data-app-design-owner]')).toBeNull();
      const record = screen.getByTestId('nested').querySelector('[data-app-card-kind="record"]')!;
      expectAppDesignDataMode(record, 'ledger', '[data-app-card-kind="record"]');
    } finally { release(); }
  });
});
