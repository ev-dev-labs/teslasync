import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { SoftwareUpdateSummaryPanel } from './SoftwareUpdateSummaryPanel';
import type { SoftwareUpdateEvidence } from '../lib/types';

const SAMPLE: SoftwareUpdateEvidence = {
  update_count: 4,
  installed_versions: [{ version: '2024.20.1', installed_at: '2024-06-01' }],
  latest_version: '2024.20.1',
};

describe('SoftwareUpdateSummaryPanel', () => {
  it('renders an empty state when evidence is null', () => {
    render(<SoftwareUpdateSummaryPanel softwareUpdates={null} />);
    expect(screen.getByText(/No software update evidence/i)).toBeInTheDocument();
  });

  it('renders the latest version badge and update count', () => {
    render(<SoftwareUpdateSummaryPanel softwareUpdates={SAMPLE} />);
    expect(screen.getAllByText('2024.20.1').length).toBeGreaterThan(0);
    expect(screen.getByText('4')).toBeInTheDocument();
  });

  it('renders the installed versions list', () => {
    render(<SoftwareUpdateSummaryPanel softwareUpdates={SAMPLE} />);
    expect(screen.getByText('2024-06-01')).toBeInTheDocument();
  });
});
