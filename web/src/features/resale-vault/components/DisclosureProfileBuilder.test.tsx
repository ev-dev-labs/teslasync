import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { DisclosureProfileBuilder } from './DisclosureProfileBuilder';
import { DISCLOSURE_PROFILE_SECTIONS, ALL_EVIDENCE_SECTIONS } from '../lib/constants';
import type { DisclosureSelection } from '../lib/types';

function baseSelection(): DisclosureSelection {
  return {
    profileId: 'resale',
    sections: DISCLOSURE_PROFILE_SECTIONS.resale,
    sensitive: { vinDisclosure: 'excluded', exactTimestamps: false },
  };
}

describe('DisclosureProfileBuilder', () => {
  it('renders all four profile options and marks the active one selected', () => {
    render(
      <DisclosureProfileBuilder
        selection={baseSelection()}
        allSections={ALL_EVIDENCE_SECTIONS}
        onProfileChange={vi.fn()}
        onToggleSection={vi.fn()}
        onVinDisclosureChange={vi.fn()}
        onExactTimestampsChange={vi.fn()}
      />,
    );
    expect(screen.getByText('Resale / Vehicle History').closest('label')).toBeTruthy();
    const resaleRadio = screen.getByDisplayValue('resale') as HTMLInputElement;
    expect(resaleRadio.checked).toBe(true);
  });

  it('calls onProfileChange when a different profile card is clicked', () => {
    const onProfileChange = vi.fn();
    render(
      <DisclosureProfileBuilder
        selection={baseSelection()}
        allSections={ALL_EVIDENCE_SECTIONS}
        onProfileChange={onProfileChange}
        onToggleSection={vi.fn()}
        onVinDisclosureChange={vi.fn()}
        onExactTimestampsChange={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByDisplayValue('warranty'));
    expect(onProfileChange).toHaveBeenCalledWith('warranty');
  });

  it('disables section checkboxes unless the profile is custom', () => {
    render(
      <DisclosureProfileBuilder
        selection={baseSelection()}
        allSections={ALL_EVIDENCE_SECTIONS}
        onProfileChange={vi.fn()}
        onToggleSection={vi.fn()}
        onVinDisclosureChange={vi.fn()}
        onExactTimestampsChange={vi.fn()}
      />,
    );
    const checkboxes = screen.getAllByRole('checkbox');
    for (const cb of checkboxes) expect(cb).toBeDisabled();
  });

  it('enables checkboxes and calls onToggleSection under the custom profile', () => {
    const onToggleSection = vi.fn();
    render(
      <DisclosureProfileBuilder
        selection={{ ...baseSelection(), profileId: 'custom' }}
        allSections={ALL_EVIDENCE_SECTIONS}
        onProfileChange={vi.fn()}
        onToggleSection={onToggleSection}
        onVinDisclosureChange={vi.fn()}
        onExactTimestampsChange={vi.fn()}
      />,
    );
    const checkboxes = screen.getAllByRole('checkbox');
    expect(checkboxes[0]).not.toBeDisabled();
    fireEvent.click(checkboxes[0]);
    expect(onToggleSection).toHaveBeenCalled();
  });

  it('shows a warning callout when VIN disclosure is not "excluded"', () => {
    render(
      <DisclosureProfileBuilder
        selection={{ ...baseSelection(), sensitive: { vinDisclosure: 'masked', exactTimestamps: false } }}
        allSections={ALL_EVIDENCE_SECTIONS}
        onProfileChange={vi.fn()}
        onToggleSection={vi.fn()}
        onVinDisclosureChange={vi.fn()}
        onExactTimestampsChange={vi.fn()}
      />,
    );
    expect(screen.getByText(/identifying information/i)).toBeInTheDocument();
  });

  it('shows a warning callout when exact timestamps are enabled', () => {
    render(
      <DisclosureProfileBuilder
        selection={{ ...baseSelection(), sensitive: { vinDisclosure: 'excluded', exactTimestamps: true } }}
        allSections={ALL_EVIDENCE_SECTIONS}
        onProfileChange={vi.fn()}
        onToggleSection={vi.fn()}
        onVinDisclosureChange={vi.fn()}
        onExactTimestampsChange={vi.fn()}
      />,
    );
    expect(screen.getByText(/easier to correlate/i)).toBeInTheDocument();
  });

  it('always shows the hard-exclusions notice', () => {
    render(
      <DisclosureProfileBuilder
        selection={baseSelection()}
        allSections={ALL_EVIDENCE_SECTIONS}
        onProfileChange={vi.fn()}
        onToggleSection={vi.fn()}
        onVinDisclosureChange={vi.fn()}
        onExactTimestampsChange={vi.fn()}
      />,
    );
    expect(screen.getByText(/Always excluded, regardless of profile/i)).toBeInTheDocument();
  });
});
