import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { OperationalBrief } from '@/components/data-display/OperationalBrief';
import { assertOperationalBriefDisclosure, assertOperationalMetricUnavailable } from './operationalBriefAssertions';

function mount(statusLabel = 'Retained evidence') {
  return render(<div data-testid="outer">
    <OperationalBrief title="Recorded evidence" statusLabel={statusLabel} testId="brief"
      metrics={[{ key: 'zero', label: 'Measured zero', value: '0', valueState: 'value' }]} />
  </div>);
}

describe('evidence disclosure assertion utility', () => {
  it('opens the real drawer from one brief and leaves the measured card value intact', () => {
    mount();
    assertOperationalBriefDisclosure(screen.getByTestId('brief'), 'Retained evidence');
    expect(screen.getByText('0')).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('accepts one enclosing surface and preserves negative assertions', () => {
    mount();
    assertOperationalBriefDisclosure(screen.getByTestId('outer'), 'Returned evidence', { absent: true });
    assertOperationalBriefDisclosure(screen.getByTestId('outer'), 'Retained', { contains: true });
  });

  it('fails a wrong positive assertion and closes the drawer afterward', () => {
    mount();
    expect(() => assertOperationalBriefDisclosure(screen.getByTestId('brief'), 'Returned evidence')).toThrow();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('fails a wrong negative assertion', () => {
    mount();
    expect(() => assertOperationalBriefDisclosure(screen.getByTestId('brief'), 'Retained evidence', { absent: true })).toThrow();
  });

  it('rejects a surface without an evidence card', () => {
    render(<div data-testid="source-notice">Returned evidence</div>);
    expect(() => assertOperationalBriefDisclosure(screen.getByTestId('source-notice'), 'Returned evidence'))
      .toThrow(/exactly one evidence card/);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('rejects an ambiguous surface containing two evidence cards', () => {
    render(<div data-testid="two">
      <OperationalBrief title="First source" metrics={[]} />
      <OperationalBrief title="Second source" metrics={[]} />
    </div>);
    expect(() => assertOperationalBriefDisclosure(screen.getByTestId('two'), 'Returned evidence'))
      .toThrow(/exactly one evidence card/);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});

describe('unavailable operational metric assertion', () => {
  function mountReadings(loading = false, allMissing = false) {
    return render(<OperationalBrief title="Returned measurements" testId="measurements" metrics={[
      ...(!allMissing ? [{ key: 'zero', label: 'Measured zero', value: '0', valueState: 'value' as const }] : []),
      { key: 'missing', label: 'Unreported reading', value: '—', valueState: 'missing', rawValue: null, loading },
    ]} />);
  }

  it('requires omitted evidence in both surfaces and preserves measured zero', () => {
    mountReadings();
    assertOperationalMetricUnavailable(screen.getByTestId('measurements'), 'Unreported reading');
    expect(screen.getByText('0')).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('rejects treating a measured zero as unavailable', () => {
    mountReadings();
    expect(() => assertOperationalMetricUnavailable(screen.getByTestId('measurements'), 'Measured zero')).toThrow();
  });

  it('rejects treating a pending source as a resolved unavailable value', () => {
    mountReadings(true);
    expect(() => assertOperationalMetricUnavailable(screen.getByTestId('measurements'), 'Unreported reading')).toThrow();
  });

  it('retains an explanatory surface when no readings are available', () => {
    mountReadings(false, true);
    assertOperationalMetricUnavailable(screen.getByTestId('measurements'), 'Unreported reading');
    expect(screen.getByText('Values will appear when the source provides measurements.')).toBeInTheDocument();
  });
});
