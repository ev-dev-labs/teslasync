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
      return (labels[key] ?? fallback).replace(
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
  it('preserves translated metric names, rich source context and actionable links in both surfaces', () => {
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
      expect(queries.getByRole('link', { name: 'Den vollständigen Quelldatensatz überprüfen' }))
        .toHaveAttribute('href', '/evidence/source-record');
      expect(queries.getByText('Vollständiger Quellenkontext').tagName).toBe('STRONG');
      expect(queries.getByText('einschließlich der zuletzt bestätigten Beobachtung.')).toBeVisible();
      expect(queries.getByText('Nur bestätigte Vorgänge aus der angegebenen Quelle.')).toBeVisible();
    };
    checkSurface(summary());
    const review = within(summary()).getByRole('button', { name: translated.review });
    expect(review).toHaveClass('whitespace-normal', 'max-w-full', 'min-h-11', 'md:min-h-9');
    expect(review.querySelector('span:last-child')).toHaveClass('break-words');
    fireEvent.click(review);
    const dialog = details();
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(dialog).toHaveAccessibleDescription(baseProps.description);
    expect(dialog).toHaveAccessibleName(`Einzelheiten zu ${translated.title}`);
    checkSurface(dialog);
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
    expect(within(region).getByText(status)).toBeVisible();
    expect(within(region).getByText(freshness)).toBeVisible();
    expect(within(region).getByText('Selected source only')).toBeVisible();
    const item = within(region).getByRole('listitem');
    expect(item).toHaveTextContent(provenance);
    expect(item).toHaveAttribute('data-value-state', raw === null ? 'missing' : 'value');
    if (loading) {
      expect(region).toHaveAttribute('aria-busy', 'true');
      expect(item.querySelector('[data-operational-value]')).toBeNull();
    } else {
      expect(region).not.toHaveAttribute('aria-busy');
    }
    fireEvent.click(within(region).getByRole('button', { name: translated.review }));
    const dialog = details();
    expect(within(dialog).getByText(status)).toBeVisible();
    expect(within(dialog).getAllByText(provenance).length).toBeGreaterThanOrEqual(1);
    expect(within(dialog).getByText('Not scored')).toBeVisible();
    expect(within(dialog).getByText('No supporting records were supplied.')).toBeVisible();
    if (raw === null) {
      expect(within(dialog).getByText('No confirmed measurement supplied')).toBeVisible();
      expect(within(dialog).queryByText('0', { exact: true })).not.toBeInTheDocument();
    }
  });

  it('distinguishes measured zero from missing and invalid values through accessible links and explanations', () => {
    const cases = [
      { key: 'zero', raw: 0, label: 'Measured zero', state: 'value', value: '0', reason: undefined },
      { key: 'missing', raw: null, label: 'Missing observation', state: 'missing', value: '—', reason: 'Source did not supply this observation' },
      { key: 'invalid', raw: NaN, label: 'Invalid observation', state: 'invalid', value: '—', reason: 'Expected a finite numeric measurement' },
    ] as const;
    render(brief({
      metrics: format(cases.map((entry) => ({
        metricId: 'count', occurrenceId: entry.key, rawValue: entry.raw,
        label: entry.label, href: `/evidence/${entry.key}`,
        missingReason: entry.key === 'missing' ? entry.reason : undefined,
        context: `Source record: ${entry.key}`,
      }))),
    }));
    const items = within(summary()).getAllByRole('listitem');
    cases.forEach((entry, index) => {
      expect(items[index]).toHaveAttribute('data-value-state', entry.state);
      expect(items[index]).toHaveTextContent(`Source record: ${entry.key}`);
    });
    const checkValues = (surface: HTMLElement) => cases.forEach((entry) => {
      const accessibleName = `${entry.label}: ${entry.value}${entry.reason ? `; ${entry.reason}` : ''}`;
      const link = within(surface).getByRole('link', { name: accessibleName });
      expect(link).toHaveAttribute('href', `/evidence/${entry.key}`);
      expect(link).toHaveTextContent(entry.value);
      expect(link).not.toHaveAttribute('aria-hidden');
      if (entry.reason) expect(within(surface).getByText(entry.reason)).toBeVisible();
      expect(within(surface).getByText(`Source record: ${entry.key}`)).toBeVisible();
    });
    checkValues(summary());
    fireEvent.click(within(summary()).getByRole('button', { name: translated.review }));
    checkValues(details());
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
