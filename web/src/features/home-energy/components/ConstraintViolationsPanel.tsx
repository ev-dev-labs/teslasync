import { useTranslation } from 'react-i18next';
import { AlertTriangle, ShieldAlert, ShieldCheck } from 'lucide-react';
import { Badge, Icon, Text } from '@/components/ui';
import { LayoutCard } from '@/components/layout';
import { useUnits } from '@/hooks/useUnits';
import { severityTokens } from '@/lib/tokens';
import type { ValidationReason, Violation, ViolationCode } from '../lib/types';

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

const REASON_TEMPLATES: Record<ValidationReason['id'], { key: string; fallback: string }> = {
  slot_minutes_invalid: { key: 'homeEnergy.violation.reasons.slotMinutesInvalid', fallback: 'Slot duration must be positive; {{defaultMinutes}} minutes was used instead.' },
  horizon_slots_invalid: { key: 'homeEnergy.violation.reasons.horizonSlotsInvalid', fallback: 'The planning horizon must contain a positive number of slots.' },
  vehicle_id_missing: { key: 'homeEnergy.violation.reasons.vehicleIdMissing', fallback: 'A vehicle without a valid identifier was excluded.' },
  vehicle_capacity_invalid: { key: 'homeEnergy.violation.reasons.vehicleCapacityInvalid', fallback: 'A vehicle with invalid usable battery capacity was excluded.' },
  powerwall_capacity_invalid: { key: 'homeEnergy.violation.reasons.powerwallCapacityInvalid', fallback: 'The home battery was ignored because its capacity must be positive.' },
};

/** Structured constraint-violation / infeasibility report, grouped by severity. Never fabricates readiness. */
export function ConstraintViolationsPanel({ violations }: ConstraintViolationsPanelProps) {
  const { t } = useTranslation();
  const { formatEnergy } = useUnits();

  const errors = violations.filter((v) => v.severity === 'error');
  const warnings = violations.filter((v) => v.severity === 'warning');

  function describe(v: Violation): string {
    const reasonTemplate = v.reason ? REASON_TEMPLATES[v.reason.id] : undefined;
    const reasonArgs: Record<string, unknown> = v.reason && 'args' in v.reason ? v.reason.args : {};
    const detail = reasonTemplate
      ? t(reasonTemplate.key, reasonTemplate.fallback, reasonArgs)
      : t('homeEnergy.violation.reasons.unspecified', 'Review the plan inputs for invalid values.');
    return t(VIOLATION_TEMPLATES[v.code], FALLBACKS[v.code], {
      vehicleName: v.vehicleName ?? t('homeEnergy.violation.unknownVehicle', 'A vehicle'),
      unmet: v.unmetWh != null ? formatEnergy(v.unmetWh) : '',
      slot: v.slotIndex ?? '—',
      detail,
    });
  }

  return (
    <LayoutCard title={t('homeEnergy.violations.title', 'Constraint violations')} actions={
        <Badge variant={errors.length > 0 ? 'danger' : warnings.length > 0 ? 'warning' : 'success'} size="sm">
          {errors.length > 0
            ? t('homeEnergy.violations.errorsCount', '{{count}} error(s)', { count: errors.length })
            : warnings.length > 0
              ? t('homeEnergy.violations.warningsCount', '{{count}} warning(s)', { count: warnings.length })
              : t('homeEnergy.violations.none', 'No violations')}
        </Badge>
      }>

      {violations.length === 0 ? (
        <Text as="p" variant="bodySm" color="muted" className="flex items-center gap-2">
          <Icon icon={ShieldCheck} className={severityTokens.success.fg} />
          {t('homeEnergy.violations.clean', 'This plan satisfies every hard constraint modeled.')}
        </Text>
      ) : (
        <ul className="space-y-2">
          {[...errors, ...warnings].map((v, i) => (
            <li
              key={`${v.code}-${v.vehicleId ?? ''}-${v.slotIndex ?? ''}-${i}`}
              data-reason-id={v.reason?.id}
              data-reason-args={v.reason && 'args' in v.reason ? JSON.stringify(v.reason.args) : undefined}
              data-machine-detail={v.detail}
              className="flex min-w-0 items-start gap-2 rounded-lg border border-[var(--border-subtle)] p-2.5"
            >
              {v.severity === 'error' ? (
                <Icon icon={ShieldAlert} className={`mt-0.5 ${severityTokens.critical.fg}`} />
              ) : (
                <Icon icon={AlertTriangle} className={`mt-0.5 ${severityTokens.warn.fg}`} />
              )}
              <Text variant="bodySm" color="secondary" className="min-w-0 break-words">{describe(v)}</Text>
            </li>
          ))}
        </ul>
      )}
    </LayoutCard>
  );
}
