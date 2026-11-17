import { Fan, Lock, ShieldCheck, Zap } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Sparkline } from '@/components/charts';
import { Button, Caption, GlassPanel, MetricValue, PanelTitle, Text } from '@/components/ui';
import AppDesignPackPreview from './AppDesignPackPreview';
import { usePackModule } from '@/features/dashboard/widgets/designPacks/PackBoundary';
import { batteryGaugePresentations, vehicleHeroPresentations } from '@/features/dashboard/widgets/designPacks/presentationLoaders';
import ClassicBatteryGauge from '@/features/dashboard/widgets/designPacks/families/ClassicBatteryGauge';
import ClassicVehicleHero from '@/features/dashboard/widgets/designPacks/families/ClassicVehicleHero';
import CommandActionsLayout from '@/features/dashboard/widgets/designPacks/families/CommandActionsLayout';
import LineTelemetryLayout from '@/features/dashboard/widgets/designPacks/families/LineTelemetryLayout';
import SecurityStatusLayout from '@/features/dashboard/widgets/designPacks/families/SecurityStatusLayout';
import { ChargeBatteryPack, ChargeMeter } from '@/features/dashboard/widgets/instruments/ChargeInstruments';
import VehicleStudio from '@/features/dashboard/widgets/vehicle-instruments/VehicleStudio';
import { PACK_APPEARANCES, type PackId } from '@/features/dashboard/widgets/designPacks/types';
import type { BatteryGaugePresentationProps } from '@/features/dashboard/widgets/designPacks/viewModels/BatteryGaugeViewModel';
import type { VehicleHeroPresentationProps } from '@/features/dashboard/widgets/designPacks/viewModels/VehicleHeroViewModel';

export interface WidgetDesignPackPreviewProps {
  packId: PackId;
}

const SAMPLE_HISTORY = [68, 70, 69, 72];

export default function WidgetDesignPackPreview({ packId }: WidgetDesignPackPreviewProps) {
  const { t } = useTranslation('settings');
  const BatteryPresentation = usePackModule(packId, packId === 'classic' ? null : batteryGaugePresentations[packId]);
  const VehiclePresentation = usePackModule(packId, packId === 'classic' ? null : vehicleHeroPresentations[packId]);
  const appearance = packId === 'classic' ? null : PACK_APPEARANCES[packId];
  const batteryLabel = t('theme.widgetDesignPacks.sampleBattery', 'Sample battery level');
  const headline = <MetricValue>72%</MetricValue>;
  const status = <Text>{t('theme.widgetDesignPacks.sampleParked', 'Parked')}</Text>;
  const meter = <ChargeMeter value={72} marker={80} label={batteryLabel} active={false} />;
  const battery: BatteryGaugePresentationProps = {
    status, headline, meter, level: 72,
    pack: <ChargeBatteryPack level={72} active={false} />,
    details: <Caption>{t('theme.widgetDesignPacks.sampleLimit', 'Sample charge limit: 80%')}</Caption>,
  };
  const vehicle: VehicleHeroPresentationProps = {
    sections: {
      identity: <Text>{t('theme.widgetDesignPacks.sampleVehicle', 'Sample vehicle')}</Text>,
      // Zero identity disables the existing per-vehicle paint preference.
      vehicle: <VehicleStudio vehicle={{ id: 0, model: 'Model Y', exterior_color: 'PearlWhite' }} bounded />,
      headline, charge: meter, readings: status,
    },
  };
  const chart = <Sparkline data={SAMPLE_HISTORY} width={480} height={120} ariaLabel={t('theme.widgetDesignPacks.sampleHistory', 'Sample battery history')} />;
  const actions = [
    { id: 'unlock', label: t('theme.widgetDesignPacks.sampleUnlock', 'Unlock'), Icon: Lock },
    { id: 'climate_on', label: t('theme.widgetDesignPacks.sampleClimate', 'Climate'), Icon: Fan },
    { id: 'flash', label: t('theme.widgetDesignPacks.sampleFlash', 'Flash lights'), Icon: Zap },
  ].map(({ id, label, Icon }) => ({
    id, busy: false,
    button: <Button key={id} disabled variant="secondary" icon={<Icon aria-hidden="true" />}>{label}</Button>,
  }));
  const locked = <Text>{t('theme.widgetDesignPacks.sampleLocked', 'Locked')}</Text>;
  return <AppDesignPackPreview packId={packId}>
    <div data-widget-pack-preview={packId} className="space-y-4 [[data-app-part~='overlay']:has(&)]:[overflow-anchor:none]">
    {packId !== 'classic' && (!BatteryPresentation || !VehiclePresentation) && (
      <Text role="status">{t('theme.widgetDesignPacks.loading', 'Loading preview...')}</Text>
    )}
    <div className="grid min-w-0 gap-4 md:grid-cols-2">
      <GlassPanel data-widget-pack={packId} className="@container min-w-0 space-y-3 p-4">
        <PanelTitle data-role="widget-header-title">{t('theme.widgetDesignPacks.vehicle', 'Vehicle')}</PanelTitle>
        {VehiclePresentation ? <VehiclePresentation {...vehicle} /> : <ClassicVehicleHero {...vehicle} />}
      </GlassPanel>
      <GlassPanel data-widget-pack={packId} className="@container min-w-0 space-y-3 p-4">
        <PanelTitle data-role="widget-header-title">{t('theme.widgetDesignPacks.battery', 'Battery')}</PanelTitle>
        {BatteryPresentation ? <BatteryPresentation {...battery} /> : <ClassicBatteryGauge {...battery} />}
      </GlassPanel>
      <GlassPanel data-widget-pack={packId} className="@container min-w-0 space-y-3 p-4">
        <PanelTitle data-role="widget-header-title">{t('theme.widgetDesignPacks.history', 'History')}</PanelTitle>
        {appearance ? <LineTelemetryLayout appearance={appearance} compact={false} context={null}
          headline={{ label: batteryLabel, value: '72', unit: '%' }} details={[]}
          chart={chart} sourceBoundary={content => content} /> : chart}
      </GlassPanel>
      <GlassPanel data-widget-pack={packId} className="@container min-w-0 space-y-3 p-4">
        <PanelTitle data-role="widget-header-title">{t('theme.widgetDesignPacks.status', 'Status')}</PanelTitle>
        {appearance ? <SecurityStatusLayout appearance={appearance} headline={locked}
          icon={<ShieldCheck aria-hidden="true" />} details={status} /> : <div>{locked}{status}</div>}
      </GlassPanel>
      <GlassPanel data-widget-pack={packId} className="@container min-w-0 space-y-3 p-4 md:col-span-2">
        <PanelTitle data-role="widget-header-title">{t('theme.widgetDesignPacks.commands', 'Commands')}</PanelTitle>
        <Caption>{t('theme.widgetDesignPacks.inertCommands', 'Preview commands are disabled.')}</Caption>
        {appearance ? <CommandActionsLayout appearance={appearance} compact={false} actions={actions} />
          : <div className="grid grid-cols-3 gap-3">{actions.map(action => action.button)}</div>}
      </GlassPanel>
    </div>
    </div>
  </AppDesignPackPreview>;
}
