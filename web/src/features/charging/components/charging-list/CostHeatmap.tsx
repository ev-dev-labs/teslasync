import { useTranslation } from 'react-i18next';
import { Clock } from 'lucide-react';
import { GlassPanel } from '@/components/ui';
import { fmtNumber } from '@/lib/numberFormat';
import type { ChargingOptimizerData } from '@/types/charging';

interface CostHeatmapProps {
  heatmap: ChargingOptimizerData['weekly_heatmap'];
  peakCostPerKwh: number;
}

export function CostHeatmap({ heatmap, peakCostPerKwh }: CostHeatmapProps) {
  const { t } = useTranslation();
  const maxCost = peakCostPerKwh || 0.30;

  return (
    <GlassPanel className="p-6">
      <h3 className="mb-4 flex items-center gap-2 text-sm font-semibold text-white">
        <Clock className="h-4 w-4 text-neon-purple" />
        {t('charging.optimizer.heatmap', 'Charging Cost Heatmap')}
      </h3>
      <div className="overflow-x-auto">
        <div className="min-w-[600px]">
          {/* Hour labels */}
          <div className="flex gap-0.5 ml-12 mb-1">
            {Array.from({ length: 24 }, (_, i) => (
              <div key={i} className="flex-1 text-center text-[8px] text-white/30">
                {i % 3 === 0 ? `${i}` : ''}
              </div>
            ))}
          </div>
          {/* Grid rows */}
          {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((dayLabel, dayIdx) => (
            <div key={dayIdx} className="flex items-center gap-0.5 mb-0.5">
              <span className="w-10 text-right text-[10px] text-white/40 mr-1">{dayLabel}</span>
              {Array.from({ length: 24 }, (_, hourIdx) => {
                const entry = heatmap.find((e) => e.day === dayIdx && e.hour === hourIdx);
                const sessions = entry?.sessions ?? 0;
                const cost = entry?.avg_cost_per_kwh ?? 0;
                const intensity = maxCost > 0 ? Math.min(1, cost / maxCost) : 0;
                return (
                  <div
                    key={hourIdx}
                    className="flex-1 aspect-square rounded-sm"
                    style={{
                      backgroundColor: sessions > 0
                        ? `rgba(${Math.round(intensity * 239)}, ${Math.round((1 - intensity) * 187)}, ${Math.round((1 - intensity) * 100)}, ${Math.min(0.9, 0.15 + sessions * 0.12)})`
                        : 'rgba(255,255,255,0.02)',
                    }}
                    title={sessions > 0 ? `${dayLabel} ${hourIdx}:00 — ${sessions} sessions, $${fmtNumber(cost, 3)}/kWh` : `${dayLabel} ${hourIdx}:00`}
                  />
                );
              })}
            </div>
          ))}
          {/* Legend */}
          <div className="flex items-center justify-end gap-2 mt-2 text-[10px] text-white/40">
            <span>{t('charging.optimizer.cheap', 'Cheap')}</span>
            <div className="flex gap-0.5">
              {[0.15, 0.3, 0.5, 0.7, 0.9].map((o, i) => (
                <div key={i} className="w-3 h-3 rounded-sm" style={{ backgroundColor: `rgba(${Math.round(o * 239)}, ${Math.round((1 - o) * 187)}, ${Math.round((1 - o) * 100)}, 0.6)` }} />
              ))}
            </div>
            <span>{t('charging.optimizer.expensive', 'Expensive')}</span>
          </div>
        </div>
      </div>
    </GlassPanel>
  );
}
