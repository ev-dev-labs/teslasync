import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CircleMarker, MapContainer, MapInvalidator, Polyline, Popup, Rectangle } from '@/components/maps';
import { Badge, Button, Caption, GlassPanel, PanelTitle, Text } from '@/components/ui';
import { PREVIEW_ROUTE } from './fixtures';
import PreviewMapControls from './PreviewMapControls';

/** No tile layer, geolocation, provider configuration, query or external request. */
export default function PreviewMap() {
  const { t } = useTranslation('settings');
  const [routeVisible, setRouteVisible] = useState(true);
  return (
    <GlassPanel data-preview-section="map" className="min-w-0 space-y-4 p-4">
      <PanelTitle>{t('theme.appDesignPreview.map', 'Fictional route map')}</PanelTitle>
      <Caption data-app-part="map-provenance">{t('theme.appDesignPreview.mapHelp', 'Local vector fixture at fictional ocean coordinates. No basemap or location service is requested. Pan, zoom and open a marker.')}</Caption>
      <div data-app-part="map-toolbar" className="flex flex-wrap gap-2">
        <Button variant="secondary" aria-pressed={routeVisible} onClick={() => setRouteVisible(value => !value)}>
          {t('theme.appDesignPreview.toggleRoute', 'Show sample route')}</Button>
      </div>
      <div data-app-part="map map-stage" className="relative isolate h-72 min-w-0 overflow-hidden rounded-panel border border-[var(--border-default)] [container-type:inline-size]">
        <MapContainer center={[0.01, 0]} zoom={13} minZoom={11} maxZoom={16} scrollWheelZoom={false}
          zoomControl={false} attributionControl={false} className="h-full w-full"
          aria-label={t('theme.appDesignPreview.map', 'Fictional route map')}>
          <MapInvalidator />
          <PreviewMapControls />
          <Rectangle bounds={[[-0.02, -0.04], [0.04, 0.04]]}
            pathOptions={{ color: 'var(--border-default)', fillColor: 'var(--surface-2)', fillOpacity: 0.5 }} />
          {routeVisible && <Polyline positions={PREVIEW_ROUTE} pathOptions={{ color: 'var(--theme-accent)', weight: 3 }} />}
          {/* marker-cluster:no waypoints — four fixed itinerary stops must stay individually selectable, not aggregated as density. */}
          {PREVIEW_ROUTE.map((point, index) => (
            <CircleMarker key={index} center={point} radius={8}
              pathOptions={{ color: 'var(--theme-accent)', fillOpacity: 0.7 }}
              eventHandlers={{ add: event => {
                const marker = event.target as { getElement: () => SVGElement | null; openPopup: () => void };
                const element = marker.getElement();
                element?.setAttribute('data-preview-map-marker', String(index));
                element?.setAttribute('role', 'button');
                element?.setAttribute('tabindex', '0');
                element?.setAttribute('aria-label', t('theme.appDesignPreview.stop', 'Fictional stop {{number}}', { number: index + 1 }));
                element?.addEventListener('keydown', key => {
                  if (key.key === 'Enter' || key.key === ' ') {
                    key.preventDefault();
                    marker.openPopup();
                  }
                });
              } }}>
              <Popup className="[&_.leaflet-popup-content]:max-w-[calc(100cqw_-_5.5rem)]"><Text as="div">{t('theme.appDesignPreview.stop', 'Fictional stop {{number}}', { number: index + 1 })}</Text>
                <Caption>{t('theme.appDesignPreview.stopHelp', 'Example marker, not a recorded vehicle position.')}</Caption></Popup>
            </CircleMarker>
          ))}
        </MapContainer>
      </div>
      <div data-app-part="map-legend" className="flex flex-wrap gap-2">
        <Badge>{t('theme.appDesignPreview.routeLegend', 'Line: fictional itinerary')}</Badge>
        <Badge>{t('theme.appDesignPreview.markerLegend', 'Circles: four sample stops')}</Badge>
      </div>
    </GlassPanel>
  );
}
