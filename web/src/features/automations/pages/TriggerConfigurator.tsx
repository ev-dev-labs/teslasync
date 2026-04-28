/**
 * TriggerConfigurator — dynamic form that renders different fields per trigger type.
 *
 * Each trigger type has its own sub-form matching the backend trigger_config schema:
 *   cron, vehicle_state, geofence, battery, sunrise_sunset, energy, mqtt, webhook, calendar
 */
import { useMemo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Input as UiInput, Select as UiSelect, Toggle, Button as UiButton } from '@/components/ui';
import { useGeofences } from '@/api/hooks/useLocations';
import { DAYS, COMMON_TIMEZONES } from '@/lib/constants';
import {
  Clock, Zap, MapPin, Battery, Sunrise, Sun, Radio, Globe, Calendar,
  Copy,
} from 'lucide-react';

// ─── Types ────────────────────────────────────────────────────────────────────

export const TRIGGER_TYPES = [
  { value: 'cron', label: 'Schedule', icon: Clock },
  { value: 'vehicle_state', label: 'Vehicle Event', icon: Zap },
  { value: 'geofence', label: 'Geofence', icon: MapPin },
  { value: 'battery', label: 'Battery Level', icon: Battery },
  { value: 'sunrise_sunset', label: 'Sunrise / Sunset', icon: Sunrise },
  { value: 'energy', label: 'Energy Site', icon: Sun },
  { value: 'mqtt', label: 'MQTT Message', icon: Radio },
  { value: 'webhook', label: 'Webhook', icon: Globe },
  { value: 'calendar', label: 'Calendar Event', icon: Calendar },
] as const;

const VEHICLE_STATE_EVENTS = [
  { value: 'wakes_up', label: 'Wakes Up' },
  { value: 'goes_to_sleep', label: 'Goes to Sleep' },
  { value: 'comes_online', label: 'Comes Online' },
  { value: 'goes_offline', label: 'Goes Offline' },
  { value: 'drive_starts', label: 'Drive Starts' },
  { value: 'drive_ends', label: 'Drive Ends' },
  { value: 'charging_starts', label: 'Charging Starts' },
  { value: 'charging_stops', label: 'Charging Stops' },
  { value: 'charging_complete', label: 'Charging Complete' },
  { value: 'state_change', label: 'Any State Change' },
];

const BATTERY_OPERATORS = [
  { value: 'above', label: 'Goes Above' },
  { value: 'below', label: 'Goes Below' },
  { value: 'reaches', label: 'Reaches Exactly' },
  { value: 'changes_by', label: 'Changes By' },
];

const GEOFENCE_EVENTS = [
  { value: 'enter', label: 'Enter' },
  { value: 'leave', label: 'Leave' },
  { value: 'both', label: 'Enter or Leave' },
];

// ─── Props ────────────────────────────────────────────────────────────────────

interface TriggerConfiguratorProps {
  triggerType: string;
  config: Record<string, unknown>;
  onChange: (config: Record<string, unknown>) => void;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function str(v: unknown): string {
  return typeof v === 'string' ? v : '';
}
function num(v: unknown, fallback = 0): number {
  return typeof v === 'number' ? v : fallback;
}
function bool(v: unknown): boolean {
  return v === true;
}
function numArr(v: unknown): number[] {
  return Array.isArray(v) ? v.filter((x): x is number => typeof x === 'number') : [];
}

/** Build a cron expression from hour, minute, and selected days of week. */
function buildCronExpr(hour: number, minute: number, days: number[]): string {
  const dow = days.length === 0 || days.length === 7 ? '*' : days.join(',');
  return `${minute} ${hour} * * ${dow}`;
}

/** Parse a simple cron expression to extract hour, minute, days. Returns null for complex expressions. */
function parseCronExpr(expr: string): { hour: number; minute: number; days: number[] } | null {
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) return null;
  const [min, hr, dom, month, dow] = parts;
  if (dom !== '*' || month !== '*') return null;
  const minute = parseInt(min, 10);
  const hour = parseInt(hr, 10);
  if (isNaN(minute) || isNaN(hour)) return null;
  const days = dow === '*' ? [] : dow.split(',').map(Number).filter((n) => !isNaN(n));
  return { hour, minute, days };
}

// ─── Component ────────────────────────────────────────────────────────────────

export function TriggerConfigurator({ triggerType, config, onChange }: TriggerConfiguratorProps) {
  const { t } = useTranslation();
  const { data: geofences } = useGeofences();

  const set = useCallback(
    (key: string, value: unknown) => onChange({ ...config, [key]: value }),
    [config, onChange],
  );

  const geofenceOptions = useMemo(
    () => (geofences ?? []).map((g) => ({ value: String(g.id), label: g.name })),
    [geofences],
  );

  switch (triggerType) {
    // ── Cron / Schedule ───────────────────────────────────────────────
    case 'cron': {
      const cronExpr = str(config.cron_expr);
      const parsed = parseCronExpr(cronExpr);
      const isSimple = parsed !== null || cronExpr === '';
      const hour = parsed?.hour ?? 8;
      const minute = parsed?.minute ?? 0;
      const selectedDays = parsed?.days ?? [];

      const handleTimeChange = (h: number, m: number, d: number[]) => {
        onChange({ ...config, cron_expr: buildCronExpr(h, m, d) });
      };

      return (
        <div className="space-y-4">
          {isSimple ? (
            <>
              <div className="flex gap-3 items-end">
                <UiInput
                  label={t('automations.builder.time', 'Time')}
                  type="time"
                  value={`${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`}
                  onChange={(e) => {
                    const [h, m] = e.target.value.split(':').map(Number);
                    handleTimeChange(h ?? hour, m ?? minute, selectedDays);
                  }}
                  className="w-36"
                />
              </div>
              <div>
                <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
                  {t('automations.builder.days', 'Days')}
                </label>
                <div className="flex gap-2 mt-1">
                  {DAYS.map((label, i) => {
                    const active = selectedDays.length === 0 || selectedDays.includes(i);
                    return (
                      <UiButton
                        key={i}
                        type="button"
                        variant="ghost"
                        size="sm"
                        aria-pressed={active}
                        className={`!h-10 !w-10 !rounded-lg !p-0 text-xs font-medium ${
                          active
                            ? '!bg-[var(--accent)]/20 text-[var(--accent)] ring-1 ring-[var(--accent)]/50'
                            : '!bg-white/[0.03] text-white/40 hover:!bg-white/[0.06]'
                        }`}
                        onClick={() => {
                          let next: number[];
                          if (selectedDays.length === 0) {
                            next = DAYS.map((_, idx) => idx).filter((idx) => idx !== i);
                          } else if (selectedDays.includes(i)) {
                            next = selectedDays.filter((d) => d !== i);
                          } else {
                            next = [...selectedDays, i].sort();
                          }
                          if (next.length === 7) next = [];
                          handleTimeChange(hour, minute, next);
                        }}
                      >
                        {label}
                      </UiButton>
                    );
                  })}
                </div>
              </div>
              <UiButton
                type="button"
                variant="ghost"
                className="!h-auto !px-0 !py-0 text-xs text-white/40 underline hover:!bg-transparent hover:text-white/60"
                onClick={() => {
                  if (cronExpr === '') onChange({ ...config, cron_expr: '0 8 * * *' });
                }}
              >
                {t('automations.builder.advancedCron', 'Switch to advanced cron expression')}
              </UiButton>
            </>
          ) : (
            <>
              <UiInput
                label={t('automations.builder.cronExpr', 'Cron Expression')}
                value={cronExpr}
                onChange={(e) => set('cron_expr', e.target.value)}
                placeholder="0 8 * * 1-5"
                hint="minute hour day-of-month month day-of-week"
              />
              <UiButton
                type="button"
                variant="ghost"
                className="!h-auto !px-0 !py-0 text-xs text-white/40 underline hover:!bg-transparent hover:text-white/60"
                onClick={() => {
                  const p = parseCronExpr(cronExpr);
                  if (p) onChange({ ...config, cron_expr: cronExpr });
                  else onChange({ ...config, cron_expr: '0 8 * * *' });
                }}
              >
                {t('automations.builder.simpleCron', 'Switch to simple mode')}
              </UiButton>
            </>
          )}
          <UiSelect
            label={t('automations.builder.timezone', 'Timezone')}
            options={COMMON_TIMEZONES}
            value={str(config.timezone)}
            onChange={(e) => set('timezone', e.target.value)}
          />
        </div>
      );
    }

    // ── Vehicle State ─────────────────────────────────────────────────
    case 'vehicle_state':
      return (
        <div className="space-y-4">
          <UiSelect
            label={t('automations.builder.event', 'Event')}
            options={[{ value: '', label: t('automations.builder.selectEvent', 'Select event...') }, ...VEHICLE_STATE_EVENTS]}
            value={str(config.event)}
            onChange={(e) => set('event', e.target.value)}
          />
        </div>
      );

    // ── Geofence ──────────────────────────────────────────────────────
    case 'geofence':
      return (
        <div className="space-y-4">
          <UiSelect
            label={t('automations.builder.geofence', 'Geofence')}
            options={[{ value: '', label: t('automations.builder.selectGeofence', 'Select geofence...') }, ...geofenceOptions]}
            value={String(config.geofence_id ?? '')}
            onChange={(e) => set('geofence_id', e.target.value ? Number(e.target.value) : 0)}
          />
          <UiSelect
            label={t('automations.builder.geofenceEvent', 'Event')}
            options={GEOFENCE_EVENTS}
            value={str(config.event) || 'enter'}
            onChange={(e) => set('event', e.target.value)}
          />
          <UiInput
            label={t('automations.builder.dwellMinutes', 'Dwell Minutes')}
            type="number"
            min={0}
            max={60}
            value={num(config.dwell_minutes)}
            onChange={(e) => set('dwell_minutes', parseInt(e.target.value, 10) || 0)}
            hint={t('automations.builder.dwellHint', '0 = fire immediately on transition')}
          />
        </div>
      );

    // ── Battery ───────────────────────────────────────────────────────
    case 'battery':
      return (
        <div className="space-y-4">
          <UiSelect
            label={t('automations.builder.operator', 'Operator')}
            options={BATTERY_OPERATORS}
            value={str(config.operator) || 'below'}
            onChange={(e) => set('operator', e.target.value)}
          />
          <div>
            <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
              {t('automations.builder.threshold', 'Threshold')}: {num(config.threshold, 50)}%
            </label>
            <UiInput
              type="range"
              min={0}
              max={100}
              step={1}
              value={num(config.threshold, 50)}
              onChange={(e) => set('threshold', parseInt(e.target.value, 10))}
              className="!mt-1 !w-full !border-0 !bg-transparent !px-0 !py-0 accent-[var(--accent)]"
            />
          </div>
          {str(config.operator) === 'changes_by' && (
            <>
              <UiInput
                label={t('automations.builder.delta', 'Delta (%)')}
                type="number"
                min={1}
                max={100}
                value={num(config.delta, 10)}
                onChange={(e) => set('delta', parseInt(e.target.value, 10) || 1)}
              />
              <UiSelect
                label={t('automations.builder.direction', 'Direction')}
                options={[
                  { value: 'any', label: 'Any' },
                  { value: 'up', label: 'Up Only' },
                  { value: 'down', label: 'Down Only' },
                ]}
                value={str(config.direction) || 'any'}
                onChange={(e) => set('direction', e.target.value)}
              />
            </>
          )}
        </div>
      );

    // ── Sunrise / Sunset ──────────────────────────────────────────────
    case 'sunrise_sunset':
      return (
        <div className="space-y-4">
          <UiSelect
            label={t('automations.builder.solarEvent', 'Solar Event')}
            options={[
              { value: 'sunrise', label: 'Sunrise' },
              { value: 'sunset', label: 'Sunset' },
            ]}
            value={str(config.event) || 'sunrise'}
            onChange={(e) => set('event', e.target.value)}
          />
          <UiInput
            label={t('automations.builder.offsetMinutes', 'Offset (minutes)')}
            type="number"
            min={-120}
            max={120}
            value={num(config.offset_minutes)}
            onChange={(e) => set('offset_minutes', parseInt(e.target.value, 10) || 0)}
            hint={t('automations.builder.offsetHint', 'Negative = before, positive = after')}
          />
          <div>
            <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
              {t('automations.builder.days', 'Days')}
            </label>
            <div className="flex gap-2 mt-1">
              {DAYS.map((label, i) => {
                const days = numArr(config.days_of_week);
                const active = days.length === 0 || days.includes(i);
                return (
                  <UiButton
                    key={i}
                    type="button"
                    variant="ghost"
                    size="sm"
                    aria-pressed={active}
                    className={`!h-10 !w-10 !rounded-lg !p-0 text-xs font-medium ${
                      active
                        ? '!bg-[var(--accent)]/20 text-[var(--accent)] ring-1 ring-[var(--accent)]/50'
                        : '!bg-white/[0.03] text-white/40 hover:!bg-white/[0.06]'
                    }`}
                    onClick={() => {
                      let next: number[];
                      if (days.length === 0) {
                        next = DAYS.map((_, idx) => idx).filter((idx) => idx !== i);
                      } else if (days.includes(i)) {
                        next = days.filter((d) => d !== i);
                      } else {
                        next = [...days, i].sort();
                      }
                      if (next.length === 7) next = [];
                      set('days_of_week', next);
                    }}
                  >
                    {label}
                  </UiButton>
                );
              })}
            </div>
          </div>
          <UiSelect
            label={t('automations.builder.timezone', 'Timezone')}
            options={COMMON_TIMEZONES}
            value={str(config.timezone)}
            onChange={(e) => set('timezone', e.target.value)}
          />
        </div>
      );

    // ── Energy ────────────────────────────────────────────────────────
    case 'energy':
      return (
        <div className="space-y-4">
          <UiInput
            label={t('automations.builder.energySiteId', 'Energy Site ID')}
            type="number"
            value={num(config.energy_site_id)}
            onChange={(e) => set('energy_site_id', parseInt(e.target.value, 10) || 0)}
          />
          <UiInput
            label={t('automations.builder.energyEvent', 'Event')}
            value={str(config.event)}
            onChange={(e) => set('event', e.target.value)}
            placeholder="solar_above, battery_below, etc."
          />
          <UiInput
            label={t('automations.builder.threshold', 'Threshold')}
            type="number"
            value={num(config.threshold)}
            onChange={(e) => set('threshold', parseFloat(e.target.value) || 0)}
            hint={t('automations.builder.energyThresholdHint', 'Watts (power events) or percent (battery events)')}
          />
        </div>
      );

    // ── MQTT ──────────────────────────────────────────────────────────
    case 'mqtt':
      return (
        <div className="space-y-4">
          <UiInput
            label={t('automations.builder.mqttTopic', 'MQTT Topic')}
            value={str(config.topic)}
            onChange={(e) => set('topic', e.target.value)}
            placeholder="teslasync/+/battery_level"
          />
          <UiInput
            label={t('automations.builder.payloadMatch', 'Payload Match (optional)')}
            value={str(config.payload_match)}
            onChange={(e) => set('payload_match', e.target.value || undefined)}
            hint={t('automations.builder.payloadMatchHint', 'Simple string equality match')}
          />
          <Toggle
            label={t('automations.builder.allowRetained', 'Allow Retained Messages')}
            checked={bool(config.allow_retained)}
            onChange={(v) => set('allow_retained', v)}
          />
        </div>
      );

    // ── Webhook ───────────────────────────────────────────────────────
    case 'webhook': {
      const token = str(config.webhook_token) || '';
      const webhookUrl = token
        ? `${window.location.origin}/api/v1/automations/webhook/${token}`
        : '';

      return (
        <div className="space-y-4">
          <div>
            <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
              {t('automations.builder.webhookUrl', 'Webhook URL')}
            </label>
            {token ? (
              <div className="mt-1 flex gap-2">
                <UiInput
                  value={webhookUrl}
                  readOnly
                  className="flex-1 font-mono text-xs"
                />
                <UiButton
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => navigator.clipboard.writeText(webhookUrl)}
                  aria-label={t('automations.builder.copyUrl', 'Copy URL')}
                >
                  <Copy className="h-4 w-4" />
                </UiButton>
              </div>
            ) : (
              <div className="mt-1">
                <UiButton
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={() => set('webhook_token', crypto.randomUUID())}
                >
                  {t('automations.builder.generateToken', 'Generate Webhook Token')}
                </UiButton>
              </div>
            )}
          </div>
          <UiInput
            label={t('automations.builder.webhookSecret', 'HMAC Secret (optional)')}
            value={str(config.secret)}
            onChange={(e) => set('secret', e.target.value || undefined)}
            hint={t('automations.builder.webhookSecretHint', 'If set, payloads are verified with HMAC-SHA256')}
          />
        </div>
      );
    }

    // ── Calendar ──────────────────────────────────────────────────────
    case 'calendar':
      return (
        <div className="space-y-4">
          <UiInput
            label={t('automations.builder.calendarOffset', 'Offset (minutes)')}
            type="number"
            min={-120}
            max={120}
            value={num(config.offset_minutes)}
            onChange={(e) => set('offset_minutes', parseInt(e.target.value, 10) || 0)}
            hint={t('automations.builder.calendarOffsetHint', 'Negative = before event start, positive = after')}
          />
          <UiInput
            label={t('automations.builder.eventFilter', 'Event Title Filter (regex, optional)')}
            value={str(config.event_filter)}
            onChange={(e) => set('event_filter', e.target.value || undefined)}
            placeholder="^(Meeting|Standup).*"
          />
          <Toggle
            label={t('automations.builder.locationRequired', 'Only events with a location')}
            checked={bool(config.location_required)}
            onChange={(v) => set('location_required', v)}
          />
          <Toggle
            label={t('automations.builder.includeNavigation', 'Include navigation to event')}
            checked={bool(config.include_navigation)}
            onChange={(v) => set('include_navigation', v)}
          />
        </div>
      );

    default:
      return (
        <p className="text-sm text-white/40">
          {t('automations.builder.selectTrigger', 'Select a trigger type to configure.')}
        </p>
      );
  }
}
