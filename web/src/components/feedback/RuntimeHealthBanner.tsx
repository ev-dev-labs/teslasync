import { Bell, Gauge } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

import { useRuntimeStatus } from '@/api/hooks/useAdmin';
import { useOnboardingStatus } from '@/api/hooks/useOnboarding';
import { Button, Text } from '@/components/ui/runtime';
import { useDateFormat } from '@/hooks/useDateFormat';
import { DataStateNotice } from './DataStateNotice';

const FAILURE_STATUSES = new Set([
  'degraded',
  'warning',
  'unhealthy',
  'offline',
  'down',
  'failed',
]);

const CRITICAL_STATUSES = new Set(['unhealthy', 'offline', 'down', 'failed']);

function componentLabel(
  component: string,
  t: ReturnType<typeof useTranslation>['t'],
): string {
  switch (component) {
    case "database": return t("runtimeHealth.components.database", "Database");
    case "mqtt": return t("runtimeHealth.components.mqtt", "MQTT");
    case "redis": return t("runtimeHealth.components.redis", "Redis");
    case "telemetry": return t("runtimeHealth.components.telemetry", "Fleet Telemetry");
    case "tesla_api": return t("runtimeHealth.components.tesla_api", "Tesla API");
    case "worker": return t("runtimeHealth.components.worker", "Background worker");
    default: return component.replace(/_/g, ' ');
  }
}

export function RuntimeHealthBanner() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { formatDateTime } = useDateFormat();
  const runtimeQuery = useRuntimeStatus();
  const onboardingQuery = useOnboardingStatus({ pollAfterSetup: true });

  const affected = (runtimeQuery.data?.components ?? [])
    .filter((component) => FAILURE_STATUSES.has(component.status))
    .sort((a, b) => a.name.localeCompare(b.name));

  if (onboardingQuery.data?.setup_required === true || affected.length === 0) {
    return null;
  }

  const critical =
    runtimeQuery.data?.status === 'down' ||
    affected.some((component) => CRITICAL_STATUSES.has(component.status));
  const telemetryAffected = affected.some((component) => component.name === 'telemetry');
  const componentNames = affected
    .map((component) => componentLabel(component.name, t))
    .join(', ');
  const lastTelemetryAt = onboardingQuery.data?.last_telemetry_at ?? null;

  return (
    <DataStateNotice
      state={critical ? 'unavailable' : 'partial'}
      title={t('runtimeHealth.title', 'TeslaSync is running in degraded mode')}
      role={critical ? 'alert' : 'status'}
      aria-live="polite"
      data-testid="runtime-health-banner"
      className="mx-3 mt-3 shrink-0 sm:mx-5 lg:mx-8"
    >
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="space-y-1">
          <Text as="p" variant="caption" className="!text-inherit">
            {t('runtimeHealth.affected', 'Affected components: {{components}}.', {
              components: componentNames,
            })}
          </Text>
          <Text as="p" variant="caption" className="!text-inherit">
            {telemetryAffected && lastTelemetryAt
              ? t(
                  'runtimeHealth.telemetryLastSeen',
                  'The last Fleet Telemetry signal arrived {{time}}. Stored history remains available while live values recover.',
                  { time: formatDateTime(lastTelemetryAt) },
                )
              : t(
                  'runtimeHealth.historyAvailable',
                  'The application and stored history remain available; live or dependent features may be stale.',
                )}
          </Text>
        </div>
        <div className="flex shrink-0 flex-col gap-2 sm:flex-row">
          <Button
            size="sm"
            variant="outline"
            wrapLabel
            className="min-h-11 min-w-11 md:min-h-9"
            icon={<Gauge className="h-4 w-4" />}
            onClick={() => navigate('/system-status')}
          >
            {t('runtimeHealth.systemStatus', 'System status')}
          </Button>
          <Button
            size="sm"
            variant="outline"
            wrapLabel
            className="min-h-11 min-w-11 md:min-h-9"
            icon={<Bell className="h-4 w-4" />}
            onClick={() => navigate('/notifications/channels')}
          >
            {t('runtimeHealth.configureAlerts', 'Health alerts')}
          </Button>
        </div>
      </div>
    </DataStateNotice>
  );
}
