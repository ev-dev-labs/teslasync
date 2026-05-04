import { motion } from '@/components/motion';
import { useTranslation } from 'react-i18next';
import type { YearReviewComparison } from '@/api/types';

interface Props {
  comparisons: YearReviewComparison[];
}

export function ComparisonsSlide({ comparisons }: Props) {
  const { t } = useTranslation();
  const items = comparisons ?? [];

  return (
    <div className="flex flex-col items-center justify-center h-full px-6 text-center">
      <motion.p
        initial={{ y: 20, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ delay: 0.1, duration: 0.4 }}
        className="text-xl text-[var(--text-secondary)] mb-6"
      >
        {t('yearReview.funFacts', 'Fun facts about your year')}
      </motion.p>

      <div className="grid grid-cols-2 gap-3 max-w-md w-full">
        {items.map((item, i) => (
          <motion.div
            key={item.label}
            initial={{ scale: 0.8, opacity: 0, rotateY: 90 }}
            animate={{ scale: 1, opacity: 1, rotateY: 0 }}
            transition={{ delay: 0.3 + i * 0.12, duration: 0.4, type: 'spring' }}
            className="bg-white/[0.05] rounded-xl p-4 border border-white/[0.08] text-center"
          >
            <span className="text-3xl block mb-2">{item.emoji}</span>
            <p className="text-sm font-medium text-[var(--text-primary)] mb-1">{item.label}</p>
            <p className="text-xs text-[var(--text-secondary)]">{item.value}</p>
          </motion.div>
        ))}
      </div>
    </div>
  );
}
