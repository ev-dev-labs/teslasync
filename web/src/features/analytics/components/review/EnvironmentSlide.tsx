import { AnimatedNumber } from '@/components/data-display';
import { motion } from '@/components/motion';
import { useTranslation } from 'react-i18next';
import type { YearReview } from '@/api/types';
import { useMemo } from 'react';

interface Props {
  data: YearReview;
}

export function EnvironmentSlide({ data }: Props) {
  const { t } = useTranslation();

  const treesPlanted = useMemo(() => Math.round(data.co2_offset_kg / 21), [data.co2_offset_kg]);
  const treeIcons = useMemo(() => {
    const count = Math.min(treesPlanted, 30);
    return Array.from({ length: count }, (_, i) => i);
  }, [treesPlanted]);

  return (
    <div className="flex flex-col items-center justify-center h-full px-8 text-center">
      <motion.span
        initial={{ scale: 0 }}
        animate={{ scale: 1 }}
        transition={{ type: 'spring', stiffness: 200, damping: 15 }}
        className="text-5xl mb-4"
      >
        🌍
      </motion.span>

      <motion.p
        initial={{ y: 20, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ delay: 0.2, duration: 0.4 }}
        className="text-lg text-white/50 uppercase tracking-wider mb-4"
      >
        {t('yearReview.co2Offset', 'CO₂ offset')}
      </motion.p>

      <motion.div
        initial={{ y: 30, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ delay: 0.4, duration: 0.5 }}
      >
        <AnimatedNumber
          value={data.co2_offset_kg}
          duration={1.5}
          suffix=" kg"
          className="text-5xl md:text-7xl font-bold text-green-400"
        />
      </motion.div>

      <motion.p
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.8, duration: 0.4 }}
        className="text-white/40 mt-2 mb-8"
      >
        {t('yearReview.treesEquiv', { count: treesPlanted, defaultValue: 'Like planting {{count}} trees' })}
      </motion.p>

      {/* Tree grid visualization */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 1, duration: 0.5 }}
        className="flex flex-wrap justify-center gap-2 max-w-xs"
      >
        {treeIcons.map((i) => (
          <motion.span
            key={i}
            initial={{ scale: 0, y: 10 }}
            animate={{ scale: 1, y: 0 }}
            transition={{ delay: 1.1 + i * 0.05, duration: 0.3, type: 'spring' }}
            className="text-2xl"
          >
            🌳
          </motion.span>
        ))}
        {treesPlanted > 30 && (
          <span className="text-white/40 text-sm self-end ml-1">
            +{treesPlanted - 30} {t('yearReview.more', 'more')}
          </span>
        )}
      </motion.div>
    </div>
  );
}
