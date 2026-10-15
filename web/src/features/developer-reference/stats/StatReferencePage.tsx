import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { PageContainer } from '@/components/layout';
import { FadeIn } from '@/components/motion';
import { usePageTitle } from '@/hooks/usePageTitle';
import { useUnits } from '@/hooks/useUnits';
import { useFormatting } from '@/hooks/useFormatting';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';
import type { MetricPreferences } from '@/lib/metric-reference';
import { FormatExamples, ReferenceGlossary, ReferencePreferences, StripExamples } from './index';

/** Intended /dev/stats. Parent owns DEV/reference-review-only routing and canonical i18n. */
export default function StatReferencePage() {
  const { t } = useTranslation();
  const title = t('developerReference.stats.page.title', 'Stat formatting reference');
  usePageTitle(title);
  const { unitPrefs } = useUnits();
  const { currencySymbol } = useFormatting();
  const numeric = useNumberFormatting();
  const saved: MetricPreferences = {
    units: { ...unitPrefs, precision: unitPrefs.precision ?? numeric.precision, locale: unitPrefs.locale ?? numeric.locale },
    currency: { kind: 'symbol', value: currencySymbol },
  };
  const [profile, setProfile] = useState('saved');
  const [local, setLocal] = useState<MetricPreferences>(() => saved);
  const preferences = profile === 'saved' ? saved : local;
  return <PageContainer title={title} copyLink={false} compactHeader={false}
    subtitle={t('developerReference.stats.page.subtitle',
      'Synthetic fixtures, chosen candidate policies and source-preserving contracts. Not live vehicle data or an approved production rollout.')}>
    <FadeIn><ReferencePreferences profile={profile} onProfile={next => {
      if (next === 'local' && profile === 'saved') setLocal(saved);
      setProfile(next);
    }} preferences={preferences} onPreferences={setLocal} savedCurrencySymbol={currencySymbol} /></FadeIn>
    <FadeIn><StripExamples preferences={preferences} /></FadeIn>
    <FadeIn><FormatExamples preferences={preferences} /></FadeIn>
    <FadeIn><ReferenceGlossary /></FadeIn>
  </PageContainer>;
}
