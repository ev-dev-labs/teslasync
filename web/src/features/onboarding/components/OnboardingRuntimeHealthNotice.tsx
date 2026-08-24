import { AlertTriangle, Bell, Gauge, Plug } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

import { AlertBanner } from '@/components/feedback';
import { Button, Text } from '@/components/ui';
import { useDateFormat } from '@/hooks/useDateFormat';
import type { TelemetryHealth } from '@/api/hooks/useOnboarding';

interface OnboardingRuntimeHealthNoticeProps {
  setupComplete: boolean;
  teslaConnected: boolean;
  telemetryHealth: TelemetryHealth;
  lastTelemetryAt: string | null;
}

function StaleTelemetryMessage({ lastTelemetryAt }: { lastTelemetryAt: string | null }) {
  const { t } = useTranslation();
  const { formatDateTime } = useDateFormat();

  return (
    <Text as="p" variant="caption" className="!text-inherit">
      {lastTelemetryAt
        ? t(
            'onboarding.runtimeHealth.telemetryLastSeen',
            'Fleet Telemetry is stale. The last signal arrived {{time}}.',
            { time: formatDateTime(lastTelemetryAt) },
          )
        : t(
            'onboarding.runtimeHealth.telemetryStale',
            'Fleet Telemetry is stale and live values may be out of date.',
          )}
    </Text>
  );
}

export function OnboardingRuntimeHealthNotice({
  setupComplete,
  teslaConnected,
  telemetryHealth,
  lastTelemetryAt,
}: OnboardingRuntimeHealthNoticeProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const telemetryStale = telemetryHealth === 'stale';

  if (!setupComplete || (teslaConnected && !telemetryStale)) return null;

  return (
    <AlertBanner
      variant="warning"
      icon={<AlertTriangle className="h-5 w-5" />}
      title={t(
        'onboarding.runtimeHealth.title',
        'Setup is complete, but a live service needs attention',
      )}
      role="status"
      aria-live="polite"
      data-testid="onboarding-runtime-health"
    >
      <div className="space-y-3">
        <Text as="p" variant="caption" className="!text-inherit">
          {t(
            'onboarding.runtimeHealth.access',
            'You can keep using TeslaSync and viewing stored history while live services recover.',
          )}
        </Text>
        {telemetryStale && (
          <StaleTelemetryMessage lastTelemetryAt={lastTelemetryAt} />
        )}
        {!teslaConnected && (
          <Text as="p" variant="caption" className="!text-inherit">
            {t(
              'onboarding.runtimeHealth.teslaAuth',
              'Your Tesla account authorization is unavailable and may need to be renewed.',
            )}
          </Text>
        )}
        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
          {!teslaConnected && (
            <Button
              size="sm"
              variant="outline"
              icon={<Plug className="h-4 w-4" />}
              onClick={() => navigate('/tesla-account')}
            >
              {t('onboarding.runtimeHealth.reconnect', 'Reconnect Tesla account')}
            </Button>
          )}
          {telemetryStale && (
            <Button
              size="sm"
              variant="outline"
              icon={<Gauge className="h-4 w-4" />}
              onClick={() => navigate('/system-status')}
            >
              {t('onboarding.runtimeHealth.systemStatus', 'View system status')}
            </Button>
          )}
          <Button
            size="sm"
            variant="outline"
            icon={<Bell className="h-4 w-4" />}
            onClick={() => navigate('/notifications/channels')}
          >
            {t('onboarding.runtimeHealth.alerts', 'Configure health alerts')}
          </Button>
        </div>
      </div>
    </AlertBanner>
  );
}
