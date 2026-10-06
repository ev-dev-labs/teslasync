/**
 * ClaimDraftPanel — behaviour coverage.
 *
 * The data hook (`useClaimDraft`) is mocked and driven per test; shared UI
 * (LayoutCard, Badge, Input, Button, CopyButton, PanelState) is REAL so
 * the render-boundary wiring is genuinely exercised.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { ClaimDraft } from '@/api/hooks/useServiceIntelligence';

vi.mock('@/api/hooks/useServiceIntelligence', async () => {
  const actual = await vi.importActual<typeof import('@/api/hooks/useServiceIntelligence')>(
    '@/api/hooks/useServiceIntelligence',
  );
  return { ...actual, useClaimDraft: vi.fn() };
});

import { useClaimDraft } from '@/api/hooks/useServiceIntelligence';
import { ClaimDraftPanel } from './ClaimDraftPanel';

const mockDraft = useClaimDraft as unknown as ReturnType<typeof vi.fn>;

const draft: ClaimDraft = {
  subject: 'Service request: Charge rate drops after 60%',
  issue: 'Charge rate drops after 60%.',
  vehicle: 'Model 3 (2019)',
  coverages: [
    { name: 'Battery & Drive Unit', status: 'active', days_remaining: 900 },
  ],
  communications: ['TSB SB-21-12-001 (HV Battery): contactor inspection'],
  symptoms: ['charge_rate_drop on HV Battery (high, observed 2026-08-01)'],
  evidence: ['Charge curve anomaly: taper at 60%'],
  ask: 'Please diagnose the issue above under Battery & Drive Unit (900 days left).',
  body: [
    'Subject: Service request: Charge rate drops after 60%',
    'Issue: Charge rate drops after 60%.',
    'Vehicle: Model 3 (2019)',
    'Coverage: Battery & Drive Unit · 900d left',
    'TSB SB-21-12-001 (HV Battery): contactor inspection',
    'charge_rate_drop on HV Battery (high, observed 2026-08-01)',
    'Charge curve anomaly: taper at 60%',
    'Please diagnose the issue above under Battery & Drive Unit (900 days left).',
    'Auto-drafted by TeslaSync from your vehicle data.',
  ].join('\n'),
  disclaimer: 'Auto-drafted by TeslaSync from your vehicle data.',
};

function idle(extra = {}) {
  return {
    data: undefined, isLoading: false, isFetching: false, error: null,
    refetch: vi.fn(), ...extra,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockDraft.mockReturnValue(idle());
});

const clipboardDescriptor = Object.getOwnPropertyDescriptor(navigator, 'clipboard');

afterEach(() => {
  if (clipboardDescriptor) Object.defineProperty(navigator, 'clipboard', clipboardDescriptor);
  else Reflect.deleteProperty(navigator, 'clipboard');
  vi.restoreAllMocks();
});

describe('ClaimDraftPanel', () => {
  it('copies the exact complete retained report, including symptoms and evidence, rather than reconstructing its visible summary', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    mockDraft.mockReturnValue(idle({ data: draft, error: new Error('refresh failed') }));
    render(<ClaimDraftPanel vehicleId={42} />);
    fireEvent.click(screen.getByRole('button', { name: 'Copy ticket text' }));
    await waitFor(() => expect(writeText).toHaveBeenCalledOnce());
    expect(writeText).toHaveBeenCalledWith(draft.body);
    expect(draft.body).toContain(draft.symptoms[0]);
    expect(draft.body).toContain(draft.evidence[0]);
    expect(draft.body).toContain(draft.disclaimer);
    expect(screen.getByText(draft.ask)).toBeInTheDocument();
    expect(screen.getByText(draft.disclaimer)).toBeInTheDocument();
  });

  it('preserves an edited issue and the prior ticket while refresh is pending, then submits the exact replacement issue', () => {
    mockDraft.mockReturnValue(idle({ data: draft }));
    const view = render(<MemoryRouter><ClaimDraftPanel vehicleId={42} /></MemoryRouter>);
    fireEvent.change(screen.getByRole('textbox', { name: 'Issue description' }), {
      target: { value: '  Inspect recorded symptoms without diagnosing a fault.  ' },
    });
    mockDraft.mockReturnValue(idle({ data: draft, isFetching: true }));
    view.rerender(<MemoryRouter><ClaimDraftPanel vehicleId={42} /></MemoryRouter>);
    expect(screen.getByRole('textbox', { name: 'Issue description' }))
      .toHaveValue('  Inspect recorded symptoms without diagnosing a fault.  ');
    expect(screen.getByRole('button', { name: 'Draft ticket' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Draft ticket' })).toHaveAttribute('aria-busy', 'true');
    expect(screen.getByText(draft.subject)).toBeInTheDocument();
    mockDraft.mockReturnValue(idle({ data: draft, error: new Error('refresh failed') }));
    view.rerender(<MemoryRouter><ClaimDraftPanel vehicleId={42} /></MemoryRouter>);
    fireEvent.click(screen.getByRole('button', { name: 'Draft ticket' }));
    expect(mockDraft).toHaveBeenLastCalledWith(42, '  Inspect recorded symptoms without diagnosing a fault.  ');
    expect(screen.getByText(draft.subject)).toBeInTheDocument();
  });

  it('recovers from an initial draft failure without discarding the issue or implying an authoritative empty report', () => {
    const refetch = vi.fn();
    mockDraft.mockReturnValue(idle({ error: new Error('draft first load failed'), refetch }));
    const view = render(<MemoryRouter><ClaimDraftPanel vehicleId={42} /></MemoryRouter>);
    fireEvent.change(screen.getByRole('textbox', { name: 'Issue description' }), {
      target: { value: 'Investigate the recorded charge concern.' },
    });
    expect(screen.getByText('This source could not be loaded.')).toBeInTheDocument();
    expect(screen.queryByText('No ticket yet')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Copy ticket text' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Retry/ }));
    expect(refetch).toHaveBeenCalledOnce();
    mockDraft.mockReturnValue(idle({ data: draft, refetch }));
    view.rerender(<MemoryRouter><ClaimDraftPanel vehicleId={42} /></MemoryRouter>);
    expect(screen.getByRole('textbox', { name: 'Issue description' }))
      .toHaveValue('Investigate the recorded charge concern.');
    expect(screen.getByText(draft.subject)).toBeInTheDocument();
    expect(screen.queryByText('This source could not be loaded.')).not.toBeInTheDocument();
  });

  it('does not expose a retained ticket or copy action once the vehicle prerequisite is removed', () => {
    mockDraft.mockReturnValue(idle({ data: draft }));
    const view = render(<ClaimDraftPanel vehicleId={42} />);
    expect(screen.getByRole('button', { name: 'Copy ticket text' })).toBeEnabled();
    view.rerender(<ClaimDraftPanel vehicleId={null} />);
    expect(mockDraft).toHaveBeenLastCalledWith(null, null);
    expect(screen.getByText('Select a vehicle')).toBeInTheDocument();
    expect(screen.queryByText(draft.subject)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Copy ticket text' })).not.toBeInTheDocument();
  });

  it('retains the complete draft and copy action while a background refresh is in flight', () => {
    mockDraft.mockReturnValue(idle({ data: draft, isFetching: true }));
    render(<ClaimDraftPanel vehicleId={42} />);
    expect(screen.getByText(draft.subject)).toBeInTheDocument();
    expect(screen.getByText('Copy ticket text')).toBeInTheDocument();
    expect(screen.getByText(draft.disclaimer)).toBeInTheDocument();
  });

  it('retains a draft, provenance disclaimer and communications after refresh failure', () => {
    const refetch = vi.fn();
    mockDraft.mockReturnValue(idle({ data: draft, error: new Error('refresh failed'), refetch }));
    render(<ClaimDraftPanel vehicleId={42} />);
    expect(screen.getByText(draft.subject)).toBeInTheDocument();
    expect(screen.getByText(draft.communications[0])).toBeInTheDocument();
    expect(screen.getByText(draft.disclaimer)).toBeInTheDocument();
    expect(screen.getByText(/Previously loaded data remains visible/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    expect(refetch).toHaveBeenCalledOnce();
  });

  it('prompts for an issue before any draft exists', () => {
    render(<ClaimDraftPanel vehicleId={42} />);
    expect(screen.getByText('Warranty claim draft')).toBeInTheDocument();
    expect(screen.getByText('No ticket yet')).toBeInTheDocument();
    expect(
      screen.getByText('Describe an issue and generate a ready-to-paste service ticket.'),
    ).toBeInTheDocument();
  });

  it('submits the typed issue to the draft query', () => {
    render(<ClaimDraftPanel vehicleId={42} />);
    fireEvent.change(screen.getByLabelText('Issue description'), {
      target: { value: 'Charge rate drops after 60%.' },
    });
    fireEvent.click(screen.getByText('Draft ticket'));
    expect(mockDraft).toHaveBeenCalledWith(42, 'Charge rate drops after 60%.');
  });

  it('renders the draft with coverage badges and copy action', () => {
    mockDraft.mockReturnValue(idle({ data: draft }));
    render(<ClaimDraftPanel vehicleId={42} />);
    expect(screen.getByText('Service request: Charge rate drops after 60%')).toBeInTheDocument();
    expect(screen.getAllByText(/Battery & Drive Unit/).length).toBeGreaterThan(0);
    expect(screen.getByText(/TSB SB-21-12-001/)).toBeInTheDocument();
    expect(screen.getByText('Copy ticket text')).toBeInTheDocument();
    expect(screen.getByText('Auto-drafted by TeslaSync from your vehicle data.')).toBeInTheDocument();
  });

  it('asks for a vehicle when none is selected', () => {
    render(<ClaimDraftPanel vehicleId={null} />);
    expect(screen.getByText('Select a vehicle')).toBeInTheDocument();
    expect(screen.getByText('Draft ticket').closest('button')).toHaveProperty('disabled', true);
  });
});
