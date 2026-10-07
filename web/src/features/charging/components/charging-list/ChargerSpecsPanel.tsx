import { useTranslation } from 'react-i18next';
import { Zap, Activity, Cable, Plug, Gauge } from 'lucide-react';
import { GlassPanel } from '@/components/ui';
import { EmptyState } from '@/components/feedback';
import { fmtInt, fmtWithUnit } from '@/lib/numberFormat';
import type { ChargerSpecsData } from './helpers';

interface ChargerSpecsPanelProps {
  specs: ChargerSpecsData | null;
}

export function ChargerSpecsPanel({ specs }: ChargerSpecsPanelProps) {
  const { t } = useTranslation();

  const hasData =
    !!specs &&
    ((specs.voltage?.length ?? 0) > 0 ||
      (specs.phase?.length ?? 0) > 0 ||
      (specs.cable?.length ?? 0) > 0 ||
      (specs.brand?.length ?? 0) > 0);

  return (
    <GlassPanel className="p-5">
      <h3 className="section-title flex items-center gap-2 mb-4">
        <Gauge className="h-4 w-4 text-neon-purple" aria-hidden="true" />
        {t('charging.specs.title', 'Charger Specs Breakdown')}
      </h3>
      {hasData ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
          <SpecColumn
            icon={<Zap className="h-3 w-3" aria-hidden="true" />}
            label={t('charging.specs.byVoltage', 'By Voltage')}
            items={specs!.voltage}
            emptyMsg={t('charging.specs.noVoltage', 'No voltage data')}
          />
          <SpecColumn
            icon={<Activity className="h-3 w-3" aria-hidden="true" />}
            label={t('charging.specs.byPhase', 'By Phase')}
            items={specs!.phase}
            emptyMsg={t('charging.specs.noPhase', 'No phase data')}
          />
          <SpecColumn
            icon={<Cable className="h-3 w-3" aria-hidden="true" />}
            label={t('charging.specs.byCable', 'By Cable')}
            items={specs!.cable}
            emptyMsg={t('charging.specs.noCable', 'No cable data')}
          />
          <SpecColumn
            icon={<Plug className="h-3 w-3" aria-hidden="true" />}
            label={t('charging.specs.byBrand', 'By Brand')}
            items={specs!.brand}
            emptyMsg={t('charging.specs.noBrand', 'No brand data')}
            showAvgPower
          />
        </div>
      ) : (
        <EmptyState /* no-action: transient empty state — surfaces when source data is missing; no specific recovery action available */ message={t('charging.specs.noData', 'No charger specification data available yet')} />
      )}
    </GlassPanel>
  );
}

interface SpecColumnProps {
  icon: React.ReactNode;
  label: string;
  items: Array<{ name: string; count: number; energy: number; avgPower?: number }>;
  emptyMsg: string;
  showAvgPower?: boolean;
}

function SpecColumn({ icon, label, items, emptyMsg, showAvgPower }: SpecColumnProps) {
  const { t } = useTranslation();
  const list = items ?? [];

  if (list.length === 0) {
    return (
      <div>
        <EmptyState /* no-action: transient empty state — surfaces when source data is missing; no specific recovery action available */ message={emptyMsg} />
      </div>
    );
  }

  return (
    <div>
      <p className="text-xs font-semibold text-[var(--text-secondary)] mb-2 flex items-center gap-1">
        {icon} {label}
      </p>
      <div className="space-y-2">
        {list.map((v) => {
          const sessions = t('charging.specs.sessionCount', '{{count}} sessions', { count: v.count ?? 0 });
          const detail =
            showAvgPower && v.avgPower != null
              ? t('charging.specs.kwAvg', '{{value}} kW avg', { value: fmtInt(v.avgPower) })
              : fmtWithUnit(v.energy ?? 0, 'kWh');
          return (
            <div key={v.name} className="flex justify-between items-center text-xs">
              <span className="text-[var(--text-primary)] font-medium">{v.name}</span>
              <span className="text-[var(--text-muted)]">{`${sessions} · ${detail}`}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
