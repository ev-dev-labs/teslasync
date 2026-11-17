import type { ReactNode } from 'react';
import { usePackModule, usePackPresentation } from './PackBoundary';
import { PACK_APPEARANCES } from './types';
import { loadTimeline } from './packModules';
import type { TimelinePresentationProps } from './families/Timeline.types';

interface TimelineProps extends Partial<Pick<TimelinePresentationProps, 'render' | 'compact'>> {
  children: ReactNode;
}

export default function TimelinePresentation({ children, compact, render }: TimelineProps) {
  const packId = usePackPresentation();
  const Presentation = usePackModule(packId, packId === 'classic' ? null : loadTimeline);
  return Presentation && packId !== 'classic'
    ? <Presentation appearance={PACK_APPEARANCES[packId]} compact={compact}
        render={render ?? (slots => <div className={slots.row}>{children}</div>)} />
    : children;
}
