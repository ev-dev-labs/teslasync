import { useTranslation } from 'react-i18next';
import { Badge, type BadgeProps } from '@/components/ui';

type FSMVariant = NonNullable<BadgeProps['variant']>;

interface FSMTypeMeta {
  variant: FSMVariant;
  /** i18n key for the short badge label. */
  labelKey: string;
  /** English fallback used when the key is absent from the active locale. */
  label: string;
}

/**
 * Visual + label metadata for each canonical FSM machine type. Keys mirror the
 * `fsm_name` values emitted by the backend FSM engine and the registry in
 * `@/types/fsm` (all eight machines) — keep this in sync when a new machine is
 * registered so its transitions never render as a raw snake_case string.
 */
const FSM_TYPE_META: Record<string, FSMTypeMeta> = {
  vehicle: { variant: 'info', labelKey: 'fsm.typeLabel.vehicle', label: 'Vehicle' },
  drive_session: { variant: 'success', labelKey: 'fsm.typeLabel.driveSession', label: 'Drive' },
  charge_session: { variant: 'warning', labelKey: 'fsm.typeLabel.chargeSession', label: 'Charge' },
  command: { variant: 'danger', labelKey: 'fsm.typeLabel.command', label: 'Command' },
  notification: { variant: 'neutral', labelKey: 'fsm.typeLabel.notification', label: 'Notify' },
  alert_cooldown: { variant: 'neutral', labelKey: 'fsm.typeLabel.alertCooldown', label: 'Cooldown' },
  automation: { variant: 'info', labelKey: 'fsm.typeLabel.automation', label: 'Automation' },
  telemetry_connection: {
    variant: 'info',
    labelKey: 'fsm.typeLabel.telemetryConnection',
    label: 'Telemetry',
  },
};

/** Rendered when the type is missing or blank so the chip is never empty. */
const EMPTY_TYPE_LABEL = '—';

export interface FSMBadgeProps {
  /**
   * FSM machine type key (e.g. "drive_session"). Matching is case-insensitive
   * and surrounding whitespace is ignored. Unknown, empty, or nullish values
   * render a neutral placeholder rather than an empty chip.
   */
  type: string | null | undefined;
  /** Optional extra classes forwarded to the underlying Badge. */
  className?: string;
}

export function FSMBadge({ type, className }: FSMBadgeProps) {
  const { t } = useTranslation();

  const normalized = type?.trim().toLowerCase() ?? '';
  const meta = FSM_TYPE_META[normalized];

  const variant: FSMVariant = meta?.variant ?? 'neutral';
  const label = meta
    ? t(meta.labelKey, meta.label)
    : type?.trim() || t('fsm.typeLabel.unknown', EMPTY_TYPE_LABEL);

  return (
    <Badge variant={variant} className={className}>
      {label}
    </Badge>
  );
}
