/**
 * PresetGallery — displays automation preset templates in a card grid.
 *
 * Each card shows preset name, description, trigger type, and an "Install" button
 * that navigates to the builder with the preset pre-filled.
 */
import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { GlassPanel, Button as UiButton, Badge, Text } from '@/components/ui';
import { EmptyState } from '@/components/feedback/EmptyState';
import { Skeleton } from '@/components/feedback/Skeleton';
import { QueryError } from '@/components/feedback/QueryError';
import { FadeIn } from '@/components/motion/FadeIn';
import { StaggerContainer } from '@/components/motion/StaggerContainer';
import { StaggerItem } from '@/components/motion/StaggerItem';
import { useAutomationPresets } from '@/api/hooks/useAutomations';
import {
  Shield, Moon, Sun, ShieldCheck, Lock, UserX, CarFront, Siren,
  Plus, Clock, type LucideIcon,
} from 'lucide-react';
import type { AutomationPreset } from '@/api/types';
import type { AutomationTriggerKind } from '@/types/automations';

const iconMap: Record<string, LucideIcon> = {
  Shield,
  Moon,
  Sun,
  ShieldCheck,
  Lock,
  UserX,
  CarFront,
  Siren,
};

const triggerLabels: Record<AutomationTriggerKind, { key: string; fallback: string }> = {
  trigger_schedule: { key: 'automations.builder.triggerSchedule', fallback: 'Schedule' },
  trigger_event: { key: 'automations.builder.triggerEvent', fallback: 'Vehicle Event' },
  trigger_geofence: { key: 'automations.builder.triggerGeofence', fallback: 'Geofence' },
  trigger_signal: { key: 'automations.builder.triggerSignal', fallback: 'Signal Threshold' },
};

function PresetCard({ preset }: { preset: AutomationPreset }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const Icon = iconMap[preset.icon] ?? Shield;
  const firstTrigger = preset.triggers?.[0];
  const triggerLabel = firstTrigger ? triggerLabels[firstTrigger.kind] : null;
  const actionCount = preset.actions?.length ?? 0;

  const handleInstall = () => {
    navigate(`/automations/new?preset=${preset.id}`);
  };

  return (
    <GlassPanel hover glow="cyan" className="p-5 flex flex-col gap-3">
      <div className="flex items-start gap-3">
        <div className="flex-shrink-0 w-10 h-10 rounded-lg bg-cyan-500/10 border border-cyan-500/20 flex items-center justify-center">
          <Icon className="h-5 w-5 text-cyan-400" aria-hidden="true" />
        </div>
        <div className="flex-1 min-w-0">
          <Text as="h3" size="sm" weight="semibold" color="primary" className="truncate">
            {preset.name}
          </Text>
          <Text as="p" variant="bodySm" className="mt-0.5">
            {triggerLabel
              ? t(triggerLabel.key, triggerLabel.fallback)
              : t('automations.builder.noTrigger', 'No trigger configured')}
          </Text>
        </div>
        <Badge variant="neutral" size="sm">
          {t('automations.presets.actionCount', '{{count}} actions', {
            count: actionCount,
          })}
        </Badge>
      </div>

      <Text as="p" variant="bodySm" className="leading-relaxed line-clamp-2">
        {preset.description}
      </Text>

      <UiButton
        size="sm"
        variant="secondary"
        onClick={handleInstall}
        aria-label={t('automations.presets.installNamed', 'Install {{name}}', {
          name: preset.name,
        })}
        className="mt-1 w-full"
      >
        <Plus className="h-3.5 w-3.5 mr-1.5" aria-hidden="true" />
        {t('automations.presets.install', 'Install')}
      </UiButton>
    </GlassPanel>
  );
}

function PresetCardSkeleton() {
  return (
    <GlassPanel className="p-5 flex flex-col gap-3">
      <div className="flex items-start gap-3">
        <Skeleton className="w-10 h-10 rounded-lg" />
        <div className="flex-1">
          <Skeleton className="h-4 w-32 mb-1" />
          <Skeleton className="h-3 w-20" />
        </div>
      </div>
      <Skeleton className="h-8 w-full" />
      <Skeleton className="h-7 w-full mt-auto" />
    </GlassPanel>
  );
}

interface PresetGalleryProps {
  category?: string;
}

export function PresetGallery({ category }: PresetGalleryProps) {
  const { t } = useTranslation();
  const { data, isLoading, isError, error, refetch } = useAutomationPresets(category);

  const presetList = useMemo(() => data?.presets ?? [], [data]);

  if (isLoading) {
    return (
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <PresetCardSkeleton key={i} />
        ))}
      </div>
    );
  }

  if (isError && presetList.length === 0) {
    return (
      <QueryError
        error={error}
        onRetry={() => refetch()}
        resourceName={t('automations.presets.resource', 'Automation presets')}
      />
    );
  }

  if (presetList.length === 0) {
    return (
      <EmptyState /* no-action: transient empty state — surfaces when source data is missing; no specific recovery action available */
        icon={<Clock className="h-8 w-8" />}
        message={t('automations.presets.empty', 'No preset templates available')}
      />
    );
  }

  return (
    <FadeIn>
      <StaggerContainer className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
        {presetList.map((preset) => (
          <StaggerItem key={preset.id}>
            <PresetCard preset={preset} />
          </StaggerItem>
        ))}
      </StaggerContainer>
    </FadeIn>
  );
}
