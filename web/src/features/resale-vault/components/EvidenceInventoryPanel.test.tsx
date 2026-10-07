import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { EvidenceInventoryPanel } from './EvidenceInventoryPanel';
import { DISCLOSURE_PROFILE_SECTIONS } from '../lib/constants';
import type { VaultEvidence, DisclosureSelection } from '../lib/types';

const EMPTY_EVIDENCE: VaultEvidence = {
  vehicle_identity: null,
  battery: null,
  maintenance: null,
  software_updates: null,
  warranty: null,
  driving_history: null,
  charging_history: null,
  security_incidents: null,
};

function selection(): DisclosureSelection {
  return {
    profileId: 'warranty',
    sections: DISCLOSURE_PROFILE_SECTIONS.warranty,
    sensitive: { vinDisclosure: 'excluded', exactTimestamps: false },
  };
}

describe('EvidenceInventoryPanel', () => {
  it('shows "No data" for every section when evidence is empty', () => {
    render(
      <EvidenceInventoryPanel evidence={EMPTY_EVIDENCE} selection={selection()} isLoading={false} hasPartialErrors={false} />,
    );
    expect(screen.getAllByText('No data').length).toBe(8);
  });

  it('shows "Data found" for a populated section', () => {
    render(
      <EvidenceInventoryPanel
        evidence={{
          ...EMPTY_EVIDENCE,
          battery: {
            soh_pct: 95,
            capacity_wh: 75000,
            original_capacity_wh: 78000,
            equivalent_full_cycles: 100,
            fast_charge_ratio: 0.1,
            avg_charge_limit_pct: 80,
            health_grade: 'A',
            thermal_exposure: null,
            degradation_trend: [],
            recommendations: [],
            source_provenance_hash: null,
            issued_at: null,
            first_observed_at: null,
          },
        }}
        selection={selection()}
        isLoading={false}
        hasPartialErrors={false}
      />,
    );
    expect(screen.getByText('Data found')).toBeInTheDocument();
  });

  it('marks driving_history as excluded by the warranty profile', () => {
    render(
      <EvidenceInventoryPanel evidence={EMPTY_EVIDENCE} selection={selection()} isLoading={false} hasPartialErrors={false} />,
    );
    const row = screen.getByText('Driving History').closest('li')!;
    expect(row).toHaveTextContent('Excluded by profile');
  });

  it('marks battery as included by the warranty profile', () => {
    render(
      <EvidenceInventoryPanel evidence={EMPTY_EVIDENCE} selection={selection()} isLoading={false} hasPartialErrors={false} />,
    );
    const row = screen.getByText('Battery Health').closest('li')!;
    expect(row).toHaveTextContent('Included');
  });

  it('shows a partial-error callout when hasPartialErrors is true', () => {
    render(
      <EvidenceInventoryPanel evidence={EMPTY_EVIDENCE} selection={selection()} isLoading={false} hasPartialErrors />,
    );
    expect(screen.getByText(/failed to load/i)).toBeInTheDocument();
  });

  it('shows "Loading…" badges while isLoading is true', () => {
    render(
      <EvidenceInventoryPanel evidence={EMPTY_EVIDENCE} selection={selection()} isLoading hasPartialErrors={false} />,
    );
    expect(screen.getAllByText('Loading…').length).toBe(8);
  });
});
