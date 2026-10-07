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

import { PageLayout } from '@/components/layout';
import { Button } from '@/components/ui';
import { FadeIn } from '@/components/motion';
import { usePageTitle } from '@/hooks/usePageTitle';
import {
  useGasPriceStatus,
  useGasPriceHistory,
  usePollGasPrice,
} from '@/api/hooks/useSettings';
import { deriveDataState } from '@/api/dataState';
import { GasPriceBrief } from '../components/operationalbrief-a-g/GasPriceBrief';
import { GasConfiguration } from '../components/continuation-admin-2/GasConfiguration';
import { GasTrendChart } from '../components/continuation-admin-2/GasTrendChart';
import { GasHistoryTable } from '../components/continuation-admin-2/GasHistoryTable';

export default function GasPriceAutoPollPage() {
  const { t } = useTranslation();
  const title = t('gas.title', 'Gas price auto-poll');
  usePageTitle(title);

  const statusQuery = useGasPriceStatus();
  const historyQuery = useGasPriceHistory();
  const pollMut = usePollGasPrice();
  const statusSource = deriveDataState(statusQuery);
  const historySource = deriveDataState(historyQuery);

  const actions = (
    <Button
      variant="primary"
      size="sm"
      icon={<Zap className="h-4 w-4" aria-hidden="true" />}
      loading={pollMut.isPending}
      onClick={() => pollMut.mutate()}
    >
      {t('gas.pollNow', 'Poll now')}
    </Button>
  );

  return (
    <PageLayout
      title={title}
      subtitle={t('gas.subtitle', 'Automatically fetch US average gas prices from EIA')}
      primaryAction={actions}
      query={[statusQuery, historyQuery]}
      dataSources={[
        { id: 'gas-status', label: t('gas.status', 'Status'), query: statusQuery },
        { id: 'gas-history', label: t('gas.historyTitle', 'Price history'), query: historyQuery },
      ]}
    >
      <FadeIn>
        <GasPriceBrief source={statusSource} />
      </FadeIn>

      <FadeIn delay={0.1}>
        <section className="grid grid-cols-1 gap-4 xl:grid-cols-3 xl:gap-5">
          <div className="xl:col-span-2">
            <GasTrendChart source={historySource} />
          </div>
          <GasConfiguration source={statusSource} />
        </section>
      </FadeIn>

      <FadeIn delay={0.2}>
        <GasHistoryTable source={historySource} />
      </FadeIn>
    </PageLayout>
  );
}
