/**
 * ClaimDraftPanel — behaviour coverage.
 *
 * The data hook (`useClaimDraft`) is mocked and driven per test; shared UI
 * (GlassPanel, Badge, Input, Button, CopyButton, PanelState) is REAL so
 * the render-boundary wiring is genuinely exercised.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

vi.mock('@/api/hooks/useServiceIntelligence', async () => {
  const actual = await vi.importActual<typeof import('@/api/hooks/useServiceIntelligence')>(
    '@/api/hooks/useServiceIntelligence',
  );
  return { ...actual, useClaimDraft: vi.fn() };
});

import { useClaimDraft } from '@/api/hooks/useServiceIntelligence';
import { ClaimDraftPanel } from './ClaimDraftPanel';

const mockDraft = useClaimDraft as unknown as ReturnType<typeof vi.fn>;

const draft = {
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
  body: 'Subject: Service request: Charge rate drops after 60%\n\n...',
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

describe('ClaimDraftPanel', () => {
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
    expect(mockDraft).toHaveBeenCalledWith(42, 'Charge rate drops after 60%.', undefined);
  });

  it('renders the draft with coverage badges and copy action', () => {
    mockDraft.mockReturnValue(idle({ data: draft }));
    render(<ClaimDraftPanel vehicleId={42} />);
    expect(screen.getByText('Service request: Charge rate drops after 60%')).toBeInTheDocument();
    expect(screen.getByText(/Battery & Drive Unit/)).toBeInTheDocument();
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
