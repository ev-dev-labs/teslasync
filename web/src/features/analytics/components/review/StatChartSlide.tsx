import { AnimatedNumber } from '@/components/data-display';
import { motion } from '@/components/motion';
import { BarChart, Bar, XAxis, YAxis, ResponsiveContainer, CartesianGrid } from '@/components/charts';
import { useTranslation } from 'react-i18next';
import type { YearReview } from '@/api/types';
import { useMemo } from 'react';

interface Props {
  data: YearReview;
}

const MONTH_LABELS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function StatChartSlide({ data }: Props) {
  const { t } = useTranslation();

  const chartData = useMemo(() =>
    (data.monthly_stats ?? []).map((m) => ({
      name: MONTH_LABELS[m.month - 1] ?? `M${m.month}`,
      drives: m.drives,
    })),
    [data.monthly_stats],
  );

  return (
    <div className="flex flex-col items-center justify-center h-full px-6 text-center">
      <motion.span
        initial={{ scale: 0 }}
        animate={{ scale: 1 }}
        transition={{ type: 'spring', stiffness: 200, damping: 15 }}
        className="text-5xl mb-4"
      >
        🗓️
      </motion.span>

      <motion.div
        initial={{ y: 30, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ delay: 0.2, duration: 0.5 }}
        className="flex items-baseline gap-3 mb-2"
      >
        <AnimatedNumber
          value={data.total_drives}
          duration={1.2}
          className="text-5xl md:text-7xl font-bold text-white"
        />
        <span className="text-xl text-white/60">
          {t('yearReview.drives', 'drives')}
        </span>
      </motion.div>

      <motion.p
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.5, duration: 0.4 }}
        className="text-white/40 mb-6"
      >
        {t('yearReview.avgPerWeek', { count: data.avg_drives_per_week.toFixed(1), defaultValue: '{{count}} drives per week on average' })}
      </motion.p>

      <motion.div
        initial={{ y: 40, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ delay: 0.7, duration: 0.6 }}
        className="w-full max-w-lg h-48"
      >
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={chartData} margin={{ top: 0, right: 0, left: -20, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
            <XAxis dataKey="name" tick={{ fill: 'rgba(255,255,255,0.4)', fontSize: 12 }} axisLine={false} tickLine={false} />
            <YAxis tick={{ fill: 'rgba(255,255,255,0.3)', fontSize: 11 }} axisLine={false} tickLine={false} />
            <Bar dataKey="drives" fill="rgba(167,139,250,0.7)" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </motion.div>
    </div>
  );
}
