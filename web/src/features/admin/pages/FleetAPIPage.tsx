/**
 * FleetAPIPage — outbound Tesla Fleet API access and polling participation.
 *
 * Opt into automatic polling, independently allow each implemented Fleet API
 * route, and view the runtime's configured endpoints. Laid out as a
 * full-width, mobile-first bento; every data section owns its own
 * loading / error / empty state and reads only from the settings hooks.
 */

import { PageLayout } from '@/components/layout';
import { useFleetAPIPage } from '../hooks/useFleetAPIPage';
import { FleetAPIBrief } from '../components/operationalbrief-a-g/FleetAPIBrief';
import { FleetAPIPolling } from '../components/structural-closure/fleet-api/FleetAPIPolling';
import { FleetAPIConfiguredEndpoints } from '../components/structural-closure/fleet-api/FleetAPIConfiguredEndpoints';
import { FleetAPIEndpointControls } from '../components/structural-closure/fleet-api/FleetAPIEndpointControls';

export default function FleetAPIPage() {
  const controller = useFleetAPIPage();
  const { t, settingsQuery, pollingQuery, versionQuery, dataSources } = controller;
  return (
    <PageLayout
      title={t('fleetApi.pageTitle', 'Fleet API settings')}
      subtitle={t('fleetApi.subtitle', 'Choose which Tesla Fleet API routes are available and which can be polled automatically')}
      query={[settingsQuery, pollingQuery, versionQuery]}
      dataSources={dataSources}
    >
      <FleetAPIBrief controller={controller} />
      <FleetAPIPolling controller={controller} />
      <FleetAPIEndpointControls controller={controller} />
      <FleetAPIConfiguredEndpoints controller={controller} />
    </PageLayout>
  );
}
