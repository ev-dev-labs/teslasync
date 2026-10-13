import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Text } from '@/components/ui';
import { useDateFormat } from '@/hooks/useDateFormat';
import type { DataQuality, Evidence } from '@/types/advancedIntelligence';
import { EvidencePanel } from './EvidencePanel';

const preferences = vi.hoisted(() => ({
  locale: 'en-GB',
  settings: { tz_display_default: 'utc' as 'utc' | 'user' | 'vehicle', timezone_user: 'Asia/Tokyo' },
}));

vi.mock('@/hooks/useSettings', () => ({
  useSettings: () => preferences,
}));
vi.unmock('@/lib/timezone');
vi.mock('@/hooks/useSelectedVehicle', () => ({
  useSelectedVehicle: () => ({ vehicle: { id: 7, timezone: 'Europe/Berlin' } }),
}));

const START = '2026-01-15T00:30:00Z';
const END = '2026-01-16T12:45:00Z';
const quality: DataQuality = {
  status: 'limited', sample_count: 0, coverage_pct: null,
  window_start: START, window_end: END, reasons: ['Synthetic coverage limitation.'],
};
const evidence: Evidence[] = [
  { source: 'counted-source', summary: 'Counted synthetic observation.', sample_count: 0, observed_at: START },
  { source: 'uncounted-source', summary: 'Uncounted synthetic observation.', sample_count: null, observed_at: END },
];

beforeEach(() => {
  preferences.locale = 'en-GB';
  preferences.settings.tz_display_default = 'utc';
  preferences.settings.timezone_user = 'Asia/Tokyo';
});
afterEach(cleanup);

describe('EvidencePanel date preferences', () => {
  it('renders both window endpoints and counted and uncounted observations in saved locale and UTC instead of browser defaults', () => {
    expect(Intl.DateTimeFormat().resolvedOptions().timeZone).toBe('America/Los_Angeles');
    expect(Intl.DateTimeFormat().resolvedOptions().locale).toBe('en-US');
    render(<EvidencePanel quality={quality} evidence={evidence}
      limitations={['No causal proof.']} unsupported={['No physical actuation.']} />);
    const qualitySection = screen.getByRole('region', { name: 'Data quality' });
    expect(within(qualitySection).getByText('15 Jan 2026, 00:30 – 16 Jan 2026, 12:45')).toBeVisible();
    expect(within(qualitySection).getByText('limited')).toBeVisible();
    expect(within(qualitySection).getByText('0')).toBeVisible();
    expect(within(qualitySection).getByText('—')).toBeVisible();
    expect(within(qualitySection).getByText('• Synthetic coverage limitation.')).toBeVisible();
    const sources = screen.getByRole('region', { name: 'Evidence sources' });
    expect(within(sources).getByText('0 samples · 15 Jan 2026, 00:30')).toBeVisible();
    expect(within(sources).getByText('16 Jan 2026, 12:45')).toBeVisible();
    expect(within(sources).getByText('counted-source')).toBeVisible();
    expect(within(sources).getByText('Uncounted synthetic observation.')).toBeVisible();
    expect(screen.getByText('• No causal proof.')).toBeVisible();
    expect(screen.getByText('• No physical actuation.')).toBeVisible();
  });

  it('reacts to locale user timezone and timezone mode changes without changing source instants', () => {
    const { rerender } = render(<EvidencePanel quality={quality} evidence={evidence} />);
    preferences.locale = 'de-DE';
    rerender(<EvidencePanel quality={quality} evidence={evidence} />);
    expect(screen.getByText('15. Jan. 2026, 00:30 – 16. Jan. 2026, 12:45')).toBeVisible();
    expect(screen.getByText('0 samples · 15. Jan. 2026, 00:30')).toBeVisible();
    expect(screen.getByText('16. Jan. 2026, 12:45')).toBeVisible();

    preferences.settings.tz_display_default = 'user';
    rerender(<EvidencePanel quality={quality} evidence={evidence} />);
    expect(screen.getByText('15. Jan. 2026, 09:30 – 16. Jan. 2026, 21:45')).toBeVisible();
    expect(screen.getByText('0 samples · 15. Jan. 2026, 09:30')).toBeVisible();
    expect(screen.getByText('16. Jan. 2026, 21:45')).toBeVisible();

    preferences.settings.timezone_user = 'America/Los_Angeles';
    rerender(<EvidencePanel quality={quality} evidence={evidence} />);
    expect(screen.getByText('14. Jan. 2026, 16:30 – 16. Jan. 2026, 04:45')).toBeVisible();
    expect(screen.getByText('0 samples · 14. Jan. 2026, 16:30')).toBeVisible();
    expect(screen.getByText('16. Jan. 2026, 04:45')).toBeVisible();

    preferences.settings.tz_display_default = 'vehicle';
    rerender(<EvidencePanel quality={quality} evidence={evidence} />);
    expect(screen.getByText('15. Jan. 2026, 01:30 – 16. Jan. 2026, 13:45')).toBeVisible();
    expect(screen.getByText('0 samples · 15. Jan. 2026, 01:30')).toBeVisible();
    expect(screen.getByText('16. Jan. 2026, 13:45')).toBeVisible();
    expect(quality.window_start).toBe(START);
    expect(quality.window_end).toBe(END);
    expect(evidence.map(item => item.observed_at)).toEqual([START, END]);
  });

  it('matches the parent preference formatter for the same instant in every direct date role', () => {
    function ParentDisplay() {
      const { formatDateTime } = useDateFormat();
      return <>
        <Text as="p">{`Departure: ${formatDateTime(START)}`}</Text>
        <EvidencePanel quality={{ ...quality, window_end: START }} evidence={[
          { ...evidence[0], observed_at: START },
          { ...evidence[1], observed_at: START },
        ]} />
      </>;
    }
    render(<ParentDisplay />);
    expect(screen.getByText('Departure: 15 Jan 2026, 00:30')).toBeVisible();
    expect(screen.getByText('15 Jan 2026, 00:30 – 15 Jan 2026, 00:30')).toBeVisible();
    const sources = screen.getByRole('region', { name: 'Evidence sources' });
    expect(within(sources).getByText('0 samples · 15 Jan 2026, 00:30')).toBeVisible();
    expect(within(sources).getByText('15 Jan 2026, 00:30')).toBeVisible();
  });

  it('preserves partial windows and absent or invalid observation placeholders', () => {
    const missingObservations: Evidence[] = [
      { ...evidence[0], observed_at: null },
      { ...evidence[1], observed_at: 'not-an-iso-instant' },
    ];
    const { rerender } = render(<EvidencePanel quality={{ ...quality, window_end: null }} evidence={missingObservations} />);
    expect(screen.getByText('15 Jan 2026, 00:30 – —')).toBeVisible();
    const sources = screen.getByRole('region', { name: 'Evidence sources' });
    expect(within(sources).getByText('0 samples · —')).toBeVisible();
    expect(within(sources).getByText('—')).toBeVisible();
    rerender(<EvidencePanel quality={{ ...quality, window_start: null }} evidence={missingObservations} />);
    expect(screen.getByText('— – 16 Jan 2026, 12:45')).toBeVisible();
    rerender(<EvidencePanel quality={{ ...quality, window_start: null, window_end: null }} evidence={missingObservations} />);
    const qualitySection = screen.getByRole('region', { name: 'Data quality' });
    expect(within(qualitySection).getAllByText('—')).toHaveLength(2);
    rerender(<EvidencePanel quality={{ ...quality, window_start: null, window_end: null }} evidence={[
      { ...evidence[0], observed_at: 'not-an-iso-instant' },
      { ...evidence[1], observed_at: null },
    ]} />);
    expect(within(sources).getByText('0 samples · —')).toBeVisible();
    expect(within(sources).getByText('—')).toBeVisible();
    expect(within(sources).getByText('counted-source')).toBeVisible();
    expect(within(sources).getByText('Uncounted synthetic observation.')).toBeVisible();
  });

  it('retains all evidence quality and limitation sections when optional data is absent', () => {
    const { rerender } = render(<EvidencePanel quality={null} evidence={null} limitations={null} unsupported={null} />);
    expect(screen.getByRole('heading', { name: 'Evidence, quality, and limitations' })).toBeVisible();
    const qualitySection = screen.getByRole('region', { name: 'Data quality' });
    const sources = screen.getByRole('region', { name: 'Evidence sources' });
    const limitations = screen.getByRole('region', { name: 'Limitations' });
    expect(within(qualitySection).getByText('Quality metadata is unsupported.')).toBeVisible();
    expect(within(sources).getByText('No supporting evidence was returned.')).toBeVisible();
    expect(within(limitations).getByText('No additional limitations were returned.')).toBeVisible();
    rerender(<EvidencePanel evidence={[]} limitations={[]} unsupported={['No physical actuation.']} />);
    expect(screen.getByRole('region', { name: 'Data quality' })).toBeVisible();
    expect(screen.getByRole('region', { name: 'Evidence sources' })).toBeVisible();
    expect(screen.getByRole('region', { name: 'Limitations' })).toBeVisible();
    expect(screen.getByText('Explicitly unsupported')).toBeVisible();
    expect(screen.getByText('• No physical actuation.')).toBeVisible();
  });
});
