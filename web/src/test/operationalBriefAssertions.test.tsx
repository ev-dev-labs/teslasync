import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { OperationalBrief } from '@/components/data-display/OperationalBrief';
import { assertOperationalBriefDisclosure } from './operationalBriefAssertions';

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
