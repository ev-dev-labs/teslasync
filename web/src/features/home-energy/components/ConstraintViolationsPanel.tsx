import { useTranslation } from 'react-i18next';
import { AlertTriangle, ShieldAlert, ShieldCheck } from 'lucide-react';
import { GlassPanel, PanelTitle, Badge } from '@/components/ui';
import { useUnits } from '@/hooks/useUnits';
import type { Violation, ViolationCode } from '../lib/types';

interface ConstraintViolationsPanelProps {
  violations: Violation[];
}

/** Maps a structured violation code to an i18n key + English fallback template. Never pre-rendered prose from the engine. */
const VIOLATION_TEMPLATES: Record<ViolationCode, string> = {
  deadline_infeasible: 'homeEnergy.violation.deadlineInfeasible',
  vehicle_shortfall: 'homeEnergy.violation.vehicleShortfall',
  panel_import_exceeded: 'homeEnergy.violation.panelImportExceeded',
  panel_export_exceeded: 'homeEnergy.violation.panelExportExceeded',
  powerwall_reserve_breach: 'homeEnergy.violation.powerwallReserveBreach',
  invalid_input: 'homeEnergy.violation.invalidInput',
};

const FALLBACKS: Record<ViolationCode, string> = {
  deadline_infeasible: '{{vehicleName}} cannot reach its target state of charge before its departure deadline.',
  vehicle_shortfall: '{{vehicleName}} is projected to fall short of its target by {{unmet}}.',
  panel_import_exceeded: 'Grid import limit exceeded in slot #{{slot}}.',
  panel_export_exceeded: 'Grid export limit exceeded in slot #{{slot}}.',
  powerwall_reserve_breach: 'Powerwall dropped below its reserve floor in slot #{{slot}}.',
  invalid_input: 'Some plan inputs were invalid and were adjusted or dropped: {{detail}}',
};

/** Structured constraint-violation / infeasibility report, grouped by severity. Never fabricates readiness. */
export function ConstraintViolationsPanel({ violations }: ConstraintViolationsPanelProps) {
  const { t } = useTranslation();
  const { formatEnergy } = useUnits();

  const errors = violations.filter((v) => v.severity === 'error');
  const warnings = violations.filter((v) => v.severity === 'warning');

  function describe(v: Violation): string {
    return t(VIOLATION_TEMPLATES[v.code], FALLBACKS[v.code], {
      vehicleName: v.vehicleName ?? t('homeEnergy.violation.unknownVehicle', 'A vehicle'),
      unmet: v.unmetWh != null ? formatEnergy(v.unmetWh) : '',
      slot: v.slotIndex ?? '—',
      detail: v.detail ?? '',
    });
  }

  return (
    <GlassPanel className="p-4 sm:p-5">
      <div className="mb-3 flex items-center justify-between">
        <PanelTitle>{t('homeEnergy.violations.title', 'Constraint Violations')}</PanelTitle>
        <Badge variant={errors.length > 0 ? 'danger' : warnings.length > 0 ? 'warning' : 'success'} size="sm">
          {errors.length > 0
            ? t('homeEnergy.violations.errorsCount', '{{count}} error(s)', { count: errors.length })
            : warnings.length > 0
              ? t('homeEnergy.violations.warningsCount', '{{count}} warning(s)', { count: warnings.length })
              : t('homeEnergy.violations.none', 'No violations')}
        </Badge>
      </div>

      {violations.length === 0 ? (
        <div className="flex items-center gap-2 text-sm text-[var(--text-muted)]">
          <ShieldCheck className="h-4 w-4 text-emerald-500" />
          {t('homeEnergy.violations.clean', 'This plan satisfies every hard constraint modeled.')}
        </div>
      ) : (
        <ul className="space-y-2">
          {[...errors, ...warnings].map((v, i) => (
            <li
              key={`${v.code}-${v.vehicleId ?? ''}-${v.slotIndex ?? ''}-${i}`}
              className="flex items-start gap-2 rounded-lg border border-[var(--border-subtle)] p-2.5 text-sm"
            >
              {v.severity === 'error' ? (
                <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-red-500" />
              ) : (
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
              )}
              <span className="text-[var(--text-secondary)]">{describe(v)}</span>
            </li>
          ))}
        </ul>
      )}
    </GlassPanel>
  );
}
