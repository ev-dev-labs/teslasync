import { PresentationOverlay } from '@/components/layout/presentation/PresentationOverlay';
import type { KioskConfig } from '../hooks/useKioskMode';

interface KioskOverlayProps {
  config: KioskConfig;
  isDimmed: boolean;
  isCursorHidden: boolean;
  dashboardCount: number;
  currentIndex: number;
  onExit: () => void;
}

/**
 * Compatibility adapter for focused dashboard tests and downstream imports.
 * The application shell owns kiosk chrome through PresentationOverlay.
 */
export function KioskOverlay({
  config,
  isDimmed,
  isCursorHidden,
  dashboardCount,
  currentIndex,
  onExit,
}: KioskOverlayProps) {
  return (
    <PresentationOverlay
      mode="kiosk"
      config={config}
      isDimmed={isDimmed}
      isCursorHidden={isCursorHidden}
      dashboardCount={dashboardCount}
      currentIndex={currentIndex}
      showRotation={config.rotateInterval > 0}
      onExit={onExit}
    />
  );
}
