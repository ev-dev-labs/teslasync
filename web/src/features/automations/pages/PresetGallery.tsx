/**
 * PresetGallery — displays automation preset templates in a card grid.
 *
 * Each card shows preset name, description, trigger type, and an "Install" button
 * that navigates to the builder with the preset pre-filled.
 */
import { useMemo, useState, type ElementType } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { GlassPanel, Button as UiButton, Badge, Text } from '@/components/ui';
import { EmptyState } from '@/components/feedback/EmptyState';
import { Skeleton } from '@/components/feedback/Skeleton';
import { QueryError } from '@/components/feedback/QueryError';
import { FadeIn } from '@/components/motion/FadeIn';
import { StaggerContainer } from '@/components/motion/StaggerContainer';
import { StaggerItem } from '@/components/motion/StaggerItem';
import { PillFilterBar, type PillItem } from '@/components/forms';
import { useAutomationPresets } from '@/api/hooks/useAutomations';
import { RoutineWizard } from '../components/RoutineWizard';
import { Icons } from '@/lib/icons';
import type { AutomationPreset } from '@/api/types';
import type { AutomationTriggerKind } from '@/types/automations';

const iconMap: Record<string, ElementType> = {
  shield: Icons.security,
  'shield-off': Icons.securityOff,
  'shield-check': Icons.securityCheck,
  lock: Icons.locked,
  unlock: Icons.unlocked,
  'thermometer-sun': Icons.climateHot,
  'thermometer-snowflake': Icons.cooling,
  thermometer: Icons.climate,
  battery: Icons.battery,
  'battery-charging': Icons.batteryCharging,
  clock: Icons.clock,
  'alarm-clock': Icons.clock,
  'x-square': Icons.close,
  wheel: Icons.vehicle,
  user: Icons.user,
  lightbulb: Icons.lightbulb,
  zap: Icons.bolt,
  gauge: Icons.speed,
  home: Icons.home,
  sparkles: Icons.sparkles,
  wrench: Icons.maintenance,
  moon: Icons.moon,
  sun: Icons.sun,
  car: Icons.vehicle,
  volume: Icons.volume,
  Moon: Icons.moon,
  Shield: Icons.security,
};

const triggerLabels: Record<AutomationTriggerKind, { key: string; fallback: string }> = {
  trigger_schedule: { key: 'automations.builder.triggerSchedule', fallback: 'Schedule' },
  trigger_event: { key: 'automations.builder.triggerEvent', fallback: 'Vehicle Event' },
  trigger_geofence: { key: 'automations.builder.triggerGeofence', fallback: 'Geofence' },
  trigger_signal: { key: 'automations.builder.triggerSignal', fallback: 'Signal Threshold' },
};

function PresetCard({
  preset,
  actionsDisabled,
  actionsDisabledReason,
}: {
  preset: AutomationPreset;
  actionsDisabled?: boolean;
  actionsDisabledReason?: string;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const Icon = iconMap[preset.icon] ?? Icons.security;
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
        disabled={actionsDisabled}
        title={actionsDisabledReason}
        aria-label={t('automations.presets.installNamed', 'Install {{name}}', {
          name: preset.name,
        })}
        className="mt-1 w-full"
      >
        <Icons.add className="h-3.5 w-3.5 mr-1.5" aria-hidden="true" />
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
  actionsDisabled?: boolean;
  actionsDisabledReason?: string;
}

export function PresetGallery({
  category,
  actionsDisabled,
  actionsDisabledReason,
}: PresetGalleryProps) {
  const { t } = useTranslation();
  const { data, isLoading, isError, error, refetch } = useAutomationPresets(category);
  const [activeCategory, setActiveCategory] = useState(category ?? 'all');

  const presetList = useMemo(() => data?.presets ?? [], [data]);
  const categories = useMemo(() => data?.categories ?? [], [data]);
  const filteredPresets = useMemo(() => {
    if (category) {
      return presetList;
    }
    if (activeCategory === 'all') {
      return presetList;
    }
    return presetList.filter((p) => p.category === activeCategory);
  }, [presetList, activeCategory, category]);

  const pills: PillItem[] = useMemo(() => {
    const items: PillItem[] = [
      {
        key: 'all',
        label: t('automations.presets.allCategory', 'All'),
        count: presetList.length,
      },
    ];
    for (const cat of [...categories].sort((a, b) => a.name.localeCompare(b.name))) {
      items.push({
        key: cat.id,
        label: cat.name,
        count: presetList.filter((p) => p.category === cat.id).length,
      });
    }
    return items;
  }, [categories, presetList, t]);

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
        icon={<Icons.clock className="h-8 w-8" />}
        message={t('automations.presets.empty', 'No preset templates available')}
      />
    );
  }

  return (
    <div className="space-y-6">
      <RoutineWizard actionsDisabled={actionsDisabled} />
      {!category && pills.length > 1 && (
        <PillFilterBar
          items={pills}
          activeKey={activeCategory}
          onChange={setActiveCategory}
          ariaLabel={t('automations.presets.filterAria', 'Filter presets by category')}
        />
      )}
      {filteredPresets.length === 0 ? (
        <EmptyState
          icon={<Icons.clock className="h-8 w-8" />}
          message={t('automations.presets.emptyCategory', 'No presets in this category')}
        />
      ) : (
        <FadeIn>
          <StaggerContainer className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {filteredPresets.map((preset) => (
              <StaggerItem key={preset.id}>
                <PresetCard
                  preset={preset}
                  actionsDisabled={actionsDisabled}
                  actionsDisabledReason={actionsDisabledReason}
                />
              </StaggerItem>
            ))}
          </StaggerContainer>
        </FadeIn>
      )}
    </div>
  );
}
