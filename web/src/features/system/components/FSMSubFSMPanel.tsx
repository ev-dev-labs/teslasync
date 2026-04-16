import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Car, Zap } from 'lucide-react';
import { GlassPanel } from '@/components/ui';
import { EmptyState } from '@/components/feedback';
import { Grid } from '@/components/layout';
import { formatRelative } from '@/lib/dateFormat';
import { StateBadge } from './StateBadge';
import type { FSMTransition } from '@/types/fsm';

interface FSMSubFSMPanelProps {
  transitions: FSMTransition[];
  fsmType: string;
}

interface SubFSMSummary {
  type: 'drive_session' | 'charge_session';
  latestState: string;
  latestTime: string;
  instanceId: number | null;
  transitionCount: number;
}

export function FSMSubFSMPanel({ transitions, fsmType }: FSMSubFSMPanelProps) {
  const { t } = useTranslation();

  // Only show when viewing vehicle-level FSMs
  const isVehicleView = fsmType === 'vehicle_state' || fsmType === 'vehicle' || fsmType === 'all';

  const subFSMs = useMemo(() => {
    if (!isVehicleView) return [];

    const summaries: SubFSMSummary[] = [];
    // Match actual fsm_type values from the backend (drives, charging, drive_session, charge_session)
    const subTypes: { match: string[]; label: 'drive_session' | 'charge_session' }[] = [
      { match: ['drive_session', 'drives', 'drive'], label: 'drive_session' },
      { match: ['charge_session', 'charging', 'charge'], label: 'charge_session' },
    ];

    for (const subType of subTypes) {
      const sub = transitions.filter(tr => subType.match.includes(tr.fsm_type));
      if (sub.length === 0) continue;

      // Find latest transition
      let latest = sub[0];
      for (const tr of sub) {
        if (new Date(tr.created_at).getTime() > new Date(latest.created_at).getTime()) {
          latest = tr;
        }
      }

      summaries.push({
        type: subType.label,
        latestState: latest.to_state,
        latestTime: latest.created_at,
        instanceId: latest.fsm_instance_id ?? null,
        transitionCount: sub.length,
      });
    }
    return summaries;
  }, [transitions, isVehicleView]);

  if (!isVehicleView) return null;

  if (subFSMs.length === 0) {
    return (
      <GlassPanel className="p-4">
        <h2 className="text-xs font-medium text-white/50 uppercase tracking-wider mb-2">
          {t('fsm.subFSMs', 'Active Sub-FSMs')}
        </h2>
        <EmptyState message={t('fsm.noSubFSMs', 'No active drive or charge sessions in this time range')} />
      </GlassPanel>
    );
  }

  return (
    <GlassPanel className="p-4">
      <h2 className="text-xs font-medium text-white/50 uppercase tracking-wider mb-3">
        {t('fsm.subFSMs', 'Active Sub-FSMs')}
      </h2>
      <Grid cols={{ default: 1, md: 2 }} gap={3}>
        {subFSMs.map((sub) => {
          const Icon = sub.type === 'drive_session' ? Car : Zap;
          const label = sub.type === 'drive_session'
            ? t('fsm.activeDrive', 'Drive Session')
            : t('fsm.activeCharge', 'Charge Session');
          const terminalStates = sub.type === 'drive_session'
            ? ['completed', 'recovered']
            : ['done', 'recovered'];
          const isActive = !terminalStates.includes(sub.latestState);

          return (
            <div
              key={sub.type}
              className="flex items-center gap-3 rounded-lg border border-white/[0.06] bg-white/[0.02] p-3"
            >
              <div className={`p-2 rounded-lg ${isActive ? 'bg-green-500/10' : 'bg-white/[0.04]'}`}>
                <Icon className={`h-4 w-4 ${isActive ? 'text-green-400' : 'text-white/40'}`} />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-medium text-white/80">{label}</span>
                  {isActive && <span className="h-1.5 w-1.5 rounded-full bg-green-400 animate-pulse" />}
                </div>
                <div className="flex items-center gap-2 mt-1">
                  <StateBadge state={sub.latestState} fsmType={sub.type} />
                  <span className="text-[10px] text-white/40">{formatRelative(sub.latestTime)}</span>
                </div>
              </div>
              <div className="text-right">
                <span className="text-xs text-white/40">{sub.transitionCount}</span>
                <span className="text-[10px] text-white/30 block">
                  {t('fsm.transitions', 'transitions')}
                </span>
              </div>
            </div>
          );
        })}
      </Grid>
    </GlassPanel>
  );
}
