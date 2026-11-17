import type { ReactNode } from 'react';
import { usePackModule, usePackPresentation } from './PackBoundary';
import { PACK_APPEARANCES } from './types';
import { loadStatus } from './packModules';
import type { StatusPresentationProps } from './families/Status.types';

interface StatusProps extends Omit<StatusPresentationProps, 'appearance'> {
  children: ReactNode;
}

export default function StatusPresentation({ children, ...props }: StatusProps) {
  const packId = usePackPresentation();
  const Presentation = usePackModule(packId, packId === 'classic' ? null : loadStatus);
  return Presentation && packId !== 'classic'
    ? <Presentation {...props} appearance={PACK_APPEARANCES[packId]} />
    : children;
}
