import { AnimatedNumber } from '@/components/data-display';
import { motion } from '@/components/motion';
import { useTranslation } from 'react-i18next';
import { useSettings } from '@/hooks/useSettings';
import type { YearReview } from '@/api/types';
import { Zap, Car, Plug, Leaf } from 'lucide-react';

interface Props {
  data: YearReview;
}

export function SummarySlide({ data }: Props) {
  const { t } = useTranslation();
  const { convertDistance, distanceUnit } = useSettings();

  const stats = [
    {
      icon: Car,
      label: t('yearReview.totalDrives', 'Drives'),
      value: data.total_drives,
      decimals: 0,
    },
    {
      icon: Car,
      label: distanceUnit,
      value: convertDistance(data.total_distance_km),
      decimals: 0,
    },
    {
      icon: Zap,
      label: t('yearReview.energyKwh', 'kWh'),
      value: data.total_energy_kwh,
      decimals: 0,
    },
    {
      icon: Plug,
      label: t('yearReview.charges', 'Charges'),
      value: data.total_charge_sessions,
      decimals: 0,
    },
    {
      icon: Leaf,
      label: t('yearReview.co2KgSaved', 'kg CO₂ saved'),
      value: data.co2_offset_kg,
      decimals: 0,
    },
  ];

  return (
    <div className="flex flex-col items-center justify-center h-full px-8 text-center">
      {/* Screenshot-friendly 16:9 card */}
      <motion.div
        initial={{ scale: 0.9, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ duration: 0.6 }}
        className="bg-gradient-to-br from-white/[0.08] to-white/[0.02] backdrop-blur-md rounded-3xl p-8 max-w-md w-full border border-white/[0.12] shadow-2xl"
      >
        <div className="flex items-center justify-between mb-6">
          <div>
            <h2 className="text-2xl font-bold text-white">{data.year}</h2>
            <p className="text-sm text-white/50">{t('yearReview.title', 'Year in Review')}</p>
          </div>
          <div className="text-right">
            <p className="text-sm font-medium text-white/80">{data.vehicle.display_name}</p>
            <p className="text-xs text-white/40">{data.vehicle.model}</p>
          </div>
        </div>

        <div className="space-y-3">
          {stats.map((stat, i) => (
            <motion.div
              key={stat.label}
              initial={{ x: -20, opacity: 0 }}
              animate={{ x: 0, opacity: 1 }}
              transition={{ delay: 0.3 + i * 0.1, duration: 0.4 }}
              className="flex items-center gap-3"
            >
              <stat.icon className="h-5 w-5 text-white/40 shrink-0" />
              <AnimatedNumber
                value={stat.value}
                duration={1}
                decimals={stat.decimals}
                className="text-xl font-bold text-white min-w-[4rem] text-left"
              />
              <span className="text-sm text-white/50">{stat.label}</span>
            </motion.div>
          ))}
        </div>

        {data.gas_savings > 0 && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 1, duration: 0.4 }}
            className="mt-6 pt-4 border-t border-white/[0.08] text-center"
          >
            <p className="text-sm text-emerald-400/80">
              💰 {t('yearReview.savedSummary', `Saved $${Math.round(data.gas_savings)} vs. gas`)}
            </p>
          </motion.div>
        )}

        <p className="text-[10px] text-white/20 mt-4">TeslaSync • Year in Review</p>
      </motion.div>

      <motion.p
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 1.2, duration: 0.4 }}
        className="text-sm text-white/30 mt-6"
      >
        {t('yearReview.screenshot', '📸 Screenshot to share your year!')}
      </motion.p>
    </div>
  );
}
