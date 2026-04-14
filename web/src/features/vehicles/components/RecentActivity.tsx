import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Route, Clock, ChevronRight, BatteryCharging, Zap } from 'lucide-react'
import { GlassPanel } from '@/components/ui/GlassPanel'
import { IconBox } from '@/components/ui/IconBox'
import { FadeIn } from '@/components/motion/FadeIn'
import { InlineMetric } from '@/components/data-display/InlineMetric'
import { AnimatedNumber } from '@/components/data-display/AnimatedNumber'
import { useSettings } from '@/hooks/useSettings'
import { formatDateTime } from '@/lib/dateFormat'
import { fmtInt } from '@/lib/numberFormat'
import type { Drive, ChargingSession } from '@/api/types'

interface RecentActivityProps {
  drives: Drive[] | undefined
  sessions: ChargingSession[] | undefined
}

export function RecentActivity({ drives, sessions }: RecentActivityProps) {
  const { t } = useTranslation()
  const { convertDistance, distanceUnit } = useSettings()

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
      {/* Recent Drives */}
      <FadeIn delay={0.25}>
        <GlassPanel className="p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="section-title flex items-center gap-2">
              <Route className="h-4 w-4 text-neon-cyan" />{' '}
              {t('common.recentDrives', 'Recent Drives')}
            </h3>
            <Link
              to="/drives"
              className="text-xs text-[var(--text-muted)] hover:text-neon-cyan transition-colors flex items-center gap-1"
            >
              {t('common.viewAll', 'View all')} <ChevronRight className="h-3 w-3" />
            </Link>
          </div>
          {drives && drives.length > 0 ? (
            <div className="space-y-2">
              {drives.slice(0, 5).map((d) => (
                <Link
                  key={d.id}
                  to={`/drives/${d.id}`}
                  className="flex items-center gap-3 p-2.5 rounded-xl hover:bg-white/[0.03] transition-colors group"
                >
                  <IconBox color="cyan" size="sm">
                    <Route className="h-3.5 w-3.5" />
                  </IconBox>
                  <div className="flex-1 text-sm">
                    <p className="text-[var(--text-primary)] font-medium group-hover:text-neon-cyan transition-colors">
                      <AnimatedNumber
                        value={convertDistance(d.distance)}
                        decimals={1}
                        suffix={` ${distanceUnit}`}
                      />
                    </p>
                    <p className="text-xs text-[var(--text-muted)]">
                      {formatDateTime(d.start_date)}
                    </p>
                  </div>
                  <div className="text-right">
                    <InlineMetric
                      icon={<Clock />}
                      value={`${Math.floor(d.duration_min / 60)}h ${fmtInt(d.duration_min % 60)}m`}
                    />
                    {d.start_battery_level != null && d.end_battery_level != null && (
                      <span className="text-[10px] text-[var(--text-muted)]">
                        {d.start_battery_level}% → {d.end_battery_level}%
                      </span>
                    )}
                  </div>
                </Link>
              ))}
            </div>
          ) : (
            <p className="text-xs text-[var(--text-muted)] text-center py-6">
              {t('common.noDrives', 'No drives recorded yet')}
            </p>
          )}
        </GlassPanel>
      </FadeIn>

      {/* Recent Charging Sessions */}
      <FadeIn delay={0.27}>
        <GlassPanel className="p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="section-title flex items-center gap-2">
              <BatteryCharging className="h-4 w-4 text-neon-green" />{' '}
              {t('common.recentCharges', 'Recent Charges')}
            </h3>
            <Link
              to="/charging"
              className="text-xs text-[var(--text-muted)] hover:text-neon-green transition-colors flex items-center gap-1"
            >
              {t('common.viewAll', 'View all')} <ChevronRight className="h-3 w-3" />
            </Link>
          </div>
          {sessions && sessions.length > 0 ? (
            <div className="space-y-2">
              {sessions.slice(0, 5).map((s) => (
                <Link
                  key={s.id}
                  to={`/charging/${s.id}`}
                  className="flex items-center gap-3 p-2.5 rounded-xl hover:bg-white/[0.03] transition-colors group"
                >
                  <IconBox color="green" size="sm">
                    <Zap className="h-3.5 w-3.5" />
                  </IconBox>
                  <div className="flex-1 text-sm">
                    <p className="text-[var(--text-primary)] font-medium group-hover:text-neon-green transition-colors">
                      <AnimatedNumber
                        value={s.charge_energy_added}
                        decimals={1}
                        suffix=" kWh"
                      />
                    </p>
                    <p className="text-xs text-[var(--text-muted)]">
                      {formatDateTime(s.start_date)}
                    </p>
                  </div>
                  <div className="text-right">
                    <InlineMetric
                      icon={<Clock />}
                      value={`${Math.floor(s.duration_min / 60)}h ${fmtInt(s.duration_min % 60)}m`}
                    />
                    {s.end_battery_level != null && (
                      <span className="text-[10px] text-[var(--text-muted)]">
                        {s.start_battery_level}% → {s.end_battery_level}%
                      </span>
                    )}
                  </div>
                </Link>
              ))}
            </div>
          ) : (
            <p className="text-xs text-[var(--text-muted)] text-center py-6">
              {t('common.noCharges', 'No charging sessions recorded yet')}
            </p>
          )}
        </GlassPanel>
      </FadeIn>
    </div>
  )
}
