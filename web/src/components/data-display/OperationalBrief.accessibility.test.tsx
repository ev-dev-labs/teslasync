import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { formatOperationalMetrics } from '@/lib/operationalMetrics';
import type { MetricPreferences } from '@/lib/metric-reference';
import type { StatMetric } from './stat-reference/types';
import { OperationalBrief, type OperationalBriefProps } from './OperationalBrief';

const translated = vi.hoisted(() => ({
  review: 'Ausführliche Einzelheiten und den vollständigen Quellenkontext prüfen',
  reviewAll: 'Alle Hinweise einschließlich der zusätzlichen Quellenbeschränkungen prüfen',
  close: 'Einzelheiten schließen',
  title: 'Betriebsübersicht mit vollständiger Quellenlage und ausführlicher Entscheidungsgrundlage',
  label: 'Anzahl der vollständig dokumentierten und im ausgewählten Zeitraum bestätigten Vorgänge',
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    i18n: { language: 'de-DE' },
    t: (key: string, fallback: string, options?: Record<string, unknown>) => {
      const labels: Record<string, string> = {
        'operations.reviewDetails': translated.review,
        'operations.reviewAll': translated.reviewAll,
        'operations.detailTitle': 'Einzelheiten zu {{title}}',
        'common.close': translated.close,
      };
      const countedFallback = options?.count === 1
        ? options.defaultValue_one ?? fallback : options?.defaultValue_other ?? fallback;
      return String(labels[key] ?? countedFallback).replace(
        /\{\{\s*(\w+)\s*\}\}/g,
        (_, name: string) => String(options?.[name] ?? ''),
      );
    },
  }),
}));

afterEach(cleanup);

const preferences: MetricPreferences = {
  units: {
    distance: 'km', speed: 'km/h', temperature: '°C', pressure: 'kPa',
    energy: 'kWh', power: 'kW', duration: 's', precision: 2, locale: 'en-US',
  },
  currency: { kind: 'symbol', value: '$' },
};

const baseProps: OperationalBriefProps = {
  eyebrow: 'Quellenlage',
  title: translated.title,
  description: 'Vollständige Erläuterung der verfügbaren Messwerte und ihrer Grenzen.',
  statusLabel: 'Live',
  metrics: [],
};

const translateFallback = (_key: string, fallback: string) => fallback;
const format = (metrics: readonly StatMetric[]) =>
  formatOperationalMetrics(metrics, preferences, translateFallback);

function brief(props: Partial<OperationalBriefProps> = {}) {
  return (
    <MemoryRouter>
      <OperationalBrief {...baseProps} {...props} />
    </MemoryRouter>
  );
}

function summary() {
  return screen.getByRole('region', { name: translated.title });
}

function details() {
  return screen.getByRole('dialog', { name: `Einzelheiten zu ${translated.title}` });
}

describe('OperationalBrief accessible source publication', () => {
  it('preserves translated metric links on the card and rich source context in details', () => {
    const metrics = format([{
      metricId: 'count', occurrenceId: 'confirmed', rawValue: 0,
      label: translated.label,
      description: 'Nur bestätigte Vorgänge aus der angegebenen Quelle.',
      href: '/evidence/confirmed',
      context: <>
        <strong>Vollständiger Quellenkontext</strong>
        <span> einschließlich der zuletzt bestätigten Beobachtung. </span>
        <a href="/evidence/source-record">Den vollständigen Quelldatensatz überprüfen</a>
      </>,
      comparison: {
        metricId: 'count', rawValue: 2, label: 'Vorheriger Vergleichswert',
        period: { kind: 'unknown', label: 'Vergleichszeitraum unbekannt', reason: 'Keine Zeitgrenzen geliefert' },
      },
    }]);
    render(brief({ metrics }));
    const valueName = `${translated.label}: 0; Vorheriger Vergleichswert: 2; Vergleichszeitraum unbekannt; Keine Zeitgrenzen geliefert`;
    const checkSurface = (surface: HTMLElement) => {
      const queries = within(surface);
      expect(queries.getByText(translated.label)).toBeVisible();
      expect(queries.getByRole('link', { name: valueName })).toHaveAttribute('href', '/evidence/confirmed');
    };
    const checkContext = (surface: HTMLElement) => {
      const queries = within(surface);
      expect(queries.getByRole('link', { name: 'Den vollständigen Quelldatensatz überprüfen' }))
        .toHaveAttribute('href', '/evidence/source-record');
      expect(queries.getByText('Vollständiger Quellenkontext').tagName).toBe('STRONG');
      expect(queries.getByText('einschließlich der zuletzt bestätigten Beobachtung.')).toBeVisible();
      expect(queries.getByText('Nur bestätigte Vorgänge aus der angegebenen Quelle.')).toBeVisible();
    };
    checkSurface(summary());
    expect(within(summary()).queryByText('Vollständiger Quellenkontext')).not.toBeInTheDocument();
    const review = within(summary()).getByRole('button', { name: translated.review });
    expect(review).toHaveAccessibleName(translated.review);
    expect(review).not.toHaveTextContent(translated.review);
    expect(document.getElementById(review.getAttribute('aria-describedby') ?? ''))
      .toHaveTextContent(translated.review);
    fireEvent.click(review);
    const dialog = details();
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(dialog).toHaveAccessibleDescription(baseProps.description);
    expect(dialog).toHaveAccessibleName(`Einzelheiten zu ${translated.title}`);
    checkSurface(dialog);
    checkContext(dialog);
  });

  it('traps keyboard focus around real metric links and restores the review opener on Escape', () => {
    const metrics = format([{
      metricId: 'count', rawValue: 3, label: translated.label,
      href: '/evidence/keyboard',
      context: <a href="/evidence/method">Quellenmethode überprüfen</a>,
    }]);
    const { rerender } = render(brief({ metrics }));
    const opener = within(summary()).getByRole('button', { name: translated.review });
    act(() => opener.focus());
    fireEvent.click(opener);
    const dialog = details();
    const closeButtons = within(dialog).getAllByRole('button', { name: translated.close });
    const first = closeButtons[0];
    const last = closeButtons[closeButtons.length - 1];
    expect(first).toHaveFocus();
    const valueLink = within(dialog).getByRole('link', { name: `${translated.label}: 3` });
    act(() => valueLink.focus());
    expect(valueLink).toHaveFocus();
    rerender(brief({ metrics, freshness: 'Quelle erneut geprüft' }));
    expect(valueLink).toHaveFocus();
    const sourceLink = within(dialog).getByRole('link', { name: 'Quellenmethode überprüfen' });
    act(() => sourceLink.focus());
    expect(sourceLink).toHaveFocus();
    act(() => last.focus());
    fireEvent.keyDown(last, { key: 'Tab' });
    expect(first).toHaveFocus();
    fireEvent.keyDown(first, { key: 'Tab', shiftKey: true });
    expect(last).toHaveFocus();
    const escaped = vi.fn();
    document.addEventListener('keydown', escaped);
    try {
      fireEvent.keyDown(last, { key: 'Escape' });
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      expect(opener).toHaveFocus();
      expect(escaped).not.toHaveBeenCalled();
    } finally {
      document.removeEventListener('keydown', escaped);
    }
  });

  it('opens secondary attention through Review all and restores that distinct trigger on footer close', () => {
    render(brief({
      attention: [
        { key: 'primary', title: 'Primärer Hinweis', description: 'Aktuell bestätigte Beobachtung.' },
        { key: 'secondary', title: 'Zusätzliche Quellenbeschränkung', description: 'Nicht alle Datensätze sind eingetroffen.' },
      ],
    }));
    expect(within(summary()).queryByText('Zusätzliche Quellenbeschränkung')).not.toBeInTheDocument();
    const opener = within(summary()).getByRole('button', { name: translated.reviewAll });
    expect(opener).toHaveClass('whitespace-normal', 'min-h-11', 'md:min-h-9');
    act(() => opener.focus());
    fireEvent.click(opener);
    const dialog = details();
    expect(within(dialog).getByText('Zusätzliche Quellenbeschränkung')).toBeVisible();
    expect(within(dialog).getByText('Nicht alle Datensätze sind eingetroffen.')).toBeVisible();
    const closeButtons = within(dialog).getAllByRole('button', { name: translated.close });
    act(() => closeButtons[closeButtons.length - 1].focus());
    fireEvent.click(closeButtons[closeButtons.length - 1]);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(opener).toHaveFocus();
  });

  it.each([
    { status: 'Live', freshness: 'Observed at 2026-10-06T23:00:00Z', provenance: 'Live confirmed source', raw: 8, loading: false },
    { status: 'Retained', freshness: 'Last confirmed at 2026-10-06T22:00:00Z; refresh failed', provenance: 'Retained confirmed snapshot', raw: 8, loading: false },
    { status: 'Unknown', freshness: 'Observation time unknown', provenance: 'Source has not supplied a measurement', raw: null, loading: false },
    { status: 'Loading', freshness: 'Waiting for the first confirmed observation', provenance: 'No confirmed source yet', raw: null, loading: true },
  ] as const)('publishes caller-declared $status trust without losing source context in the drawer', ({ status, freshness, provenance, raw, loading }) => {
    render(brief({
      statusLabel: status, freshness, provenance, loading,
      scope: <span>Selected source only</span>,
      metrics: format([{
        metricId: 'count', rawValue: raw, label: 'Confirmed observations',
        context: provenance, missingReason: raw === null ? 'No confirmed measurement supplied' : undefined,
      }]),
    }));
    const region = summary();
    expect(within(region).queryByText(status)).not.toBeInTheDocument();
    expect(within(region).queryByText(freshness)).not.toBeInTheDocument();
    expect(within(region).queryByText('Selected source only')).not.toBeInTheDocument();
    expect(region).not.toHaveTextContent(provenance);
    const item = region.querySelector('[data-operational-metric]');
    if (loading) {
      expect(region).toHaveAttribute('aria-busy', 'true');
      expect(item).toHaveAttribute('data-value-state', 'missing');
      expect(item?.querySelector('[data-operational-value]')).toBeNull();
    } else {
      expect(region).not.toHaveAttribute('aria-busy');
      if (raw === null) {
        expect(item).not.toBeInTheDocument();
        expect(within(region).getByText('No metric values are available yet.')).toBeVisible();
      } else {
        expect(item).toHaveAttribute('data-value-state', 'value');
        expect(item).toHaveTextContent(String(raw));
      }
    }
    fireEvent.click(within(region).getByRole('button', { name: translated.review }));
    const dialog = details();
    expect(within(dialog).getByText(status)).toBeVisible();
    expect(within(dialog).getByText(freshness)).toBeVisible();
    expect(within(dialog).getByText('Selected source only')).toBeVisible();
    expect(within(dialog).getAllByText(provenance).length).toBeGreaterThanOrEqual(1);
    expect(within(dialog).getByText('Not scored')).toBeVisible();
    expect(within(dialog).getByText('No supporting records were supplied.')).toBeVisible();
    if (raw === null) {
      if (loading) expect(within(dialog).getByText('No confirmed measurement supplied')).toBeVisible();
      else expect(within(dialog).getByText('1 empty field is hidden.')).toBeVisible();
      expect(within(dialog).queryByText('0', { exact: true })).not.toBeInTheDocument();
    }
  });

  it('keeps measured zero actionable while reporting omitted missing and invalid readings', () => {
    const cases = [
      { key: 'zero', raw: 0, label: 'Measured zero', state: 'value', value: '0', reason: undefined },
      { key: 'missing', raw: null, label: 'Missing observation', state: 'missing', value: '—', reason: 'Source did not supply this observation' },
      { key: 'invalid', raw: NaN, label: 'Invalid observation', state: 'invalid', value: '—', reason: 'Expected a finite numeric measurement' },
    ] as const;
    const metrics = format(cases.map((entry) => ({
        metricId: 'count', occurrenceId: entry.key, rawValue: entry.raw,
        label: entry.label, href: `/evidence/${entry.key}`,
        missingReason: entry.key === 'missing' ? entry.reason : undefined,
        context: `Source record: ${entry.key}`,
      })));
    expect(metrics.map(metric => metric.valueState)).toEqual(cases.map(entry => entry.state));
    render(brief({ metrics }));
    const items = within(summary()).getAllByRole('listitem');
    expect(items).toHaveLength(1);
    expect(items[0]).toHaveAttribute('data-value-state', 'value');
    const checkValues = (surface: HTMLElement) => {
      const link = within(surface).getByRole('link', { name: 'Measured zero: 0' });
      expect(link).toHaveAttribute('href', '/evidence/zero');
      expect(link).toHaveTextContent('0');
      expect(link).not.toHaveAttribute('aria-hidden');
      for (const entry of cases.slice(1)) {
        expect(within(surface).queryByText(entry.label)).not.toBeInTheDocument();
        expect(within(surface).queryByRole('link', { name: new RegExp(entry.label) })).not.toBeInTheDocument();
        expect(within(surface).queryByText(`Source record: ${entry.key}`)).not.toBeInTheDocument();
      }
    };
    checkValues(summary());
    fireEvent.click(within(summary()).getByRole('button', { name: translated.review }));
    const dialog = details();
    checkValues(dialog);
    expect(within(dialog).getByText('Source record: zero')).toBeVisible();
    expect(within(dialog).getByText('2 empty fields are hidden.')).toBeVisible();
  });

  it('does not publish a suppressed loading measurement through Review details', () => {
    render(brief({
      loading: true, statusLabel: 'Loading',
      metrics: format([{
        metricId: 'count', rawValue: 913,
        label: 'Pending measurement', href: '/evidence/pending',
        context: 'Source observation is not yet confirmed',
      }]),
    }));
    expect(summary()).toHaveAttribute('aria-busy', 'true');
    expect(within(summary()).queryByRole('link', { name: 'Pending measurement: 913' })).not.toBeInTheDocument();
    fireEvent.click(within(summary()).getByRole('button', { name: translated.review }));
    const dialog = details();
    expect(within(dialog).getByText('Pending measurement')).toBeVisible();
    expect(within(dialog).getByText('Source observation is not yet confirmed')).toBeVisible();
    expect(within(dialog).queryByRole('link', { name: 'Pending measurement: 913' })).not.toBeInTheDocument();
    expect(within(dialog).queryByText('913', { exact: true })).not.toBeInTheDocument();
    expect(summary().querySelector('[class*="animate-pulse"]')).toBeNull();
    expect(dialog.querySelector('[class*="animate-pulse"]')).toBeNull();
  });
});
