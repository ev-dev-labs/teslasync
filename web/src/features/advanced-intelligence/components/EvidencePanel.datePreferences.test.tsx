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
const selection = vi.hoisted(() => ({
  vehicle: { id: 7, timezone: 'Europe/Berlin' } as { id: number; timezone: string } | null,
}));

vi.mock('@/hooks/useSettings', () => ({
  useSettings: () => preferences,
}));
vi.unmock('@/lib/timezone');
vi.mock('@/hooks/useSelectedVehicle', () => ({
  useSelectedVehicle: () => selection,
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
  selection.vehicle = { id: 7, timezone: 'Europe/Berlin' };
});
afterEach(cleanup);

describe('EvidencePanel date preferences', () => {
  it('renders both window endpoints and counted and uncounted observations in saved locale and UTC instead of browser defaults', () => {
    // The saved prefs must differ from the browser defaults, whatever the
    // ambient environment is, or this test could not catch a fallback bug.
    const ambient = Intl.DateTimeFormat().resolvedOptions();
    expect(`${ambient.timeZone}/${ambient.locale}`).not.toBe('UTC/en-GB');
    render(<EvidencePanel quality={quality} evidence={evidence}
      limitations={['No causal proof.']} unsupported={['No physical actuation.']} />);
    const qualitySection = screen.getByRole('region', { name: 'Data quality' });
    expect(within(qualitySection).getByText('15 Jan 2026, 00:30 – 16 Jan 2026, 12:45')).toBeVisible();
    expect(within(qualitySection).getByText('Limited evidence')).toBeVisible();
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

  it.each([
    { locale: 'en-US', start: 'Jan 15, 2026, 12:30 AM', end: 'Jan 16, 2026, 12:45 PM' },
    { locale: 'en-GB', start: '15 Jan 2026, 00:30', end: '16 Jan 2026, 12:45' },
    { locale: 'fr-FR', start: '15 janv. 2026, 00:30', end: '16 janv. 2026, 12:45' },
    { locale: 'ja-JP', start: '2026年1月15日 00:30', end: '2026年1月16日 12:45' },
  ])('updates real date order and 12/24-hour presentation for saved $locale in every direct role', ({ locale, start, end }) => {
    const { rerender } = render(<EvidencePanel quality={quality} evidence={evidence} />);
    preferences.locale = locale;
    rerender(<EvidencePanel quality={quality} evidence={evidence} />);
    expect(within(screen.getByRole('region', { name: 'Data quality' })).getByText(`${start} – ${end}`)).toBeVisible();
    const sources = screen.getByRole('region', { name: 'Evidence sources' });
    expect(within(sources).getByText(`0 samples · ${start}`)).toBeVisible();
    expect(within(sources).getByText(end)).toBeVisible();
    expect(quality.window_start).toBe(START);
    expect(quality.window_end).toBe(END);
    expect(evidence.map(item => item.observed_at)).toEqual([START, END]);
  });

  it('reacts to the selected vehicle timezone and real fallback rules without changing the payload', () => {
    preferences.settings.tz_display_default = 'vehicle';
    const { rerender } = render(<EvidencePanel quality={quality} evidence={evidence} />);
    expect(screen.getByText('15 Jan 2026, 01:30 – 16 Jan 2026, 13:45')).toBeVisible();
    selection.vehicle = { id: 8, timezone: 'America/Los_Angeles' };
    rerender(<EvidencePanel quality={quality} evidence={evidence} />);
    expect(screen.getByText('14 Jan 2026, 16:30 – 16 Jan 2026, 04:45')).toBeVisible();
    expect(screen.getByText('0 samples · 14 Jan 2026, 16:30')).toBeVisible();
    selection.vehicle = null;
    rerender(<EvidencePanel quality={quality} evidence={evidence} />);
    expect(screen.getByText('15 Jan 2026, 09:30 – 16 Jan 2026, 21:45')).toBeVisible();
    selection.vehicle = { id: 8, timezone: 'UTC' };
    rerender(<EvidencePanel quality={quality} evidence={evidence} />);
    expect(screen.getByText('15 Jan 2026, 09:30 – 16 Jan 2026, 21:45')).toBeVisible();
    preferences.settings.tz_display_default = 'user';
    preferences.settings.timezone_user = '';
    rerender(<EvidencePanel quality={quality} evidence={evidence} />);
    // Empty user zone falls back to the browser default zone, whatever it is.
    const fallbackZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const fallbackFmt = new Intl.DateTimeFormat('en-GB', {
      day: 'numeric', month: 'short', year: 'numeric',
      hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: fallbackZone,
    });
    const fallbackRange = `${fallbackFmt.format(new Date(START))} – ${fallbackFmt.format(new Date(END))}`;
    expect(screen.getByText(fallbackRange)).toBeVisible();
    expect(evidence.map(item => item.observed_at)).toEqual([START, END]);
  });

  it('keeps each source instant distinct across a daylight-saving gap and invalid quality endpoints unknown', () => {
    preferences.settings.tz_display_default = 'user';
    preferences.settings.timezone_user = 'America/Los_Angeles';
    const beforeGap = '2026-03-08T09:30:00Z';
    const afterGap = '2026-03-08T10:30:00Z';
    const gapQuality = Object.freeze({ ...quality, window_start: beforeGap, window_end: afterGap });
    const gapEvidence = [
      Object.freeze({ ...evidence[0], observed_at: beforeGap }),
      Object.freeze({ ...evidence[1], observed_at: afterGap }),
    ];
    const { rerender } = render(<EvidencePanel quality={gapQuality} evidence={gapEvidence} />);
    expect(screen.getByText('8 Mar 2026, 01:30 – 8 Mar 2026, 03:30')).toBeVisible();
    expect(screen.getByText('0 samples · 8 Mar 2026, 01:30')).toBeVisible();
    expect(screen.getByText('8 Mar 2026, 03:30')).toBeVisible();
    preferences.settings.tz_display_default = 'utc';
    rerender(<EvidencePanel quality={gapQuality} evidence={gapEvidence} />);
    expect(screen.getByText('8 Mar 2026, 09:30 – 8 Mar 2026, 10:30')).toBeVisible();
    expect(gapQuality.window_start).toBe(beforeGap);
    expect(gapQuality.window_end).toBe(afterGap);
    expect(gapEvidence.map(item => item.observed_at)).toEqual([beforeGap, afterGap]);
    rerender(<EvidencePanel quality={{ ...quality, window_start: 'invalid-window', window_end: '' }} evidence={gapEvidence} />);
    expect(screen.getByText('— – —')).toBeVisible();
    expect(screen.getByRole('region', { name: 'Evidence sources' })).toBeVisible();
    expect(screen.getByRole('region', { name: 'Limitations' })).toBeVisible();
  });
});
