import { useTranslation } from 'react-i18next';
import { CircleAlert, Eye, ShieldCheck } from 'lucide-react';
import { GlassPanel, Heading, Text } from '@/components/ui';

interface CommandSafetyPanelProps {
  vehicleStatus?: string | null;
}

export function CommandSafetyPanel({
  vehicleStatus,
}: CommandSafetyPanelProps) {
  const { t } = useTranslation();
  const asleepOrOffline =
    vehicleStatus === 'asleep' || vehicleStatus === 'offline';

  const guidance = [
    {
      icon: CircleAlert,
      title: t('commands.safety.requestTitle', 'A request is not physical proof'),
      body: t(
        'commands.safety.requestBody',
        'Confirm the resulting vehicle state after access, charging, or drive-sensitive actions.',
      ),
    },
    {
      icon: ShieldCheck,
      title: t('commands.safety.confirmTitle', 'Sensitive actions add friction'),
      body: t(
        'commands.safety.confirmBody',
        'High-impact commands require confirmation, a countdown, or typed acknowledgement.',
      ),
    },
    {
      icon: Eye,
      title: t('commands.safety.contextTitle', 'Check the surroundings'),
      body: asleepOrOffline
        ? t(
            'commands.safety.contextDisconnected',
            'Current vehicle context may be unavailable while it is asleep or offline.',
          )
        : t(
            'commands.safety.contextBody',
            'Verify the vehicle is parked and clear before opening panels or enabling drive access.',
          ),
    },
  ];

  return (
    <GlassPanel className="h-full p-4 sm:p-5" data-testid="command-safety">
      <Heading level="section">
        {t('commands.safety.title', 'Safety & execution')}
      </Heading>
      <Text as="p" variant="bodySm" className="mt-1">
        {t(
          'commands.safety.description',
          'Remote commands can affect a physical vehicle. Review context before acting.',
        )}
      </Text>

      <div className="mt-4 space-y-3">
        {guidance.map(({ icon: Icon, title, body }) => (
          <div
            key={title}
            className="flex gap-3 rounded-xl border border-[var(--border-subtle)] bg-white/[0.02] p-3"
          >
            <div className="mt-0.5 rounded-lg bg-amber-500/10 p-2 text-amber-300">
              <Icon className="h-4 w-4" aria-hidden="true" />
            </div>
            <div>
              <Text as="p" size="sm" weight="semibold" color="primary">
                {title}
              </Text>
              <Text as="p" size="xs" color="muted" className="mt-0.5">
                {body}
              </Text>
            </div>
          </div>
        ))}
      </div>
    </GlassPanel>
  );
}
