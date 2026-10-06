import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import type { EfficiencyShift } from '@/api/hooks/useAnalytics';
import type { VisitedPlaceCandidate } from '@/api/types';
import { EfficiencyDetectivePanel } from './EfficiencyDetectivePanel';
import { VisitedCandidates } from './charging-places/VisitedCandidates';

const h = vi.hoisted(() => ({
  shift: undefined as EfficiencyShift | undefined,
  candidates: undefined as VisitedPlaceCandidate[] | undefined,
  shiftError: null as Error | null,
  candidatesError: null as Error | null,
  refetchShift: vi.fn(), refetchCandidates: vi.fn(),
}));
vi.mock('@/api/hooks/useAnalytics', () => ({
  useEfficiencyShift: () => ({ data: h.shift, error: h.shiftError, isLoading: false, refetch: h.refetchShift }),
}));
vi.mock('@/api/hooks/useLocations', () => ({
  useVisitedPlaceCandidates: () => ({ data: h.candidates, error: h.candidatesError, isLoading: false, refetch: h.refetchCandidates }),
}));
vi.mock('@/api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/client')>();
  return {
    ...actual,
    request: (path: string) => Promise.resolve(path === '/vehicles' ? [] : null),
  };
});
vi.mock('@/hooks/useNumberFormatting', () => ({
  useNumberFormatting: () => ({
    fmtNumber: (number: number) => String(number),
    fmtScientificNumber: (number: number) => String(number),
    fmtInt: (number: number) => String(number),
  }),
}));

const shift: EfficiencyShift = {
  latest_month: '2026-09', prior_month: '2026-08',
  latest_efficiency: 180, prior_efficiency: 175,
  efficiency_delta_pct: 0, latest_temp_c: 20, prior_temp_c: 20,
  temp_delta_c: 0, temp_sensitivity_per_c: 1, temp_attributed_pct: 0, residual_pct: 0,
  verdict: 'stable', explanation: 'Exact server diagnosis and qualification.',
};
const candidate: VisitedPlaceCandidate = {
  id: 42, name: 'Full candidate name '.repeat(8), latitude: 40, longitude: -74,
  visit_count: 7, charge_count: 0, last_visited: '2026-10-05T10:00:00Z', first_charge_at: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  h.shift = undefined;
  h.candidates = undefined;
  h.shiftError = null;
  h.candidatesError = null;
});
afterEach(cleanup);

function renderPresenter(children: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <MemoryRouter>
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    </MemoryRouter>,
  );
}

describe('mobility independent specialist sources', () => {
  it('retains server verdict, complete explanation and measured zero attribution after refresh failure', () => {
    h.shift = shift;
    h.shiftError = new Error('diagnosis refresh');
    renderPresenter(<EfficiencyDetectivePanel vehicleId="7" />);
    expect(screen.getByText('Stable')).toBeInTheDocument();
    expect(screen.getByText(shift.explanation)).toBeInTheDocument();
    expect(screen.getByText('0% vs prior month · 0% temperature-attributed · 0°C shift')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(h.refetchShift).toHaveBeenCalledOnce();
  });

  it('preserves the insufficient-data explanation without fabricating numeric diagnosis', () => {
    h.shift = { ...shift, verdict: 'insufficient_data', explanation: 'Server says the window is insufficient.' };
    renderPresenter(<EfficiencyDetectivePanel vehicleId="7" />);
    expect(screen.getByText('Need more data')).toBeInTheDocument();
    expect(screen.getByText(h.shift.explanation)).toBeInTheDocument();
    expect(screen.queryByText(/temperature-attributed/)).not.toBeInTheDocument();
  });

  it('does not call an unresolved candidate source empty or claim a measured count', () => {
    renderPresenter(<VisitedCandidates onReview={vi.fn()} />);
    expect(screen.getByText('Visited place suggestions are unavailable.')).toBeInTheDocument();
    expect(screen.getByText('—')).toBeInTheDocument();
    expect(screen.queryByText('0')).not.toBeInTheDocument();
    expect(screen.queryByText('No unmatched visited places in recent drive history.')).not.toBeInTheDocument();
  });

  it('keeps source order, charging evidence, template IDs and full review objects during refresh failure', () => {
    const unnamed = { ...candidate, id: 9, name: '', charge_count: 2 };
    h.candidates = [candidate, unnamed];
    h.candidatesError = new Error('candidate refresh');
    const onReview = vi.fn();
    const onSelectForTemplate = vi.fn();
    renderPresenter(<VisitedCandidates onReview={onReview} onSelectForTemplate={onSelectForTemplate} />);
    expect(screen.getByText(candidate.name.trim())).toBeInTheDocument();
    expect(screen.getByText(/^7 visits · 0 confirmed charges ·$/)).toBeInTheDocument();
    expect(screen.getByText('Visited; charging not observed')).toBeInTheDocument();
    expect(screen.getByText('Likely charging')).toBeInTheDocument();
    const templates = screen.getAllByRole('button', { name: 'Use in template' });
    expect(templates[1]).toBeDisabled();
    fireEvent.click(templates[0]);
    expect(onSelectForTemplate).toHaveBeenCalledWith(42);
    fireEvent.click(screen.getAllByRole('button', { name: 'Review place' })[1]);
    expect(onReview).toHaveBeenCalledWith(unnamed);
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(h.refetchCandidates).toHaveBeenCalledOnce();
  });
});
