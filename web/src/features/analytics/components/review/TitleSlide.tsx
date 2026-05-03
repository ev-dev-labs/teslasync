import { AnimatedNumber } from '@/components/data-display';
import { motion } from '@/components/motion';
import type { YearReview } from '@/api/types';
import { useTranslation } from 'react-i18next';

interface Props {
  data: YearReview;
}

export function TitleSlide({ data }: Props) {
  const { t } = useTranslation();

  return (
    <div className="flex flex-col items-center justify-center h-full px-8 text-center">
      <motion.div
        initial={{ scale: 0.5, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ duration: 0.6, ease: 'easeOut' }}
        className="text-7xl mb-6"
      >
        🚗
      </motion.div>
      <motion.h1
        initial={{ y: 30, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ delay: 0.3, duration: 0.5 }}
        className="text-5xl md:text-7xl font-bold text-white mb-4"
      >
        <AnimatedNumber value={data.year} duration={0.8} />
      </motion.h1>
      <motion.p
        initial={{ y: 20, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ delay: 0.5, duration: 0.5 }}
        className="text-xl md:text-2xl text-[var(--text-secondary)] mb-2"
      >
        {t('yearReview.title', 'Year in Review')}
      </motion.p>
      <motion.p
        initial={{ y: 20, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ delay: 0.7, duration: 0.5 }}
        className="text-lg text-[var(--text-secondary)]"
      >
        {data.vehicle.display_name}
      </motion.p>
    </div>
  );
}
