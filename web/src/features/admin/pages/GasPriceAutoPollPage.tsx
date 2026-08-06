/**
 * GasPriceAutoPollPage — first-class page for the EIA gas-price auto-poll
 * surface (Integrations sidebar group). Redesigned to the modern-ui gold
 * standard: a full-width responsive bento of a KPI band, a hero price-trend
 * chart alongside the configuration panel, and a full-width history table.
 *
 * The page is a thin orchestrator; every section lives in a dedicated,
 * self-sufficient sub-component under `../components/gas-price` that owns its
 * own loading / empty / error state.
 */

import { useTranslation } from 'react-i18next';
import { Zap } from 'lucide-react';

import { PageContainer } from '@/components/layout';
import { Button } from '@/components/ui';
import { FadeIn } from '@/components/motion';
import { usePageTitle } from '@/hooks/usePageTitle';
import {
  useGasPriceStatus,
  useGasPriceHistory,
  usePollGasPrice,
} from '@/api/hooks/useSettings';
import {
  GasPriceKpiBand,
  GasPriceControlPanel,
  GasPriceTrendChart,
  GasPriceHistoryTable,
} from '@/features/admin/components/gas-price';

export default function GasPriceAutoPollPage() {
  const { t } = useTranslation();
  const title = t('gas.title', 'Gas Price Auto-Poll');
  usePageTitle(title);

  const statusQuery = useGasPriceStatus();
  const historyQuery = useGasPriceHistory();
  const pollMut = usePollGasPrice();

  const actions = (
    <Button
      variant="primary"
      size="sm"
      icon={<Zap className="h-4 w-4" aria-hidden="true" />}
      loading={pollMut.isPending}
      onClick={() => pollMut.mutate()}
    >
      {t('gas.pollNow', 'Poll Now')}
    </Button>
  );

  return (
    <PageContainer
      title={title}
      subtitle={t('gas.subtitle', 'Automatically fetch US average gas prices from EIA')}
      actions={actions}
      query={[statusQuery, historyQuery]}
    >
      <FadeIn>
        <GasPriceKpiBand query={statusQuery} />
      </FadeIn>

      <FadeIn delay={0.1}>
        <section className="grid grid-cols-1 gap-4 xl:grid-cols-3 xl:gap-5">
          <div className="xl:col-span-2">
            <GasPriceTrendChart query={historyQuery} onPollNow={() => pollMut.mutate()} />
          </div>
          <GasPriceControlPanel query={statusQuery} />
        </section>
      </FadeIn>

      <FadeIn delay={0.2}>
        <GasPriceHistoryTable query={historyQuery} />
      </FadeIn>
    </PageContainer>
  );
}
