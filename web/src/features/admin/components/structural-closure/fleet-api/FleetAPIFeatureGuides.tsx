import { useTranslation } from 'react-i18next';
import { Button, Card, Heading, Text } from '@/components/ui';
import type { FleetEndpoint } from '@/api/hooks/useSettings';
import { fleetGuideRoutes } from '../../../lib/fleetEndpointPolicy';

export function FleetAPIFeatureGuides({ catalog, selected, onSelect }: {
  catalog: readonly FleetEndpoint[];
  selected: string;
  onSelect: (key: string) => void;
}) {
  const { t } = useTranslation();
  const guides = [
    { key: 'commute', label: t('fleetApi.redesign.commute', 'Smart Commute'),
      help: t('fleetApi.redesign.commuteHelp', 'Allow connectivity and navigation for route dispatch. Wake vehicle is optional.') },
    { key: 'solar', label: t('fleetApi.redesign.solar', 'Solar charging'),
      help: t('fleetApi.redesign.solarHelp', 'Allow site information and live status to evaluate solar charging conditions.') },
    { key: 'backup', label: t('fleetApi.redesign.backup', 'Backup charging watch'),
      help: t('fleetApi.redesign.backupHelp', 'Allow live status for outage monitoring. Site information is needed when connecting a new site.') },
  ];
  return <section className="min-w-0 space-y-2" aria-label={t('fleetApi.redesign.featureGuides', 'Smart Features guides')}>
    <Heading level="section">{t('fleetApi.redesign.featureGuides', 'Smart Features guides')}</Heading>
    <div className="grid min-w-0 grid-cols-[repeat(auto-fit,minmax(min(100%,14rem),1fr))] gap-3">
      {guides.map(guide => {
        const available = catalog.filter(route => fleetGuideRoutes[guide.key]?.includes(route.key)).length;
        const active = selected === guide.key;
        return <Card key={guide.key} className="flex min-w-0 flex-col items-start gap-2 p-3">
          <Heading level="panel">{guide.label}</Heading>
          <Text as="p" variant="bodySm" color="secondary" className="flex-1">{guide.help}</Text>
          {available > 0 ? <Button variant={active ? 'primary' : 'secondary'} size="sm" wrapLabel
            aria-pressed={active} aria-label={t('fleetApi.redesign.showGuideRoutes', 'Show {{feature}} routes', { feature: guide.label })}
            onClick={() => onSelect(active ? '' : guide.key)}>
            {active ? t('fleetApi.redesign.clearGuide', 'Clear guide filter') : t('fleetApi.redesign.showRoutes', 'Show routes')}
          </Button> : <Text as="p" variant="caption">{t('fleetApi.redesign.routesUnavailable', 'No matching routes on this server.')}</Text>}
        </Card>;
      })}
    </div>
    <Text as="p" variant="caption" color="secondary">
      {t('fleetApi.redesign.guideConsent', 'Feature setup and consent are separate. Features that only use collected telemetry do not need Fleet API access.')}
    </Text>
  </section>;
}
