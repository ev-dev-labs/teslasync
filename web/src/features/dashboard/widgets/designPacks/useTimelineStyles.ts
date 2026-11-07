import { usePackPresentation } from './PackBoundary';
import { PACK_APPEARANCES } from './types';
import { timelineStyles } from './families/Timeline.styles';

/** Existing live lists retain their mounted rows and local controls across pack changes. */
export function useTimelineStyles() {
  const pack = usePackPresentation();
  if (pack === 'classic') return undefined;
  const appearance = PACK_APPEARANCES[pack];
  return { appearance, ...timelineStyles[appearance] };
}
