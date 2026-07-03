import { type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { MapPin, Route, BatteryCharging, Car } from 'lucide-react';

import { GlassPanel, IconBox, Heading, Text } from '@/components/ui';
import { cn } from '@/lib/cn';
import { type NeonColor } from '@/lib/tokens';

interface FeatureItem {
  key: string;
  icon: ReactNode;
  color: NeonColor;
  title: string;
  desc: string;
}

/**
 * "What you'll unlock" preview grid.
 *
 * A full-width band of the core capabilities that light up once the
 * three setup anchors are satisfied. Reuses the existing onboarding
 * feature copy so the first-run promise stays consistent with the
 * marketing intro slides.
 */
export function OnboardingFeaturePreview({ className }: { className?: string }) {
  const { t } = useTranslation();

  const features: FeatureItem[] = [
    {
      key: 'tracking',
      icon: <MapPin className="h-5 w-5" />,
      color: 'cyan',
      title: t('onboarding.tracking', 'Real-time Tracking'),
      desc: t('onboarding.unlock.tracking', 'Follow location, speed, and state live on the map.'),
    },
    {
      key: 'drives',
      icon: <Route className="h-5 w-5" />,
      color: 'green',
      title: t('onboarding.drives', 'Drive History'),
      desc: t('onboarding.unlock.drives', 'Every trip logged with route, efficiency, and stats.'),
    },
    {
      key: 'charging',
      icon: <BatteryCharging className="h-5 w-5" />,
      color: 'amber',
      title: t('onboarding.charging', 'Charge Analytics'),
      desc: t('onboarding.unlock.charging', 'Track sessions, costs, and battery health over time.'),
    },
    {
      key: 'control',
      icon: <Car className="h-5 w-5" />,
      color: 'purple',
      title: t('onboarding.control', 'Vehicle Control'),
      desc: t('onboarding.unlock.control', 'Climate, charging, and locks — all from one place.'),
    },
  ];

  return (
    <div
      className={cn(
        'grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4',
        className,
      )}
    >
      {features.map((feature) => (
        <GlassPanel key={feature.key} hover glow="cyan" className="flex flex-col gap-3 p-4 sm:p-5">
          <IconBox color={feature.color} size="md">
            {feature.icon}
          </IconBox>
          <div className="space-y-1">
            <Heading level="panel">{feature.title}</Heading>
            <Text variant="bodySm" as="p">
              {feature.desc}
            </Text>
          </div>
        </GlassPanel>
      ))}
    </div>
  );
}
