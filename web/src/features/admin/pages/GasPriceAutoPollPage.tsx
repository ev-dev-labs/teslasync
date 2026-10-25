import { Icons } from '@/lib/icons';
/**
 * GasPriceAutoPollPage — first-class page for the EIA gas-price auto-poll
 * surface (Integrations sidebar group): summary, price trend, configuration
 * and history.
 *
 * Status and history queries are shared with their dedicated section adapters,
 * which retain independent loading, empty and error states.
 */

import { useTranslation } from 'react-i18next';

import { PageLayout } from '@/components/layout';
import { Button, Caption, Icon } from '@/components/ui';
import { OperationalWriteNotice, StaleRefreshWarning } from '@/components/feedback';
import { FadeIn } from '@/components/motion';
import { usePageTitle } from '@/hooks/usePageTitle';
import { useOperationalMode } from '@/hooks/useOperationalMode';
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
  const { canWrite, writeBlockReason } = useOperationalMode();
  const statusSource = deriveDataState(statusQuery);
  const historySource = deriveDataState(historyQuery);

  const actions = (
    <Button
      variant="primary"
      size="sm"
      wrapLabel
      className="min-h-11 min-w-11 md:min-h-9 md:min-w-0"
      icon={<Icon icon={Icons.charging} />}
      loading={pollMut.isPending}
      disabled={!canWrite}
      title={writeBlockReason ?? undefined}
      onClick={() => { if (canWrite) pollMut.mutate(); }}
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
      <OperationalWriteNotice />
      <FadeIn>
        <GasPriceBrief source={statusSource} />
      </FadeIn>

      <FadeIn delay={0.1}>
        <Caption className="mb-3">
          {t('gas.priceTrend', 'Price trend')} / {t('gas.historyTitle', 'Price history')}
          {': '}
          {t('archetypes.kpis.windowHint', 'Bounded at {{limit}} newest rows', { limit: 50 })}
        </Caption>
        <section className="grid grid-cols-1 gap-4 xl:grid-cols-3 xl:gap-5">
          <div className="min-w-0 space-y-3 xl:col-span-2">
            <StaleRefreshWarning state={historySource} label={t('gas.priceTrend', 'Price trend')} />
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
