import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { createInstance } from 'i18next';
import { I18nextProvider, initReactI18next } from 'react-i18next';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { buildOdometerMilestones } from '../../lib/odometerMilestones';
import { MilestoneProgress } from './MilestoneProgress';
import type { MilestoneSectionState } from './types';

vi.unmock('react-i18next');

const i18n = createInstance();
const labels = [
  'Previous milestone',
  'Current odometer',
  'Next milestone',
  'Remaining',
];
const ready: MilestoneSectionState = {
  isLoading: false,
  error: null,
  onRetry: vi.fn(),
};
const summary = (baseOdometerKm = 12_500) =>
  buildOdometerMilestones([], {
    baseOdometerKm,
    nowMs: Date.parse('2026-08-01T00:00:00Z'),
    milestoneUnitKm: 1,
  });

beforeEach(async () => {
  vi.clearAllMocks();
  await i18n.use(initReactI18next).init({
    lng: 'en',
    fallbackLng: false,
    resources: { en: { translation: {} } },
    interpolation: { escapeValue: false },
  });
});

describe('MilestoneProgress definition and help contract', () => {
  it('keeps one native list with four valid term-definition groups in source', () => {
    const source = readFileSync(resolve(
      process.cwd(), 'src', 'features', 'analytics', 'components',
      'odometer-milestones', 'MilestoneProgress.tsx',
    ), 'utf8');
    expect(source.match(/<dl\b/g)).toHaveLength(1);
    expect(source).toContain('<Text as="dt" variant="caption">');
    expect(source).toContain('as="dd"');
    expect(source.match(/key: '(previous|current|next|remaining)'/g)).toHaveLength(4);
    expect(source).not.toContain('chronologically first row');
  });

  it('renders every label with its value, preserving mobile reading order and desktop allocation', () => {
    const { container } = render(
      <I18nextProvider i18n={i18n}>
        <MilestoneProgress summary={summary()} state={ready} />
      </I18nextProvider>,
    );
    const list = container.querySelector('dl')!;
    const terms = within(list).getAllByRole('term');
    const definitions = within(list).getAllByRole('definition');
    expect(container.querySelectorAll('dl')).toHaveLength(1);
    expect(terms.map(term => term.textContent)).toEqual(labels);
    expect(definitions.map(definition => definition.textContent)).toEqual([
      '10,000.00 km', '12,500.00 km', '20,000.00 km', '7,500.00 km',
    ]);
    expect(list).toHaveClass('grid', 'min-w-0', 'grid-cols-2', 'gap-3', 'lg:grid-cols-4');
    expect(list).toHaveAttribute('data-layout', 'responsive-columns');
    expect(list.children).toHaveLength(4);
    Array.from(list.children).forEach((group, index) => {
      expect(group.tagName).toBe('DIV');
      expect(Array.from(group.children)).toEqual([terms[index], definitions[index]]);
      expect(group).toHaveClass('rounded-xl', 'p-3');
      expect(definitions[index]).toHaveClass('mt-1', 'tabular-nums');
    });
    expect(screen.getByRole('img')).toHaveAccessibleName(
      '25.00 percent progress toward the next milestone',
    );
  });

  it('keeps measured zero distinct from unknown distance', () => {
    const { rerender } = render(
      <I18nextProvider i18n={i18n}>
        <MilestoneProgress summary={summary(0)} state={ready} />
      </I18nextProvider>,
    );
    expect(screen.getAllByRole('definition').map(node => node.textContent)).toEqual([
      '0.00 km', '0.00 km', '10,000.00 km', '10,000.00 km',
    ]);
    expect(screen.getByRole('img')).toHaveAccessibleName(
      '0.00 percent progress toward the next milestone',
    );
    const unknown = summary();
    rerender(
      <I18nextProvider i18n={i18n}>
        <MilestoneProgress summary={{
          ...unknown,
          currentOdometerKm: Number.NaN,
          segment: {
            ...unknown.segment,
            previousMilestoneKm: Number.NaN,
            nextMilestoneKm: Number.NaN,
            remainingKm: Number.NaN,
          },
        }} state={ready} />
      </I18nextProvider>,
    );
    expect(screen.getAllByRole('term').map(node => node.textContent)).toEqual(labels);
    expect(screen.getAllByRole('definition').map(node => node.textContent)).toEqual([
      '—', '—', '—', '—',
    ]);
  });

  it.each([
    [9_000, ['0.00 km', '9,000.00 km', '10,000.00 km', '1,000.00 km'], '90.00'],
    [10_000, ['10,000.00 km', '10,000.00 km', '20,000.00 km', '10,000.00 km'], '0.00'],
    [100_000, ['100,000.00 km', '100,000.00 km', '150,000.00 km', '50,000.00 km'], '0.00'],
    [125_000, ['100,000.00 km', '125,000.00 km', '150,000.00 km', '25,000.00 km'], '50.00'],
  ] as const)('preserves threshold values and ratio at %s km', (base, values, percent) => {
    render(
      <I18nextProvider i18n={i18n}>
        <MilestoneProgress summary={summary(base)} state={ready} />
      </I18nextProvider>,
    );
    expect(screen.getAllByRole('definition').map(node => node.textContent)).toEqual(values);
    expect(screen.getByRole('img')).toHaveAccessibleName(
      `${percent} percent progress toward the next milestone`,
    );
  });

  it('renders the canonical first-eligible-drive help fallback through the real tooltip action', () => {
    const canonical: { help: { milestones: { body: string } } } = JSON.parse(
      readFileSync(resolve(process.cwd(), 'src', 'i18n', 'en.json'), 'utf8'),
    );
    expect(i18n.exists('help.milestones.body')).toBe(false);
    render(
      <I18nextProvider i18n={i18n}>
        <MilestoneProgress summary={summary()} state={ready} />
      </I18nextProvider>,
    );
    const help = screen.getByRole('button', { name: 'More info about milestone math' });
    fireEvent.focus(help);
    const tooltip = screen.getByRole('tooltip');
    expect(tooltip.textContent).toBe(canonical.help.milestones.body);
    expect(tooltip).toHaveTextContent('chronologically first eligible drive');
    expect(help).toHaveAttribute('aria-describedby', tooltip.id);
    expect(screen.getByRole('heading', { name: 'Progress to the next round number' })).toBeInTheDocument();
    expect(screen.getByText(
      'Progress currently reflects calibration only; eligible drives will add observed growth.',
    )).toBeInTheDocument();
  });

  it('keeps the section, title and help action mounted during loading', () => {
    render(
      <I18nextProvider i18n={i18n}>
        <MilestoneProgress summary={summary()} state={{ ...ready, isLoading: true }} />
      </I18nextProvider>,
    );
    expect(screen.getByRole('region', { name: 'Progress to next milestone' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Progress to the next round number' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'More info about milestone math' })).toBeInTheDocument();
    expect(screen.queryByRole('definition')).not.toBeInTheDocument();
  });
});
