import { useTranslation } from 'react-i18next';
import { Car, Zap } from 'lucide-react';
import { GlassPanel } from '@/components/ui';
import { TimeStamp } from '@/components/data-display';
import { EmptyState } from '@/components/feedback';
import { Grid } from '@/components/layout';
import { VisuallyHidden } from '@/components/a11y';
import { StateBadge } from './StateBadge';
import type { ActiveSubFSM } from '@/types/fsm';

interface FSMSubFSMPanelProps {
  activeSubs?: ActiveSubFSM[];
  fsmType: string;
}

export function FSMSubFSMPanel({ activeSubs, fsmType }: FSMSubFSMPanelProps) {
  const { t } = useTranslation();

  // Only show when viewing vehicle-level FSMs
  const isVehicleView = fsmType === 'vehicle' || fsmType === 'all';
  if (!isVehicleView) return null;

  const subs = activeSubs ?? [];

  if (subs.length === 0) {
    return (
      <GlassPanel className="p-4">
        <h2 className="text-xs font-medium text-[var(--text-secondary)] uppercase tracking-wider mb-2">
          {t('fsm.subFSMs', 'Active Sub-FSMs')}
        </h2>
        <EmptyState /* no-action: transient empty state — surfaces when source data is missing; no specific recovery action available */ message={t('fsm.noSubFSMs', 'No active drive or charge sessions')} />
      </GlassPanel>
    );
  }

  return (
    <GlassPanel className="p-4">
      <h2 className="text-xs font-medium text-[var(--text-secondary)] uppercase tracking-wider mb-3">
        {t('fsm.subFSMs', 'Active Sub-FSMs')}
      </h2>
      <Grid cols={{ default: 1, md: 2 }} gap={3}>
        {subs.map((sub) => {
          const Icon = sub.type === 'drive' ? Car : Zap;
          const label = sub.type === 'drive'
            ? t('fsm.activeDrive', 'Drive Session')
            : t('fsm.activeCharge', 'Charge Session');
          const terminalStates = sub.type === 'drive'
            ? ['completed', 'recovered']
            : ['done', 'recovered'];
          const isActive = !terminalStates.includes(sub.state);

          return (
            <div
              key={sub.type}
              className="flex items-center gap-3 rounded-lg border border-white/[0.06] bg-white/[0.02] p-3"
            >
              <div className={`p-2 rounded-lg ${isActive ? 'bg-green-500/10' : 'bg-white/[0.04]'}`}>
                <Icon
                  aria-hidden="true"
                  className={`h-4 w-4 ${isActive ? 'text-green-400' : 'text-[var(--text-muted)]'}`}
                />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-medium text-[var(--text-primary)]">{label}</span>
                  {isActive && (
                    <>
                      <span
                        aria-hidden="true"
                        className="h-1.5 w-1.5 rounded-full bg-green-400 animate-pulse"
                      />
                      <VisuallyHidden>{t('fsm.sessionLive', 'Live')}</VisuallyHidden>
                    </>
                  )}
                </div>
                <div className="flex items-center gap-2 mt-1">
                  <StateBadge state={sub.state} fsmType={sub.type === 'drive' ? 'drive_session' : 'charge_session'} />
                  <TimeStamp value={sub.start_time} className="text-2xs text-[var(--text-muted)]" />
                </div>
              </div>
            </div>
          );
        })}
      </Grid>
    </GlassPanel>
  );
}
