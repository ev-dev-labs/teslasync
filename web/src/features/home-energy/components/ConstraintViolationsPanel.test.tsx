import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import { createInstance } from 'i18next';
import canonicalEnglish from '@/i18n/en.json';
import generatedEnglish from '@/i18n/en/locale-home-energy.json';
import { severityTokens } from '@/lib/tokens';
import type { Violation } from '../lib/types';
import { ConstraintViolationsPanel } from './ConstraintViolationsPanel';

afterEach(() => {
  cleanup();
});

function expectDecorativeIcon(container: HTMLElement, glyph: string, foreground: string) {
  const icon = container.querySelector(`svg.lucide-${glyph}`);
  expect(icon).toBeInTheDocument();
  expect(icon).toHaveClass('h-4', 'w-4', 'shrink-0', foreground);
  expect(icon).toHaveAttribute('aria-hidden', 'true');
  expect(icon).toHaveAttribute('focusable', 'false');
  expect(icon).toHaveAttribute('stroke-width', '2');
  expect(icon).not.toHaveAttribute('role', 'img');
  for (const fixedForeground of ['text-emerald-500', 'text-red-500', 'text-amber-500']) {
    expect(icon).not.toHaveClass(fixedForeground);
  }
}

describe('ConstraintViolationsPanel severity icon presentation', () => {
  it('resolves every violation template from canonical and generated English without fallbacks', async () => {
    const messages = [
      ['deadlineInfeasible', { vehicleName: 'Family vehicle' }, 'Family vehicle cannot reach its target state of charge before its departure deadline.'],
      ['vehicleShortfall', { vehicleName: 'Second vehicle', unmet: '1.25 kWh' }, 'Second vehicle is projected to fall short of its target by 1.25 kWh.'],
      ['panelImportExceeded', { slot: 0 }, 'Grid import limit exceeded in slot #0.'],
      ['panelExportExceeded', { slot: 4 }, 'Grid export limit exceeded in slot #4.'],
      ['powerwallReserveBreach', { slot: 5 }, 'Powerwall dropped below its reserve floor in slot #5.'],
      ['invalidInput', { detail: 'forecast_length_mismatch' }, 'Some plan inputs were invalid and were adjusted or dropped: forecast_length_mismatch'],
      ['unknownVehicle', {}, 'A vehicle'],
    ] as const;

    for (const catalog of [canonicalEnglish, generatedEnglish]) {
      const translations = createInstance();
      await translations.init({
        lng: 'en',
        fallbackLng: false,
        resources: { en: { translation: catalog } },
        interpolation: { escapeValue: false },
      });
      for (const [name, variables, message] of messages) {
        const key = `homeEnergy.violation.${name}`;
        expect(translations.exists(key)).toBe(true);
        expect(translations.t(key, variables)).toBe(message);
      }
    }
    expect(generatedEnglish.homeEnergy.violation).toEqual(canonicalEnglish.homeEnergy.violation);
  });

  it('uses a decorative semantic success icon only for the existing clean report', () => {
    const { container } = render(<ConstraintViolationsPanel violations={[]} />);

    expect(screen.getByRole('heading', { name: 'Constraint violations' })).toBeInTheDocument();
    expect(screen.getByText('No violations')).toHaveClass('text-[var(--semantic-success)]');
    expect(screen.getByText('This plan satisfies every hard constraint modeled.')).toBeInTheDocument();
    expect(screen.queryByRole('list')).not.toBeInTheDocument();
    expect(container.querySelectorAll('svg')).toHaveLength(1);
    expectDecorativeIcon(container, 'shield-check', severityTokens.success.fg);
  });

  it('preserves every constraint message and error-first ordering with semantic severity icons', () => {
    const violations: Violation[] = [
      { code: 'panel_export_exceeded', severity: 'warning', slotIndex: 4 },
      { code: 'deadline_infeasible', severity: 'error', vehicleId: '41', vehicleName: 'Family vehicle' },
      { code: 'powerwall_reserve_breach', severity: 'warning', slotIndex: 5 },
      { code: 'vehicle_shortfall', severity: 'error', vehicleId: '42', vehicleName: 'Second vehicle', unmetWh: 1250 },
      { code: 'invalid_input', severity: 'warning', detail: 'forecast_length_mismatch' },
      { code: 'panel_import_exceeded', severity: 'error', slotIndex: 3 },
    ];
    render(<ConstraintViolationsPanel violations={violations} />);

    expect(screen.getByText('3 error(s)')).toHaveClass('text-[var(--semantic-danger)]');
    const rows = screen.getAllByRole('listitem');
    expect(rows.map(row => row.textContent)).toEqual([
      'Family vehicle cannot reach its target state of charge before its departure deadline.',
      'Second vehicle is projected to fall short of its target by 1.25 kWh.',
      'Grid import limit exceeded in slot #3.',
      'Grid export limit exceeded in slot #4.',
      'Powerwall dropped below its reserve floor in slot #5.',
      'Some plan inputs were invalid and were adjusted or dropped: Review the plan inputs for invalid values.',
    ]);
    // Unstructured machine detail stays available for diagnostics, not as visible copy.
    expect(rows[5]).toHaveAttribute('data-machine-detail', 'forecast_length_mismatch');
    expect(rows[5]).not.toHaveAttribute('data-reason-id');
    rows.forEach((row, index) => {
      expect(row.querySelectorAll('svg')).toHaveLength(1);
      expectDecorativeIcon(
        row,
        index < 3 ? 'shield-alert' : 'triangle-alert',
        index < 3 ? severityTokens.critical.fg : severityTokens.warn.fg,
      );
      expect(row.querySelector('svg')).toHaveClass('mt-0.5');
    });
    expect(screen.queryByText('This plan satisfies every hard constraint modeled.')).not.toBeInTheDocument();
  });

  it('retains warning counts and details without promoting a warning-only report to clean', () => {
    const violations: Violation[] = [
      { code: 'invalid_input', severity: 'warning', detail: 'departure_slot_unknown' },
      { code: 'powerwall_reserve_breach', severity: 'warning', slotIndex: 0 },
    ];
    const { rerender } = render(<ConstraintViolationsPanel violations={violations} />);
    rerender(<ConstraintViolationsPanel violations={violations} />);

    expect(screen.getByText('2 warning(s)')).toHaveClass('text-[var(--semantic-warning)]');
    const rows = within(screen.getByRole('list')).getAllByRole('listitem');
    expect(rows.map(row => row.textContent)).toEqual([
      'Some plan inputs were invalid and were adjusted or dropped: Review the plan inputs for invalid values.',
      'Powerwall dropped below its reserve floor in slot #0.',
    ]);
    expect(rows[0]).toHaveAttribute('data-machine-detail', 'departure_slot_unknown');
    rows.forEach(row => expectDecorativeIcon(row, 'triangle-alert', severityTokens.warn.fg));
    expect(screen.queryByText('No violations')).not.toBeInTheDocument();
    expect(screen.queryByText('This plan satisfies every hard constraint modeled.')).not.toBeInTheDocument();
  });

  it('localizes structured validation reasons with stable ids and arguments', () => {
    const violations: Violation[] = [
      {
        code: 'invalid_input', severity: 'warning',
        reason: { id: 'slot_minutes_invalid', args: { defaultMinutes: 15 } },
        detail: 'slotMinutes must be positive; defaulted to 15',
      },
      {
        code: 'invalid_input', severity: 'warning', vehicleId: 'v-1',
        reason: { id: 'vehicle_capacity_invalid' },
        detail: 'usableCapacityWh must be > 0 — vehicle dropped',
      },
    ];
    render(<ConstraintViolationsPanel violations={violations} />);

    const rows = screen.getAllByRole('listitem');
    expect(rows.map(row => row.textContent)).toEqual([
      'Some plan inputs were invalid and were adjusted or dropped: Slot duration must be positive; 15 minutes was used instead.',
      'Some plan inputs were invalid and were adjusted or dropped: A vehicle with invalid usable battery capacity was excluded.',
    ]);
    expect(rows[0]).toHaveAttribute('data-reason-id', 'slot_minutes_invalid');
    expect(rows[0]).toHaveAttribute('data-reason-args', JSON.stringify({ defaultMinutes: 15 }));
    expect(rows[0]).toHaveAttribute('data-machine-detail', 'slotMinutes must be positive; defaulted to 15');
    expect(rows[1]).toHaveAttribute('data-reason-id', 'vehicle_capacity_invalid');
    expect(rows[1]).not.toHaveAttribute('data-reason-args');
  });

  it('keeps missing energy and slot evidence distinct from measured zero', () => {
    const violations: Violation[] = [
      { code: 'vehicle_shortfall', severity: 'error' },
      { code: 'vehicle_shortfall', severity: 'error', vehicleName: 'Measured vehicle', unmetWh: 0 },
      { code: 'panel_import_exceeded', severity: 'warning' },
      { code: 'panel_import_exceeded', severity: 'warning', slotIndex: 0 },
    ];
    render(<ConstraintViolationsPanel violations={violations} />);

    expect(screen.getByText('2 error(s)')).toBeInTheDocument();
    const rows = screen.getAllByRole('listitem');
    expect(rows.map(row => row.textContent)).toEqual([
      'A vehicle is projected to fall short of its target by .',
      'Measured vehicle is projected to fall short of its target by 0.00 kWh.',
      'Grid import limit exceeded in slot #—.',
      'Grid import limit exceeded in slot #0.',
    ]);
    expectDecorativeIcon(rows[0], 'shield-alert', severityTokens.critical.fg);
    expectDecorativeIcon(rows[2], 'triangle-alert', severityTokens.warn.fg);
  });
});
