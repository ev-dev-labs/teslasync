import { useTranslation } from 'react-i18next';
import { useMap } from '@/components/maps';
import { Button } from '@/components/ui';

export default function PreviewMapControls() {
  const { t } = useTranslation('settings');
  const map = useMap();
  const resetMap = () => {
    map.setView([0.01, 0], 13, { animate: false });
    // Repaint native SVG bounds after setView's fractional reset transform.
    map.panBy([0, 0], { animate: false });
  };
  return (
    <div data-app-part="map-controls" className="absolute right-2 top-2 z-map-control flex flex-wrap gap-2">
      <Button variant="secondary" onClick={() => map.zoomIn()} aria-label={t('theme.appDesignPreview.zoomIn', 'Zoom sample map in')}>+</Button>
      <Button variant="secondary" onClick={() => map.zoomOut()} aria-label={t('theme.appDesignPreview.zoomOut', 'Zoom sample map out')}>−</Button>
      <Button variant="secondary" onClick={resetMap}>
        {t('theme.appDesignPreview.resetMap', 'Reset map')}</Button>
    </div>
  );
}
