import { AnimatePresence, motion } from '@/components/motion';
import type { YearReview } from '@/api/types';
import type { SlideDefinition } from './slides';
import { TitleSlide } from './TitleSlide';
import { StatHeroSlide } from './StatHeroSlide';
import { StatChartSlide } from './StatChartSlide';
import { DriveHighlightSlide } from './DriveHighlightSlide';
import { ChargingBreakdownSlide } from './ChargingBreakdownSlide';
import { SavingsSlide } from './SavingsSlide';
import { EnvironmentSlide } from './EnvironmentSlide';
import { PatternsSlide } from './PatternsSlide';
import { ComparisonsSlide } from './ComparisonsSlide';
import { SummarySlide } from './SummarySlide';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/cn';

interface Props {
  slideIndex: number;
  slide: SlideDefinition;
  data: YearReview;
}

export function SlideRenderer({ slideIndex, slide, data }: Props) {
  const { t } = useTranslation();

  function renderSlideContent() {
    switch (slide.type) {
      case 'title':
        return <TitleSlide data={data} />;

      case 'stat-hero':
        return <StatHeroSlide data={data} field={slide.field ?? 'distance'} />;

      case 'stat-chart':
        return <StatChartSlide data={data} />;

      case 'drive-highlight':
        if (slide.field === 'longest') {
          return (
            <DriveHighlightSlide
              drive={data.longest_drive}
              label={t('yearReview.longestDrive', 'Longest Drive')}
              emoji="🏔️"
            />
          );
        }
        return (
          <DriveHighlightSlide
            drive={data.most_efficient_drive}
            label={t('yearReview.mostEfficient', 'Most Efficient Drive')}
            emoji="🌿"
          />
        );

      case 'charging-breakdown':
        return <ChargingBreakdownSlide data={data} />;

      case 'savings':
        return <SavingsSlide data={data} />;

      case 'environment':
        return <EnvironmentSlide data={data} />;

      case 'patterns':
        return <PatternsSlide data={data} />;

      case 'comparisons':
        return <ComparisonsSlide comparisons={data.comparisons} />;

      case 'summary':
        return <SummarySlide data={data} />;

      default:
        return null;
    }
  }

  return (
    <AnimatePresence mode="wait">
      <motion.div
        key={slideIndex}
        initial={{ opacity: 0, x: 50 }}
        animate={{ opacity: 1, x: 0 }}
        exit={{ opacity: 0, x: -50 }}
        transition={{ duration: 0.35, ease: 'easeInOut' }}
        className={cn(
          'absolute inset-0 bg-gradient-to-br',
          slide.bg,
        )}
      >
        {renderSlideContent()}
      </motion.div>
    </AnimatePresence>
  );
}
