import { motion } from '@/components/motion';
import { PieChart, Pie, Cell, ResponsiveContainer } from '@/components/charts';
import { useTranslation } from 'react-i18next';
import type { YearReview } from '@/api/types';
import { useMemo } from 'react';

interface Props {
  data: YearReview;
}

const COLORS = ['#f59e0b', '#3b82f6', '#6b7280'];

export function ChargingBreakdownSlide({ data }: Props) {
  const { t } = useTranslation();

  const chartData = useMemo(() => {
    const items = [
      { name: t('yearReview.supercharger', 'Supercharger'), value: data.supercharger_pct },
      { name: t('yearReview.dcFast', 'DC Fast'), value: data.dc_fast_pct },
      { name: t('yearReview.acOther', 'AC / Other'), value: data.ac_other_pct },
    ];
    return items.filter((d) => d.value > 0);
  }, [data.supercharger_pct, data.dc_fast_pct, data.ac_other_pct, t]);

  return (
    <div className="flex flex-col items-center justify-center h-full px-8 text-center">
      <motion.span
        initial={{ scale: 0 }}
        animate={{ scale: 1 }}
        transition={{ type: 'spring', stiffness: 200, damping: 15 }}
        className="text-5xl mb-4"
      >
        🔌
      </motion.span>

      <motion.p
        initial={{ y: 20, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ delay: 0.2, duration: 0.4 }}
        className="text-2xl font-bold text-white mb-1"
      >
        {data.total_charge_sessions} {t('yearReview.chargeSessions', 'charge sessions')}
      </motion.p>

      <motion.p
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.4, duration: 0.3 }}
        className="text-white/40 mb-6"
      >
        {t('yearReview.avgStartSOC', `Average plug-in at ${Math.round(data.avg_charge_start_soc)}% battery`)}
      </motion.p>

      <motion.div
        initial={{ scale: 0.8, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ delay: 0.5, duration: 0.6 }}
        className="w-56 h-56 relative"
      >
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={chartData}
              cx="50%"
              cy="50%"
              innerRadius={55}
              outerRadius={85}
              paddingAngle={3}
              dataKey="value"
              strokeWidth={0}
            >
              {chartData.map((_, i) => (
                <Cell key={i} fill={COLORS[i % COLORS.length]} />
              ))}
            </Pie>
          </PieChart>
        </ResponsiveContainer>
      </motion.div>

      <motion.div
        initial={{ y: 20, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ delay: 0.8, duration: 0.4 }}
        className="flex gap-6 mt-4"
      >
        {chartData.map((item, i) => (
          <div key={item.name} className="flex items-center gap-2">
            <div className="h-3 w-3 rounded-full" style={{ backgroundColor: COLORS[i % COLORS.length] }} />
            <span className="text-sm text-white/60">
              {item.name} ({Math.round(item.value)}%)
            </span>
          </div>
        ))}
      </motion.div>
    </div>
  );
}
