import { act, cleanup, render, screen, within } from '@testing-library/react';
import { createInstance } from 'i18next';
import type { ComponentProps } from 'react';
import { I18nextProvider, initReactI18next } from 'react-i18next';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getFormatterPreferences,
  setGlobalLocale,
  setGlobalPrecision,
} from '@/lib/numberFormat';
import type { DataQuality, Evidence } from '@/types/advancedIntelligence';
import { EvidencePanel } from './EvidencePanel';

vi.unmock('react-i18next');

const datePreferences = vi.hoisted(() => ({
  locale: 'en-GB',
  settings: { tz_display_default: 'utc' },
}));

vi.mock('@/hooks/useSettings', () => ({
  useSettings: () => datePreferences,
}));

const translations = createInstance();
const OBSERVED_AT = '2026-01-15T00:30:00Z';
const DATE = '15 Jan 2026, 00:30';
const SOURCE = '000001_012345';
const quality: DataQuality = Object.freeze({
  status: 'limited',
  sample_count: 0,
  coverage_pct: 0,
  window_start: OBSERVED_AT,
  window_end: null,
  reasons: ['Synthetic coverage limitation.'],
});
let savedPreferences = getFormatterPreferences();

beforeEach(async () => {
  savedPreferences = getFormatterPreferences();
  setGlobalLocale('en-US');
  setGlobalPrecision(2);
  datePreferences.locale = 'en-GB';
  await translations.use(initReactI18next).init({
    lng: 'en',
    fallbackLng: false,
    interpolation: { escapeValue: false },
    // Synthetic plural copy exercises the real engine; production catalog integration is parent-owned.
    resources: {
      en: { translation: { advancedIntelligence: { evidence: {
        sampleLine_one: '{{formattedCount}} sample · {{date}}',
        sampleLine_other: '{{formattedCount}} samples · {{date}}',
      } } } },
      de: { translation: { advancedIntelligence: { evidence: {
        sampleLine_one: '{{formattedCount}} Beobachtung · {{date}}',
        sampleLine_other: '{{formattedCount}} Beobachtungen · {{date}}',
      } } } },
      ja: { translation: { advancedIntelligence: { evidence: {
        sampleLine_other: '{{formattedCount}} 件の観測 · {{date}}',
      } } } },
    },
  });
});

afterEach(() => {
  cleanup();
  setGlobalLocale(savedPreferences.locale);
  setGlobalPrecision(savedPreferences.precision);
});

function observation(sample_count: number | null, observed_at: string | null = OBSERVED_AT): Evidence {
  return Object.freeze({
    source: SOURCE,
    summary: 'Synthetic counted observation.',
    sample_count,
    observed_at,
  });
}

function panel(evidence: Evidence[], query?: ComponentProps<typeof EvidencePanel>['query']) {
  return <I18nextProvider i18n={translations}>
    <EvidencePanel quality={quality} evidence={evidence} query={query}
      limitations={['Synthetic uncertainty.']} unsupported={['No identity attribution.']} />
  </I18nextProvider>;
}

describe('EvidencePanel sample count plurals', () => {
  it.each([
    { count: 1, label: '1 sample' },
    { count: 0, label: '0 samples' },
    { count: 2, label: '2 samples' },
    { count: 12345, label: '12,345 samples' },
    { count: 1.25, label: '1 samples' },
  ])('uses raw count $count for plural selection and separately formatted display', ({ count, label }) => {
    const item = observation(count);
    render(panel([item]));
    const sources = within(screen.getByRole('region', { name: 'Evidence sources' }));
    expect(sources.getByText(`${label} · ${DATE}`)).toBeVisible();
    expect(sources.getByText(SOURCE)).toBeVisible();
    expect(sources.getByText(item.summary)).toBeVisible();
    expect(item.sample_count).toBe(count);
    expect(item.observed_at).toBe(OBSERVED_AT);
    expect(item.source).toBe(SOURCE);
    const qualitySection = within(screen.getByRole('region', { name: 'Data quality' }));
    expect(qualitySection.getByText('0')).toBeVisible();
    expect(qualitySection.getByText('0.00%')).toBeVisible();
    expect(qualitySection.getByText('• Synthetic coverage limitation.')).toBeVisible();
    expect(screen.getByRole('region', { name: 'Limitations' })).toBeVisible();
    expect(screen.getByText('• Synthetic uncertainty.')).toBeVisible();
    expect(screen.getByText('• No identity attribution.')).toBeVisible();
  });

  it.each([
    { kind: 'null', count: null },
    { kind: 'NaN', count: Number.NaN },
    { kind: 'positive infinity', count: Number.POSITIVE_INFINITY },
    { kind: 'negative infinity', count: Number.NEGATIVE_INFINITY },
  ])('keeps $kind count unknown and date-only instead of fabricating zero samples', ({ count }) => {
    const item = observation(count);
    render(panel([item]));
    const sources = within(screen.getByRole('region', { name: 'Evidence sources' }));
    expect(sources.getByText(DATE)).toBeVisible();
    expect(sources.queryByText(/samples? ·/)).not.toBeInTheDocument();
    expect(sources.queryByText(/NaN|Infinity/)).not.toBeInTheDocument();
    expect(sources.getByText(SOURCE)).toBeVisible();
    expect(sources.getByText(item.summary)).toBeVisible();
    expect(Object.is(item.sample_count, count)).toBe(true);
    expect(item.observed_at).toBe(OBSERVED_AT);
  });

  it.each([
    { kind: 'absent observation', observedAt: null },
    { kind: 'invalid observation', observedAt: 'not-an-iso-instant' },
  ])('preserves $kind placeholders for counted and uncounted sources', ({ observedAt }) => {
    const items = [observation(1, observedAt), { ...observation(null, observedAt), source: 'date-only-source' }];
    render(panel(items));
    const sources = within(screen.getByRole('region', { name: 'Evidence sources' }));
    expect(sources.getByText('1 sample · —')).toBeVisible();
    expect(sources.getByText('—')).toBeVisible();
    expect(sources.getByText(SOURCE)).toBeVisible();
    expect(sources.getByText('date-only-source')).toBeVisible();
    expect(items.map(item => item.observed_at)).toEqual([observedAt, observedAt]);
  });

  it('reacts to number locale grouping without rerender refetch or changing raw counts and opaque source identity', async () => {
    const item = observation(12345);
    const query = { data: { evidence: [item] }, refetch: vi.fn() };
    render(panel([item], query));
    expect(screen.getByText(`12,345 samples · ${DATE}`)).toBeVisible();
    act(() => { setGlobalLocale('de-DE'); });
    expect(screen.getByText(`12.345 samples · ${DATE}`)).toBeVisible();
    await act(async () => { await translations.changeLanguage('de'); });
    expect(screen.getByText(`12.345 Beobachtungen · ${DATE}`)).toBeVisible();
    act(() => { setGlobalLocale('fr-FR'); });
    expect(screen.getByText(`12\u202f345 Beobachtungen · ${DATE}`, { normalizer: text => text })).toBeVisible();
    expect(screen.getByText(SOURCE)).toBeVisible();
    expect(query.refetch).not.toHaveBeenCalled();
    expect(item.sample_count).toBe(12345);
    expect(item.source).toBe(SOURCE);
    expect(item.observed_at).toBe(OBSERVED_AT);
  });

  it('reacts to non-English plural rules using the numeric count rather than the displayed number string', async () => {
    const items = [observation(1), { ...observation(2), source: 'second-synthetic-source' }];
    render(panel(items));
    expect(screen.getByText(`1 sample · ${DATE}`)).toBeVisible();
    expect(screen.getByText(`2 samples · ${DATE}`)).toBeVisible();
    await act(async () => { await translations.changeLanguage('de'); });
    expect(screen.getByText(`1 Beobachtung · ${DATE}`)).toBeVisible();
    expect(screen.getByText(`2 Beobachtungen · ${DATE}`)).toBeVisible();
    await act(async () => { await translations.changeLanguage('ja'); });
    expect(screen.getByText(`1 件の観測 · ${DATE}`)).toBeVisible();
    expect(screen.getByText(`2 件の観測 · ${DATE}`)).toBeVisible();
    expect(items.map(item => item.sample_count)).toEqual([1, 2]);
  });

  it('keeps formatted samples and all three sections through retained refresh failure and paused refresh with no duplicate recovery', () => {
    const item = observation(12345);
    const refetch = vi.fn();
    const query = { data: { evidence: [item] }, dataUpdatedAt: 1, refetch };
    const view = render(panel([item], { ...query, isError: true, error: new Error('Synthetic refresh failure') }));
    expect(screen.getByText(`12,345 samples · ${DATE}`)).toBeVisible();
    for (const name of ['Data quality', 'Evidence sources', 'Limitations']) {
      expect(screen.getByRole('region', { name })).toBeVisible();
    }
    expect(screen.getByRole('region', { name: 'Data quality' }).parentElement)
      .toHaveAttribute('data-source-status', 'stale');
    expect(screen.queryByRole('button', { name: /retry|refresh/i })).not.toBeInTheDocument();
    view.rerender(panel([item], { ...query, fetchStatus: 'paused' }));
    act(() => { setGlobalLocale('de-DE'); });
    expect(screen.getByText(`12.345 samples · ${DATE}`)).toBeVisible();
    expect(screen.getByText('• Synthetic uncertainty.')).toBeVisible();
    expect(screen.getByText('• No identity attribution.')).toBeVisible();
    expect(refetch).not.toHaveBeenCalled();
    expect(item.sample_count).toBe(12345);
  });
});
