import { assertOperationalBriefDisclosure } from '@/test/operationalBriefAssertions';
import type { ComponentProps, PropsWithChildren } from 'react';
import { createInstance, type i18n } from 'i18next';
import { I18nextProvider, initReactI18next } from 'react-i18next';
import { MemoryRouter } from 'react-router-dom';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import english from '@/i18n/en.json';
import { getFormatterPreferences, setGlobalLocale, setGlobalPrecision } from '@/lib/numberFormat';
import type { ChargeDepartureAlignmentSummary } from '../../lib/chargeDepartureAlignment';
import { AlignmentStats } from './AlignmentStats';

vi.unmock('react-i18next');
vi.mock('@/hooks/useUnits', () => ({
  useUnits: () => ({
    unitPrefs: {
      distance: 'km', speed: 'km/h', temperature: '°C', pressure: 'kPa',
      energy: 'kWh', duration: 'min', power: 'kW', precision: 2, locale: 'en-US',
    },
  }),
}));
vi.mock('@/hooks/useFormatting', () => ({ useFormatting: () => ({ currencySymbol: '$' }) }));

const originalPreferences = getFormatterPreferences();
let translations: i18n;

function summary(overrides: Partial<ChargeDepartureAlignmentSummary> = {}): ChargeDepartureAlignmentSummary {
  return {
    pairs: [], totalEndedCharges: 3, pairedCount: 2, unpairedCount: 1,
    avgDwellS: 4500, avgReadinessMarginPct: 45.1,
    misalignedCount: 1, misalignedRatePct: 50,
    totalEarlyFullDwellS: 0, tightMarginCount: 0, excessBufferCount: 0,
    ...overrides,
  };
}

function Harness({ children }: PropsWithChildren) {
  return <I18nextProvider i18n={translations}><MemoryRouter>{children}</MemoryRouter></I18nextProvider>;
}

function props(overrides: Partial<ComponentProps<typeof AlignmentStats>> = {}): ComponentProps<typeof AlignmentStats> {
  return {
    summary: summary(), loading: false, retained: false,
    missingReason: 'History has not loaded.',
    historyContext: <p>3 charge source records; 2 drive source records</p>,
    ...overrides,
  };
}

function metric(container: HTMLElement, key: string) {
  const element = container.querySelector<HTMLElement>(`[data-operational-metric="${key}"]`);
  if (!element) throw new Error(`Missing alignment metric ${key}`);
  return element;
}

beforeEach(async () => {
  translations = createInstance();
  await translations.use(initReactI18next).init({
    lng: 'en', fallbackLng: 'en', interpolation: { escapeValue: false },
    resources: { en: { translation: english } },
  });
  setGlobalLocale('en-US');
  setGlobalPrecision(2);
});

afterEach(() => {
  cleanup();
  setGlobalLocale(originalPreferences.locale);
  setGlobalPrecision(originalPreferences.precision);
});

describe('AlignmentStats derived summary semantics', () => {
  it('labels the real summary and review details as derived while preserving four metrics and source counts', () => {
    const input = summary();
    const original = JSON.stringify(input);
    const { container } = render(<AlignmentStats {...props({ summary: input })} />, { wrapper: Harness });
    const brief = container.querySelector<HTMLElement>('[data-operational-brief]');
    if (!brief) throw new Error('Missing alignment brief');
    expect(screen.queryByText('Recorded measurements from the stated charging source and scope.')).not.toBeInTheDocument();
    expect(screen.queryByText('Source measurements available')).not.toBeInTheDocument();
    expect(container.querySelectorAll('[data-operational-metric]')).toHaveLength(4);
    expect(metric(container, 'alignment-avg-dwell')).toHaveTextContent('1h 15m');
    expect(metric(container, 'alignment-avg-margin')).toHaveTextContent('45.10%');
    expect(metric(container, 'alignment-misaligned-rate')).toHaveTextContent('50.00%');
    expect(screen.queryByText('3 charge source records; 2 drive source records')).not.toBeInTheDocument();
    expect(container.querySelector('[data-period-kind]')).toHaveAttribute('data-period-kind', 'unknown');
    assertOperationalBriefDisclosure(document.body, 'Derived');
    fireEvent.click(screen.getByRole('button', { name: 'Review details', exact: true }));
    const details = screen.getByRole('dialog');
    expect(within(details).getByText('3 charge source records; 2 drive source records')).toBeVisible();
    expect(within(details).getByText('Derived', { exact: true })).toBeInTheDocument();
    expect(within(details).getAllByText(english.chargeDepartureAlignment.modernization.inference)).toHaveLength(2);
    expect(within(details).getAllByText(/not complete lifetime coverage/).length).toBeGreaterThan(0);
    expect(within(details).getByRole('group', { name: 'Misaligned rate' })).toHaveTextContent('1 of 2 paired sessions');
    expect(within(details).getByRole('group', { name: 'Paired sessions' })).toHaveTextContent('of 3 ended charges within 24h of a drive');
    expect(JSON.stringify(input)).toBe(original);
    expect(input.avgDwellS).toBe(4500);
  });

  it('keeps unavailable history unknown rather than inventing zero counts or measured values', () => {
    const { container } = render(<AlignmentStats {...props({ summary: undefined })} />, { wrapper: Harness });
    assertOperationalBriefDisclosure(document.body, 'Source unavailable');
    expect(container.querySelectorAll('[data-operational-metric]')).toHaveLength(0);
    expect(screen.getByText('No metric values are available yet.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Review details', exact: true }));
    expect(within(screen.getByRole('dialog')).getByText('4 empty fields are hidden.')).toBeInTheDocument();
    expect(screen.queryByText('No source measurements')).not.toBeInTheDocument();
  });

  it('keeps known empty counts at zero while dwell margin and rate remain missing', () => {
    const empty = summary({
      totalEndedCharges: 0, pairedCount: 0, unpairedCount: 0, avgDwellS: 0,
      avgReadinessMarginPct: null, misalignedCount: 0, misalignedRatePct: 0,
    });
    const { container } = render(<AlignmentStats {...props({ summary: empty })} />, { wrapper: Harness });
    expect(metric(container, 'alignment-paired')).toHaveAttribute('data-value-state', 'value');
    expect(metric(container, 'alignment-paired').querySelector('[data-operational-value]')).toHaveTextContent('0');
    expect(container.querySelectorAll('[data-operational-metric]')).toHaveLength(1);
    assertOperationalBriefDisclosure(document.body, 'No paired sessions to show yet.');
    fireEvent.click(screen.getByRole('button', { name: 'Review details', exact: true }));
    expect(within(screen.getByRole('dialog')).getByText('3 empty fields are hidden.')).toBeInTheDocument();
    expect(screen.queryByText('Derived', { exact: true })).not.toBeInTheDocument();
  });

  it('preserves valid derived zero and partial margin without treating either as measured source availability', () => {
    const zero = summary({ avgDwellS: 0, avgReadinessMarginPct: 0, misalignedCount: 0, misalignedRatePct: 0 });
    const { container, rerender } = render(<AlignmentStats {...props({ summary: zero })} />, { wrapper: Harness });
    assertOperationalBriefDisclosure(document.body, 'Derived');
    expect(metric(container, 'alignment-avg-dwell')).toHaveTextContent('0m');
    expect(metric(container, 'alignment-avg-margin')).toHaveTextContent('0.00%');
    expect(metric(container, 'alignment-misaligned-rate')).toHaveTextContent('0.00%');
    expect(container.querySelectorAll('[data-value-state="value"]')).toHaveLength(4);
    rerender(<AlignmentStats {...props({ summary: { ...zero, avgReadinessMarginPct: null } })} />);
    assertOperationalBriefDisclosure(document.body, 'Partial source');
    expect(container.querySelectorAll('[data-value-state="value"]')).toHaveLength(3);
    fireEvent.click(screen.getByRole('button', { name: 'Review details', exact: true }));
    expect(within(screen.getByRole('dialog')).getByText('1 empty field is hidden.')).toBeInTheDocument();
  });

  it.each([
    { case: 'below', rate: 39.9, tone: 'success' },
    { case: 'at', rate: 40, tone: 'warning' },
    { case: 'above', rate: 40.1, tone: 'warning' },
  ])('preserves the heuristic warning threshold $case forty percent', ({ rate, tone }) => {
    render(<AlignmentStats {...props({ summary: summary({ misalignedRatePct: rate }) })} />,
      { wrapper: Harness });
    fireEvent.click(screen.getByRole('button', { name: 'Review details', exact: true }));
    const group = within(screen.getByRole('dialog')).getByRole('group', { name: 'Misaligned rate' });
    expect(within(group).getByText('Heuristic flags, not confirmed faults'))
      .toHaveClass(`text-[var(--semantic-${tone})]`);
  });

  it('suppresses initial loading values but keeps retained derived values and independent recovery visible', () => {
    const retry = vi.fn();
    const initial = props({ summary: undefined, loading: true });
    const { container, rerender } = render(<AlignmentStats {...initial} />, { wrapper: Harness });
    assertOperationalBriefDisclosure(document.body, 'Loading source');
    expect(container.querySelectorAll('[data-operational-value]')).toHaveLength(0);
    rerender(<AlignmentStats {...props({
      loading: true, retained: true,
      historyContext: <a href="#charging-source" onClick={retry}>Review retained history</a>,
    })} />);
    assertOperationalBriefDisclosure(document.body, 'Retained source');
    expect(container.querySelector('[data-retained]')).toHaveAttribute('data-retained', 'true');
    expect(container.querySelectorAll('[data-operational-value]')).toHaveLength(4);
    expect(metric(container, 'alignment-avg-dwell')).toHaveTextContent('1h 15m');
    fireEvent.click(screen.getByRole('button', { name: 'Review details', exact: true }));
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('link', { name: 'Review retained history' }));
    expect(retry).toHaveBeenCalledOnce();
    expect(screen.queryByText('Retained source measurements')).not.toBeInTheDocument();
  });

  it('uses locale precision without converting or mutating canonical duration and percentage inputs', () => {
    setGlobalLocale('de-DE');
    setGlobalPrecision(3);
    const input = summary();
    const { container } = render(<AlignmentStats {...props({ summary: input })} />, { wrapper: Harness });
    expect(metric(container, 'alignment-avg-margin')).toHaveTextContent('45,100%');
    expect(metric(container, 'alignment-misaligned-rate')).toHaveTextContent('50,000%');
    expect(metric(container, 'alignment-avg-dwell')).toHaveTextContent('1h 15m');
    expect(input.avgDwellS).toBe(4500);
    expect(input.avgReadinessMarginPct).toBe(45.1);
    expect(input.misalignedRatePct).toBe(50);
  });
});
