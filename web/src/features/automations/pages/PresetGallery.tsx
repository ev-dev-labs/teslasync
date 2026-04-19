/**
 * PresetGallery — displays automation preset templates in a card grid.
 *
 * Each card shows preset name, description, trigger type, and an "Install" button
 * that navigates to the builder with the preset pre-filled.
 */
import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { GlassPanel } from '@/components/ui/GlassPanel';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { EmptyState } from '@/components/feedback/EmptyState';
import { Skeleton } from '@/components/feedback/Skeleton';
import { FadeIn } from '@/components/motion/FadeIn';
import { StaggerContainer } from '@/components/motion/StaggerContainer';
import { StaggerItem } from '@/components/motion/StaggerItem';
import { useAutomationPresets } from '@/api/hooks/useAutomations';
import {
  Shield, Moon, Sun, ShieldCheck, Lock, UserX, CarFront, Siren,
  Plus, Clock, type LucideIcon,
} from 'lucide-react';
import type { AutomationPreset } from '@/api/types';

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

const triggerLabels: Record<string, string> = {
  cron: 'Schedule',
  vehicle_state: 'Vehicle State',
  geofence: 'Geofence',
  battery: 'Battery',
  sunrise_sunset: 'Sunrise/Sunset',
  webhook: 'Webhook',
};

function PresetCard({ preset }: { preset: AutomationPreset }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const Icon = iconMap[preset.icon] ?? Shield;

  const handleInstall = () => {
    navigate(`/automations/new?preset=${preset.id}`);
  };

  return (
    <GlassPanel hover glow="cyan" className="p-5 flex flex-col gap-3">
      <div className="flex items-start gap-3">
        <div className="flex-shrink-0 w-10 h-10 rounded-lg bg-cyan-500/10 border border-cyan-500/20 flex items-center justify-center">
          <Icon className="h-5 w-5 text-cyan-400" />
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="text-sm font-semibold text-white/90 truncate">
            {preset.name}
          </h3>
          <p className="text-xs text-white/50 mt-0.5">
            {triggerLabels[preset.trigger_type] ?? preset.trigger_type}
          </p>
        </div>
        {preset.priority <= 5 && (
          <Badge variant="danger" size="sm">
            {t('automations.presets.critical', 'Critical')}
          </Badge>
        )}
      </div>

      <p className="text-xs text-white/60 leading-relaxed line-clamp-2">
        {preset.description}
      </p>

      <div className="flex flex-wrap gap-1.5 mt-auto">
        {preset.tags.map((tag) => (
          <Badge key={tag} variant="neutral" size="sm">
            {tag}
          </Badge>
        ))}
      </div>

      <Button
        size="sm"
        variant="secondary"
        onClick={handleInstall}
        className="mt-1 w-full"
      >
        <Plus className="h-3.5 w-3.5 mr-1.5" />
        {t('automations.presets.install', 'Install')}
      </Button>
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
  const { data, isLoading } = useAutomationPresets(category);

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

  if (presetList.length === 0) {
    return (
      <EmptyState
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
