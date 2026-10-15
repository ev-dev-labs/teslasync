import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { VehicleMatchPanel } from './VehicleMatchPanel';
import { serviceReport } from '../pages/ServiceIntelligencePage.closure.fixtures';

vi.mock('@/hooks/useSettings', () => ({
  useSettings: () => ({
    settings: { locale: 'en-US', decimal_precision: 2, currency_symbol: '$' },
    settingsUnavailable: false,
  }),
}));

const props = {
  selected: true,
  loading: false,
  error: null,
  context: serviceReport.vehicle_context,
  summary: serviceReport.summary,
  generatedAt: serviceReport.generated_at,
  sources: serviceReport.sources,
  onRetry: vi.fn(),
};

describe('VehicleMatchPanel OperationalBrief source preservation', () => {
  it('retains raw source counts and source-specific confidence context in the real Review drawer', () => {
    render(<VehicleMatchPanel {...props} retained />);
    const brief = screen.getByTestId('service-intelligence-summary');
    expect(brief).toHaveAttribute('data-operational-brief');
    expect(within(brief).getByText('Retained report')).toBeInTheDocument();
    for (const [key, value] of [
      ['recall-candidates', '1'], ['potentially-applicable', '1'],
      ['manufacturer-communications', '1'], ['symptom-matches', '2'],
    ]) {
      const metric = brief.querySelector(`[data-operational-metric="${key}"]`);
      expect(metric).toHaveAttribute('data-value-state', 'value');
      expect(metric?.querySelector('[data-operational-value]')).toHaveTextContent(value);
    }
    expect(screen.getByText(serviceReport.vehicle_context.build_match_basis)).toBeInTheDocument();
    const review = within(brief).getByRole('button', { name: 'Review details' });
    review.focus();
    fireEvent.click(review);
    const drawer = screen.getByRole('dialog', { name: 'Service match summary details' });
    expect(within(drawer).getByText('Returned applicability hypotheses; campaign completion remains unknown.')).toBeInTheDocument();
    expect(within(drawer).getByText('Maintenance retrieval is unavailable; absence is not completion evidence.')).toBeInTheDocument();
    expect(within(drawer).getByText('Retained official import remains available.')).toBeInTheDocument();
    expect(within(drawer).getByText('Normalized cache')).toBeInTheDocument();
    expect(within(drawer).getByText('Decoded vehicle context, NHTSA records, and observed signals. Retrieval freshness is source-specific; counts do not establish eligibility or completion.')).toBeInTheDocument();
    fireEvent.keyDown(drawer, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(within(brief).getByRole('button', { name: 'Review details' })).toHaveFocus();
  });

  it('distinguishes missing summaries, measured zero, and invalid returned counts', () => {
    const view = render(<VehicleMatchPanel {...props} summary={null} />);
    let brief = screen.getByTestId('service-intelligence-summary');
    expect(within(brief).getByText('Summary unavailable')).toBeInTheDocument();
    for (const metric of brief.querySelectorAll('[data-operational-metric]')) {
      expect(metric).toHaveAttribute('data-value-state', 'missing');
      expect(metric.querySelector('[data-operational-value]')).not.toHaveTextContent(/^0$/);
    }
    view.rerender(<VehicleMatchPanel {...props} summary={{ ...serviceReport.summary, recall_candidates: 0, symptom_matches: -1 }} />);
    brief = screen.getByTestId('service-intelligence-summary');
    expect(brief.querySelector('[data-operational-metric="recall-candidates"]')).toHaveAttribute('data-value-state', 'value');
    expect(brief.querySelector('[data-operational-metric="recall-candidates"] [data-operational-value]')).toHaveTextContent('0');
    expect(brief.querySelector('[data-operational-metric="symptom-matches"]')).toHaveAttribute('data-value-state', 'invalid');
  });

  it.each(['unselected', 'loading', 'failed'] as const)('preserves the %s source state without exposing retained vehicle counts', (state) => {
    render(<VehicleMatchPanel {...props}
      selected={state !== 'unselected'}
      loading={state === 'loading'}
      error={state === 'failed' ? new Error('source unavailable') : null}
    />, { wrapper: MemoryRouter });
    expect(screen.getByRole('heading', { name: 'Vehicle match context' })).toBeInTheDocument();
    expect(screen.queryByTestId('service-intelligence-summary')).not.toBeInTheDocument();
    expect(screen.queryByText(serviceReport.vehicle_context.build_match_basis)).not.toBeInTheDocument();
  });
});
