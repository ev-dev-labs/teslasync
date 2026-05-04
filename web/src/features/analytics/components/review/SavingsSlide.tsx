import { AnimatedNumber } from '@/components/data-display';
import { motion } from '@/components/motion';
import { useTranslation } from 'react-i18next';
import type { YearReview } from '@/api/types';
import { DollarSign, Fuel, Zap } from 'lucide-react';

interface Props {
  data: YearReview;
}

export function SavingsSlide({ data }: Props) {
  const { t } = useTranslation();

  const gasCostEquiv = data.gas_savings + data.total_charging_cost;

  return (
    <div className="flex flex-col items-center justify-center h-full px-8 text-center">
      <motion.span
        initial={{ scale: 0, rotate: -15 }}
        animate={{ scale: 1, rotate: 0 }}
        transition={{ type: 'spring', stiffness: 200, damping: 15 }}
        className="text-6xl mb-6"
      >
        💰
      </motion.span>

      <motion.p
        initial={{ y: 20, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ delay: 0.2, duration: 0.4 }}
        className="text-lg text-[var(--text-secondary)] uppercase tracking-wider mb-4"
      >
        {t('yearReview.youSaved', 'You saved')}
      </motion.p>

      <motion.div
        initial={{ scale: 0.5, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ delay: 0.4, duration: 0.5, type: 'spring' }}
      >
        <AnimatedNumber
          value={data.gas_savings}
          duration={1.5}
          prefix="$"
          className="text-6xl md:text-8xl font-bold text-emerald-400"
        />
      </motion.div>

      <motion.p
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.8, duration: 0.4 }}
        className="text-[var(--text-muted)] mt-2 mb-8"
      >
        {t('yearReview.vsGas', 'vs. driving a gas car')}
      </motion.p>

      {/* Comparison bars */}
      <motion.div
        initial={{ y: 30, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ delay: 1, duration: 0.5 }}
        className="w-full max-w-xs space-y-4"
      >
        <div>
          <div className="flex items-center gap-2 mb-1">
            <Fuel className="h-4 w-4 text-red-400/70" />
            <span className="text-sm text-[var(--text-secondary)]">{t('yearReview.gasCost', 'Gas would cost')}</span>
            <span className="ml-auto text-sm font-medium text-red-400">${Math.round(gasCostEquiv)}</span>
          </div>
          <div className="h-2 rounded-full bg-white/[0.06] overflow-hidden">
            <div className="h-full w-full rounded-full bg-red-400/60" />
          </div>
        </div>

        <div>
          <div className="flex items-center gap-2 mb-1">
            <Zap className="h-4 w-4 text-emerald-400/70" />
            <span className="text-sm text-[var(--text-secondary)]">{t('yearReview.electricCost', 'Electric cost')}</span>
            <span className="ml-auto text-sm font-medium text-emerald-400">${Math.round(data.total_charging_cost)}</span>
          </div>
          <div className="h-2 rounded-full bg-white/[0.06] overflow-hidden">
            <div
              className="h-full rounded-full bg-emerald-400/60"
              style={{ width: gasCostEquiv > 0 ? `${Math.round((data.total_charging_cost / gasCostEquiv) * 100)}%` : '0%' }}
            />
          </div>
        </div>

        <div className="flex items-center justify-center gap-2 pt-2">
          <DollarSign className="h-4 w-4 text-emerald-400" />
          <span className="text-sm text-emerald-400/80">
            {t('yearReview.savingsNote', { cupsOfCoffee: Math.round(data.gas_savings / 5), defaultValue: "That's {{cupsOfCoffee}} cups of coffee!" })}
          </span>
        </div>
      </motion.div>
    </div>
  );
}
